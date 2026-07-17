import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SshConnection } from "@plantar/ssh";

import {
  APP_METRICS_SCRIPT,
  appGroupsFromChartIds,
  appMetricsGroupName,
  downsampleAverage,
  ensureAppMetricsScript,
  findAppMetricsChart,
  getAppLogActivity,
  getAppMetricsHistory,
  getServerMetrics,
} from "./monitoring";

describe("downsampleAverage", () => {
  it("усредняет точки внутри корзины и выравнивает время по её началу", () => {
    const points = [
      { time: 3610, value: 10 },
      { time: 3650, value: 20 },
      { time: 7300, value: 6 },
    ];
    expect(downsampleAverage(points, 3600)).toEqual([
      { time: 3600, value: 15 },
      { time: 7200, value: 6 },
    ]);
  });

  it("пустой ряд остаётся пустым", () => {
    expect(downsampleAverage([], 3600)).toEqual([]);
  });
});

describe("APP_METRICS_SCRIPT", () => {
  it("проходит синтаксическую проверку bash", () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "plantar-")), "app-metrics.sh");
    writeFileSync(file, APP_METRICS_SCRIPT);
    // bash -n разбирает скрипт без выполнения; ошибка синтаксиса валит тест
    expect(() => execFileSync("bash", ["-n", file])).not.toThrow();
  });
});

describe("appMetricsGroupName", () => {
  it("приводит имя pm2-процесса к формату метрики statsd", () => {
    expect(appMetricsGroupName("timestock-backend")).toBe("timestock_backend");
    expect(appMetricsGroupName("My.App 2")).toBe("my_app_2");
    expect(appMetricsGroupName("bot")).toBe("bot");
  });
});

describe("findAppMetricsChart", () => {
  // Реальная схема Netdata 1.43: суффикс «_gauge» после имени метрики
  const ids = [
    "system.cpu",
    "statsd_plantar.apps.timestock_backend_cpu_gauge",
    "statsd_plantar.apps.timestock_backend_mem_gauge",
    "statsd_plantar.apps.my_app_cpu_gauge",
  ];

  it("находит чарт по нормализованному имени метрики", () => {
    expect(findAppMetricsChart(ids, "timestock_backend", "cpu")).toBe(
      "statsd_plantar.apps.timestock_backend_cpu_gauge",
    );
    expect(findAppMetricsChart(ids, "timestock_backend", "mem")).toBe(
      "statsd_plantar.apps.timestock_backend_mem_gauge",
    );
  });

  it("не путает приложения, чьи имена оканчиваются одинаково", () => {
    // Группа "app" не должна совпасть с чартом группы "my_app"
    expect(findAppMetricsChart(ids, "app", "cpu")).toBeUndefined();
  });

  it("возвращает undefined, когда чарт ещё не появился", () => {
    expect(findAppMetricsChart(ids, "new_app", "cpu")).toBeUndefined();
  });

  it("устойчив к схеме имён без суффикса", () => {
    expect(
      findAppMetricsChart(["statsd_plantar_apps.web_cpu"], "web", "cpu"),
    ).toBe("statsd_plantar_apps.web_cpu");
  });

  it("находит чарты активности логов", () => {
    expect(
      findAppMetricsChart(
        ["statsd_plantar.apps.web_out_lines_gauge"],
        "web",
        "out_lines",
      ),
    ).toBe("statsd_plantar.apps.web_out_lines_gauge");
  });
});

/** Фейковое SSH-соединение: отвечает на curl-запросы заготовленными телами */
function fakeConn(responses: Record<string, string>, commands?: string[]): SshConnection {
  return {
    exec: (command: string) => {
      commands?.push(command);
      const key = Object.keys(responses).find((part) => command.includes(part));
      return Promise.resolve(
        key !== undefined
          ? { stdout: responses[key], stderr: "", code: 0 }
          : { stdout: "", stderr: "", code: 1 },
      );
    },
  } as unknown as SshConnection;
}

describe("appGroupsFromChartIds", () => {
  it("извлекает группы из обеих схем имён, не путая метрики и логи", () => {
    expect(
      appGroupsFromChartIds([
        "system.cpu",
        "statsd_plantar.apps.timestock_backend_cpu_gauge",
        "statsd_plantar.apps.timestock_backend_mem_gauge",
        "statsd_plantar.apps.timestock_backend_out_lines_gauge",
        "statsd_plantar_apps.web_cpu",
      ]),
    ).toEqual(["timestock_backend", "web"]);
  });

  it("пустой список чартов — пустой список групп", () => {
    expect(appGroupsFromChartIds(["system.cpu", "system.ram"])).toEqual([]);
  });
});

describe("getServerMetrics", () => {
  const system = {
    "chart=system.cpu": JSON.stringify({
      labels: ["time", "idle", "user", "system"],
      data: [
        [1020, 89.9, 7, 3],
        [990, 95, 3, 2],
      ],
    }),
    "chart=system.ram": JSON.stringify({
      labels: ["time", "free", "used", "cached", "buffers"],
      data: [
        [1020, 1000, 1219.4, 500, 300],
        [990, 1100, 1119.2, 500, 300],
      ],
    }),
  };

  it("отдаёт разбивку по приложениям: CPU в долях всех ядер, имена — из проектов", async () => {
    const conn = fakeConn({
      ...system,
      "/charts": JSON.stringify({
        charts: {
          "system.cpu": {},
          "statsd_plantar_apps.web_app_cpu": {},
          "statsd_plantar_apps.web_app_mem": {},
          "statsd_plantar_apps.db_mem": {},
        },
      }),
      nproc: "2\n",
      "chart=statsd_plantar_apps.web_app_cpu": JSON.stringify({
        labels: ["time", "gauge"],
        data: [[990, 50]],
      }),
      "chart=statsd_plantar_apps.web_app_mem": JSON.stringify({
        labels: ["time", "gauge"],
        data: [[990, 203.6]],
      }),
      "chart=statsd_plantar_apps.db_mem": JSON.stringify({
        labels: ["time", "gauge"],
        data: [[990, 512]],
      }),
    });

    const metrics = await getServerMetrics(conn, 3600, [
      { pm2Name: "Web-App", name: "Мой сайт" },
    ]);
    expect(metrics.cpu).toEqual([
      { time: 990, value: 5 },
      { time: 1020, value: 10.1 },
    ]);
    expect(metrics.ramUsed).toEqual([
      { time: 990, value: 1119 },
      { time: 1020, value: 1219 },
    ]);
    expect(metrics.ramTotalMb).toBe(3019);
    expect(metrics.apps).toEqual([
      // Группа db не добавлена в Plantar — остаётся под именем метрики
      { name: "db", cpu: [], memMb: [{ time: 990, value: 512 }] },
      {
        name: "Мой сайт",
        cpu: [{ time: 990, value: 25 }],
        memMb: [{ time: 990, value: 204 }],
      },
    ]);
  });

  it("разбивка пуста, пока чартов приложений нет", async () => {
    const conn = fakeConn({
      ...system,
      "/charts": JSON.stringify({ charts: { "system.cpu": {} } }),
    });
    const metrics = await getServerMetrics(conn, 3600);
    expect(metrics.apps).toEqual([]);
  });
});

describe("ensureAppMetricsScript", () => {
  const rewriteMarker = "cat > /usr/local/lib/plantar/app-metrics.sh";

  it("ничего не делает, пока сбор метрик не включён", async () => {
    const commands: string[] = [];
    await ensureAppMetricsScript(fakeConn({}, commands));
    expect(commands.some((c) => c.includes(rewriteMarker))).toBe(false);
  });

  it("не трогает свежий скрипт", async () => {
    const commands: string[] = [];
    const conn = fakeConn(
      {
        "test -f /etc/cron.d/plantar-app-metrics": "",
        "cat /usr/local/lib/plantar/app-metrics.sh": `${APP_METRICS_SCRIPT}\n`,
      },
      commands,
    );
    await ensureAppMetricsScript(conn);
    expect(commands.some((c) => c.includes(rewriteMarker))).toBe(false);
  });

  it("переписывает устаревший скрипт", async () => {
    const commands: string[] = [];
    const conn = fakeConn(
      {
        "test -f /etc/cron.d/plantar-app-metrics": "",
        "cat /usr/local/lib/plantar/app-metrics.sh": "#!/bin/bash\n# старая версия",
        [rewriteMarker]: "",
      },
      commands,
    );
    await ensureAppMetricsScript(conn);
    expect(commands.some((c) => c.includes(rewriteMarker))).toBe(true);
  });
});

describe("getAppMetricsHistory", () => {
  const charts = JSON.stringify({
    charts: {
      "system.cpu": {},
      "statsd_plantar_apps.web_cpu": {},
      "statsd_plantar_apps.web_mem": {},
    },
  });

  it("читает ряды cpu и памяти, отбрасывая пропуски и округляя", async () => {
    const conn = fakeConn({
      "/charts": charts,
      "chart=statsd_plantar_apps.web_cpu": JSON.stringify({
        labels: ["time", "gauge"],
        data: [
          [1010, 12.34],
          [1000, null],
          [990, 7.777],
        ],
      }),
      "chart=statsd_plantar_apps.web_mem": JSON.stringify({
        labels: ["time", "gauge"],
        data: [[1010, 203.6]],
      }),
    });

    const history = await getAppMetricsHistory(conn, "web", 3600);
    expect(history.cpu).toEqual([
      { time: 990, value: 7.8 },
      { time: 1010, value: 12.3 },
    ]);
    expect(history.memMb).toEqual([{ time: 1010, value: 204 }]);
  });

  it("возвращает пустые ряды, пока чарты приложения не появились", async () => {
    const conn = fakeConn({ "/charts": charts });
    const history = await getAppMetricsHistory(conn, "new-app", 3600);
    expect(history).toEqual({ cpu: [], memMb: [] });
  });

  it("бросает понятную ошибку, когда Netdata не отвечает", async () => {
    const conn = fakeConn({});
    await expect(getAppMetricsHistory(conn, "web", 3600)).rejects.toThrow();
  });
});

describe("getAppLogActivity", () => {
  const charts = JSON.stringify({
    charts: {
      "statsd_plantar.apps.web_out_lines_gauge": {},
      "statsd_plantar.apps.web_err_lines_gauge": {},
    },
  });

  it("склеивает потоки по часам, переводя строки-в-минуту в строки-в-час", async () => {
    const conn = fakeConn({
      "/charts": charts,
      "chart=statsd_plantar.apps.web_out_lines_gauge": JSON.stringify({
        labels: ["time", "gauge"],
        data: [
          [7200, 2.5],
          [3600, 1],
        ],
      }),
      "chart=statsd_plantar.apps.web_err_lines_gauge": JSON.stringify({
        labels: ["time", "gauge"],
        data: [[7200, 0.1]],
      }),
    });

    expect(await getAppLogActivity(conn, "web")).toEqual([
      { time: 3600, out: 60, err: 0 },
      { time: 7200, out: 150, err: 6 },
    ]);
  });

  it("возвращает пустой массив, пока чартов логов нет", async () => {
    const conn = fakeConn({ "/charts": JSON.stringify({ charts: {} }) });
    expect(await getAppLogActivity(conn, "web")).toEqual([]);
  });
});
