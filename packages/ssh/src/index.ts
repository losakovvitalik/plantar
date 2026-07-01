import { readFileSync } from "node:fs";
import { Client } from "ssh2";

export interface ConnectOptions {
  host: string;
  port?: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class SshConnection {
  private constructor(private client: Client) {}

  static connect(options: ConnectOptions): Promise<SshConnection> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      client
        .on("ready", () => resolve(new SshConnection(client)))
        .on("error", reject)
        .connect({
          host: options.host,
          port: options.port ?? 22,
          username: options.username,
          password: options.password,
          privateKey: options.privateKeyPath
            ? readFileSync(options.privateKeyPath)
            : undefined,
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

  listDirectories(path: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) return reject(err);
        sftp.readdir(path, (err, list) => {
          if (err) return reject(err);
          resolve(
            list
              .filter((entry) => entry.attrs.isDirectory())
              .map((entry) => entry.filename)
              .sort(),
          );
        });
      });
    });
  }

  close(): void {
    this.client.end();
  }
}
