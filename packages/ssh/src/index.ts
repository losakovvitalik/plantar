import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, type SFTPWrapper } from "ssh2";
import { create as createTar } from "tar";
import { t } from "./messages";

/**
 * Оборачивает строку в одинарные кавычки для подстановки в shell-команду.
 * Одинарная кавычка внутри строки не может выйти из кавычек: ' → '\''
 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export interface ConnectOptions {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
  /** Содержимое приватного ключа; имеет приоритет над privateKeyPath */
  privateKey?: string | Buffer;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ExecStreamHandlers {
  onStdout: (text: string) => void;
  onStderr: (text: string) => void;
  /** Вызывается один раз — когда команда завершилась или канал закрылся */
  onClose: () => void;
}

export interface ExecStreamHandle {
  stop: () => void;
}

export interface SftpEntryStat {
  size: number;
  /** мс с эпохи; SFTP отдаёт секунды */
  mtimeMs: number;
  isDirectory: boolean;
  isFile: boolean;
}

export interface SftpDirEntry extends SftpEntryStat {
  name: string;
  isSymlink: boolean;
}

export class SshConnection {
  private closed = false;
  /** Мемоизированная детекция PATH: одна на соединение, стартует при первом exec */
  private pathPrefixPromise?: Promise<string>;

  private constructor(
    private client: Client,
    readonly host: string,
  ) {}

  /** false после close() или разрыва — такое соединение нельзя переиспользовать */
  get alive(): boolean {
    return !this.closed;
  }

  static connect(options: ConnectOptions): Promise<SshConnection> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      client
        .on("ready", () => {
          const conn = new SshConnection(client, options.host);
          client.on("close", () => {
            conn.closed = true;
          });
          resolve(conn);
        })
        .on("error", reject)
        .connect({
          host: options.host,
          port: options.port ?? 22,
          username: options.username,
          password: options.password,
          privateKey:
            options.privateKey ??
            (options.privateKeyPath ? readFileSync(options.privateKeyPath) : undefined),
          // Пинг раз в 15 секунд держит соединение живым за NAT
          // и позволяет заметить обрыв простаивающего соединения
          keepaliveInterval: 15_000,
        });
    });
  }

  /**
   * Команды выполняются в неинтерактивной сессии, где профили shell'а
   * не загружаются, поэтому инструменты, поставленные через nvm или pnpm,
   * не находятся в PATH. Перед первой командой один раз спрашиваем PATH
   * у login- и интерактивного bash (маркеры отсекают шум из .bashrc),
   * сливаем и добавляем НАД PATH по умолчанию — «export PATH=…:"$PATH"; ».
   * Не вышло (нет bash, канал завис, обрыв) — работаем без префикса.
   * Ленивая детекция: соединения только под SFTP (вкладка «Файлы»)
   * и проверочные коннекты её не оплачивают.
   */
  private pathPrefix(): Promise<string> {
    this.pathPrefixPromise ??= this.detectShellPath();
    return this.pathPrefixPromise;
  }

  private async detectShellPath(): Promise<string> {
    const login = "__PLANTAR_LOGIN_PATH__:";
    const interactive = "__PLANTAR_INTERACTIVE_PATH__:";
    try {
      // Таймаут обязателен: канал может не закрыться никогда (ForceCommand
      // internal-sftp, фоновый процесс из .bashrc, держащий stdout)
      const result = await this.rawExec(
        `{ bash -lc 'echo "${login}$PATH"'; bash -ic 'echo "${interactive}$PATH"'; } </dev/null 2>/dev/null`,
        7000,
      );
      // lastIndexOf, а не построчный разбор: вывод .bashrc без завершающего
      // перевода строки приклеивает маркер к своему хвосту
      const extract = (marker: string) => {
        const at = result.stdout.lastIndexOf(marker);
        if (at === -1) return [];
        return result.stdout
          .slice(at + marker.length)
          .split("\n")[0]
          .split(":")
          .map((dir) => dir.trim())
          .filter((dir) => dir.startsWith("/"));
      };
      // Интерактивные пути первыми: выбранную nvm версию задаёт .bashrc
      const dirs = [...new Set([...extract(interactive), ...extract(login)])];
      if (dirs.length === 0) return "";
      return `export PATH=${shellQuote(dirs.join(":"))}:"$PATH"; `;
    } catch {
      // Ошибка всплывёт на настоящей команде — здесь просто без префикса
      return "";
    }
  }

  /**
   * Запускает команду и отдаёт её вывод по мере появления.
   * stop() закрывает канал — долгоживущая команда (tail -F) завершается.
   */
  async execStream(command: string, handlers: ExecStreamHandlers): Promise<ExecStreamHandle> {
    const prefix = await this.pathPrefix();
    return new Promise((resolve, reject) => {
      this.client.exec(prefix + command, (err, stream) => {
        if (err) return reject(err);
        // Отдельные декодеры на канал: граница чанка может резать многобайтный символ
        const stdoutDecoder = new TextDecoder();
        const stderrDecoder = new TextDecoder();
        let closed = false;
        stream.on("data", (chunk: Buffer) => {
          handlers.onStdout(stdoutDecoder.decode(chunk, { stream: true }));
        });
        stream.stderr.on("data", (chunk: Buffer) => {
          handlers.onStderr(stderrDecoder.decode(chunk, { stream: true }));
        });
        stream.on("close", () => {
          if (closed) return;
          closed = true;
          handlers.onClose();
        });
        // end() шлёт EOF — команда вида «tail … & cat; kill …» завершает себя сама
        resolve({ stop: () => stream.end() });
      });
    });
  }

  async exec(command: string): Promise<ExecResult> {
    const prefix = await this.pathPrefix();
    return this.rawExec(prefix + command);
  }

  /** exec без префикса PATH; с timeoutMs принудительно закрывает зависший канал */
  private rawExec(command: string, timeoutMs?: number): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (err, stream) => {
        if (err) return reject(err);
        let stdout = "";
        let stderr = "";
        // Отдельные декодеры на канал: граница чанка может резать многобайтный символ
        const stdoutDecoder = new TextDecoder();
        const stderrDecoder = new TextDecoder();
        const timer = timeoutMs
          ? setTimeout(() => {
              // Отдаём собранное к этому моменту — маркеры обычно уже пришли
              stream.close();
              resolve({ stdout, stderr, code: -1 });
            }, timeoutMs)
          : undefined;
        stream.on("data", (chunk: Buffer) => {
          stdout += stdoutDecoder.decode(chunk, { stream: true });
        });
        stream.stderr.on("data", (chunk: Buffer) => {
          stderr += stderrDecoder.decode(chunk, { stream: true });
        });
        stream.on("close", (code: number | null) => {
          clearTimeout(timer);
          // null — канал закрылся без exit-кода (обрыв соединения, kill по сигналу);
          // считаем это ошибкой, иначе оборванная команда выглядит успешной
          resolve({ stdout, stderr, code: code ?? -1 });
        });
      });
    });
  }

  private sftpChannel?: Promise<SFTPWrapper>;

  /**
   * Один SFTP-канал на соединение: каждый client.sftp() открывает новый
   * канал, а сервер ограничивает их число (MaxSessions) — открытие канала
   * на каждый вызов копит их до «Channel open failure».
   */
  private sftp(): Promise<SFTPWrapper> {
    this.sftpChannel ??= new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) {
          this.sftpChannel = undefined;
          return reject(err);
        }
        // Канал закрылся (обрыв, таймаут) — следующий вызов откроет новый
        sftp.on("close", () => {
          this.sftpChannel = undefined;
        });
        resolve(sftp);
      });
    });
    return this.sftpChannel;
  }

  async listDirectories(remotePath: string): Promise<string[]> {
    const sftp = await this.sftp();
    return new Promise((resolve, reject) => {
      sftp.readdir(remotePath, (err, list) => {
        if (err) return reject(err);
        resolve(
          list
            .filter((entry) => entry.attrs.isDirectory())
            .map((entry) => entry.filename)
            .sort(),
        );
      });
    });
  }

  /** Содержимое папки с атрибутами; симлинки не разыменовываются */
  async listEntries(remotePath: string): Promise<SftpDirEntry[]> {
    const sftp = await this.sftp();
    return new Promise((resolve, reject) => {
      sftp.readdir(remotePath, (err, list) => {
        if (err) return reject(err);
        resolve(
          list.map((entry) => ({
            name: entry.filename,
            size: entry.attrs.size,
            mtimeMs: entry.attrs.mtime * 1000,
            isDirectory: entry.attrs.isDirectory(),
            isFile: entry.attrs.isFile(),
            isSymlink: entry.attrs.isSymbolicLink(),
          })),
        );
      });
    });
  }

  /** Атрибуты файла; симлинки разыменовываются. null — файла нет */
  async statEntry(remotePath: string): Promise<SftpEntryStat | null> {
    const sftp = await this.sftp();
    return new Promise((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err) {
          // 2 — SFTP-код NO_SUCH_FILE
          if ((err as { code?: number }).code === 2) return resolve(null);
          return reject(err);
        }
        resolve({
          size: stats.size,
          mtimeMs: stats.mtime * 1000,
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
        });
      });
    });
  }

  /** Читает length байт файла начиная с offset */
  async readFileSlice(remotePath: string, offset: number, length: number): Promise<Buffer> {
    const sftp = await this.sftp();
    return new Promise((resolve, reject) => {
      const stream = sftp.createReadStream(remotePath, {
        start: offset,
        end: offset + length - 1,
      });
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("error", reject);
      stream.on("end", () => resolve(Buffer.concat(chunks)));
    });
  }

  /**
   * Загружает содержимое localDir в remoteDir: пакует всё в tar.gz локально,
   * передаёт одним файлом и распаковывает на сервере — одна передача вместо
   * SFTP-запроса на каждый файл. Папки и файлы, чьё имя (на любом уровне)
   * совпадает со строкой или подходит под RegExp из exclude, пропускаются.
   * Возвращает количество загруженных файлов.
   */
  async uploadDirectory(
    localDir: string,
    remoteDir: string,
    onFile?: (relativePath: string) => void,
    exclude: (string | RegExp)[] = [],
    log?: (line: string) => void,
  ): Promise<number> {
    const excluded = (relativePath: string) =>
      relativePath
        .split(path.posix.sep)
        .some((part) =>
          exclude.some((e) => (typeof e === "string" ? e === part : e.test(part))),
        );

    const tmpDir = mkdtempSync(path.join(tmpdir(), "plantar-upload-"));
    const archive = path.join(tmpDir, "upload.tgz");
    try {
      let fileCount = 0;
      await createTar(
        {
          gzip: true,
          file: archive,
          cwd: localDir,
          // Не тащим в архив локальные uid/gid и прочие метаданные системы
          portable: true,
          filter: (entryPath, stat) => {
            const rel = entryPath.replace(/^\.\/?/, "");
            if (rel === "") return true;
            if (excluded(rel)) return false;
            // При упаковке с диска stat — это fs.Stats (ReadEntry бывает только при чтении tar)
            if ("isFile" in stat && stat.isFile()) {
              fileCount++;
              onFile?.(rel);
            }
            return true;
          },
        },
        ["."],
      );

      const mkdir = await this.exec(`mkdir -p ${shellQuote(remoteDir)}`);
      if (mkdir.code !== 0) {
        throw new Error(t("mkdirFailed", { stderr: mkdir.stderr }));
      }

      // Архив кладём внутрь remoteDir: очистка staging-папки убирает и его
      const remoteArchive = path.posix.join(remoteDir, ".plantar-upload.tgz");
      const sizeMb = Math.max(statSync(archive).size / 1024 / 1024, 0.1).toFixed(1);
      log?.(t("uploadingArchive", { size: sizeMb }));
      const sftp = await this.sftp();
      await new Promise<void>((resolve, reject) => {
        let nextMilestone = 25;
        sftp.fastPut(
          archive,
          remoteArchive,
          {
            step: (transferred, _chunk, total) => {
              while (total > 0 && (transferred / total) * 100 >= nextMilestone && nextMilestone < 100) {
                log?.(`  ↑ ${nextMilestone}%`);
                nextMilestone += 25;
              }
            },
          },
          (err) => (err ? reject(err) : resolve()),
        );
      });

      const extract = await this.exec(
        `tar -xzf ${shellQuote(remoteArchive)} -C ${shellQuote(remoteDir)} && rm -f ${shellQuote(remoteArchive)}`,
      );
      if (extract.code !== 0) {
        throw new Error(t("extractFailed", { stderr: extract.stderr }));
      }
      return fileCount;
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  close(): void {
    this.closed = true;
    this.client.end();
  }
}
