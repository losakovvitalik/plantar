import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { Client, type SFTPWrapper } from "ssh2";

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

export class SshConnection {
  private constructor(
    private client: Client,
    readonly host: string,
  ) {}

  static connect(options: ConnectOptions): Promise<SshConnection> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      client
        .on("ready", () => resolve(new SshConnection(client, options.host)))
        .on("error", reject)
        .connect({
          host: options.host,
          port: options.port ?? 22,
          username: options.username,
          password: options.password,
          privateKey:
            options.privateKey ??
            (options.privateKeyPath ? readFileSync(options.privateKeyPath) : undefined),
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
          resolve({ stdout, stderr, code: code ?? 0 });
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
   * Рекурсивно загружает содержимое localDir в remoteDir.
   * Возвращает количество загруженных файлов.
   */
  async uploadDirectory(
    localDir: string,
    remoteDir: string,
    onFile?: (relativePath: string) => void,
  ): Promise<number> {
    const entries = readdirSync(localDir, { recursive: true, withFileTypes: true });

    const toPosix = (p: string) => p.split(path.sep).join(path.posix.sep);
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => toPosix(path.join(path.relative(localDir, e.parentPath), e.name)));
    const files = entries
      .filter((e) => e.isFile())
      .map((e) => toPosix(path.join(path.relative(localDir, e.parentPath), e.name)));

    const mkdirTargets = [remoteDir, ...dirs.map((d) => path.posix.join(remoteDir, d))];
    const mkdir = await this.exec(
      `mkdir -p ${mkdirTargets.map((d) => `'${d}'`).join(" ")}`,
    );
    if (mkdir.code !== 0) {
      throw new Error(`Не удалось создать директории на сервере: ${mkdir.stderr}`);
    }

    const sftp = await this.sftp();
    for (const file of files) {
      await new Promise<void>((resolve, reject) => {
        sftp.fastPut(
          path.join(localDir, file),
          path.posix.join(remoteDir, file),
          (err) => (err ? reject(err) : resolve()),
        );
      });
      onFile?.(file);
    }
    return files.length;
  }

  close(): void {
    this.client.end();
  }
}
