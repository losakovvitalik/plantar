import { randomUUID } from "node:crypto";
import { logStreamCommand } from "@plantar/core";
import { readSettings, saveServerLogSnapshot } from "@plantar/storage";
import type { IpcEventMap } from "../../shared/ipc";
import { withServer } from "../connections";
import { logStreams } from "../log-streams";
import { getProject, getServer, projectConfig } from "../records";
import { activeWindow } from "../window";
import { handle, sendToWindow, toResult } from "./util";

export function registerLogsIpc(): void {
  handle(
    "logs:streamStart",
    (_e, args) =>
      toResult(async () => {
        const project = getProject(args.projectId);
        const server = getServer(project.serverId);
        // Имя могли поменять в plantar.json — берём актуальное, с фолбэком
        let name = project.name;
        try {
          name = projectConfig(project).name;
        } catch {
          /* plantar.json недоступен — используем имя на момент добавления */
        }
        // Импортированное приложение пишет логи по своим путям, пока Plantar
        // не пересоздаст процесс при первом деплое
        const external = project.external;
        const logPaths =
          external && args.source === "app" && external.outLogPath && external.errLogPath
            ? { out: external.outLogPath, err: external.errLogPath }
            : external && args.source === "nginx"
              ? {
                  out: external.accessLogPath ?? "/var/log/nginx/access.log",
                  err: external.errorLogPath ?? "/var/log/nginx/error.log",
                }
              : undefined;

        const streamId = randomUUID();
        const send = <C extends keyof IpcEventMap>(channel: C, payload: IpcEventMap[C]) => {
          const win = activeWindow();
          if (win) sendToWindow(win, channel, payload);
        };
        // Просмотренные nginx-логи сохраняются локально при закрытии стрима (настройка)
        const snapshot =
          args.source === "nginx" && readSettings().saveServerLogCopies
            ? { access: "", error: "" }
            : null;
        const collect = (kind: "access" | "error", text: string) => {
          if (snapshot) snapshot[kind] = (snapshot[kind] + text).slice(-512_000);
        };

        await new Promise<void>((started, failed) => {
          // Внутренний промис резолвится при закрытии стрима — до этого соединение занято
          withServer(server, args.password, (conn) =>
            new Promise<void>((closed) => {
              conn
                .execStream(logStreamCommand(args.source, name, 200, logPaths), {
                  onStdout: (text) => {
                    collect("access", text);
                    send("logs:stream-data", { streamId, channel: "out", text });
                  },
                  onStderr: (text) => {
                    collect("error", text);
                    send("logs:stream-data", { streamId, channel: "err", text });
                  },
                  onClose: () => {
                    logStreams.delete(streamId);
                    if (snapshot) {
                      // Best-effort: a failed write inside an ssh2 event callback
                      // has no catcher above and would crash the main process.
                      // Each write on its own so one failure does not skip the other.
                      for (const kind of ["access", "error"] as const) {
                        try {
                          saveServerLogSnapshot(name, kind, snapshot[kind]);
                        } catch (snapshotErr) {
                          console.error("plantar: failed to save server log snapshot", snapshotErr);
                        }
                      }
                    }
                    send("logs:stream-end", { streamId });
                    closed();
                  },
                })
                .then((handle) => {
                  logStreams.set(streamId, handle.stop);
                  started();
                })
                .catch((err) => {
                  closed();
                  failed(err);
                });
            }),
          ).catch(failed);
        });
        return { streamId };
      }),
  );

  handle("logs:streamStop", (_e, streamId) =>
    toResult(async () => {
      logStreams.get(streamId)?.();
    }),
  );
}
