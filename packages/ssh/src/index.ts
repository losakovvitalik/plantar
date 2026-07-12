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

export class SshConnection {
  private closed = false;

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
   * Запускает команду и отдаёт её вывод по мере появления.
   * stop() закрывает канал — долгоживущая команда (tail -F) завершается.
   */
  execStream(command: string, handlers: ExecStreamHandlers): Promise<ExecStreamHandle> {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (err, stream) => {
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

  exec(command: string): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (err, stream) => {
        if (err) return reject(err);
        let stdout = "";
        let stderr = "";
        stream.on("data", (chunk: Buffer) => {
          stdout += chunk;
        });
        stream.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk;
        });
        stream.on("close", (code: number | null) => {
          // null — канал закрылся без exit-кода (обрыв соединения, kill по сигналу);
          // считаем это ошибкой, иначе оборванная команда выглядит успешной
          resolve({ stdout, stderr, code: code ?? -1 });
        });
      });
    });
  }

  private sftp(): Promise<SFTPWrapper> {
    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)));
    });
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
