import { describe, expect, it } from "vitest";
import {
  type AppHealth,
  type PendingCheck,
  type ServerMonitorState,
  detectTransitions,
  stateFromCache,
} from "./monitor-transitions";

const NONE = new Set<string>();

const state = (apps: Record<string, AppHealth>): ServerMonitorState => ({
  apps,
  unreachable: false,
});

describe("detectTransitions", () => {
  it("первый запуск без кэша: принимает наблюдение молча", () => {
    const result = detectTransitions(
      null,
      { reachable: true, apps: { a: "running", b: "stopped", c: "static" } },
      null,
      NONE,
    );
    expect(result.notifications).toEqual([]);
    expect(result.recheck).toBeNull();
    // "static" carries no health information — not part of the state
    expect(result.state).toEqual(state({ a: "up", b: "downAdopted" }));
  });

  it("первый запуск с недоступным сервером: молчание", () => {
    const result = detectTransitions(null, { reachable: false }, null, NONE);
    expect(result.notifications).toEqual([]);
    expect(result.recheck).toBeNull();
    expect(result.state.unreachable).toBe(true);
  });

  it("падение уведомляет только после подтверждающей перепроверки", () => {
    const first = detectTransitions(
      state({ a: "up" }),
      { reachable: true, apps: { a: "error" } },
      null,
      NONE,
    );
    expect(first.notifications).toEqual([]);
    expect(first.recheck).toEqual({ downCandidates: ["a"], unreachableCandidate: false });
    // Until confirmed, the state stays "up"
    expect(first.state.apps).toEqual({ a: "up" });

    const confirmed = detectTransitions(
      first.state,
      { reachable: true, apps: { a: "stopped" } },
      first.recheck,
      NONE,
    );
    expect(confirmed.notifications).toEqual([{ kind: "appDown", projectId: "a" }]);
    expect(confirmed.state.apps).toEqual({ a: "down" });
    expect(confirmed.recheck).toBeNull();
  });

  it("пока приложение лежит, повторных уведомлений нет; восстановление уведомляет", () => {
    const down = state({ a: "down" });
    const still = detectTransitions(
      down,
      { reachable: true, apps: { a: "stopped" } },
      null,
      NONE,
    );
    expect(still.notifications).toEqual([]);
    expect(still.recheck).toBeNull();

    const recovered = detectTransitions(
      down,
      { reachable: true, apps: { a: "running" } },
      null,
      NONE,
    );
    expect(recovered.notifications).toEqual([{ kind: "appUp", projectId: "a" }]);
    expect(recovered.state.apps).toEqual({ a: "up" });
  });

  it("приложение, увиденное упавшим сразу, поднимается молча", () => {
    // A project added but never deployed is "stopped" from the start: the first
    // successful deploy must not be followed by "the app works again"
    const adopted = detectTransitions(
      state({}),
      { reachable: true, apps: { fresh: "stopped" } },
      null,
      NONE,
    );
    expect(adopted.state.apps).toEqual({ fresh: "downAdopted" });

    const deployed = detectTransitions(
      adopted.state,
      { reachable: true, apps: { fresh: "running" } },
      null,
      NONE,
    );
    expect(deployed.notifications).toEqual([]);
    expect(deployed.state.apps).toEqual({ fresh: "up" });
  });

  it("флаппинг: к перепроверке приложение поднялось — уведомления нет", () => {
    const first = detectTransitions(
      state({ a: "up" }),
      { reachable: true, apps: { a: "stopped" } },
      null,
      NONE,
    );
    const confirmed = detectTransitions(
      first.state,
      { reachable: true, apps: { a: "running" } },
      first.recheck,
      NONE,
    );
    expect(confirmed.notifications).toEqual([]);
    expect(confirmed.state.apps).toEqual({ a: "up" });
    expect(confirmed.recheck).toBeNull();
  });

  it("свежее падение во время перепроверки не уведомляет — дождётся своего цикла", () => {
    const pending: PendingCheck = { downCandidates: ["a"], unreachableCandidate: false };
    const result = detectTransitions(
      state({ a: "up", b: "up" }),
      { reachable: true, apps: { a: "stopped", b: "stopped" } },
      pending,
      NONE,
    );
    expect(result.notifications).toEqual([{ kind: "appDown", projectId: "a" }]);
    // b fell between the cycle and the re-check — becomes a candidate next cycle
    expect(result.state.apps).toEqual({ a: "down", b: "up" });
  });

  it("недоступный сервер: одно уведомление после подтверждения, не «упали все»", () => {
    const prev = state({ a: "up", b: "up" });
    const first = detectTransitions(prev, { reachable: false }, null, NONE);
    expect(first.notifications).toEqual([]);
    expect(first.recheck).toEqual({ downCandidates: [], unreachableCandidate: true });
    expect(first.state).toEqual(prev);

    const confirmed = detectTransitions(prev, { reachable: false }, first.recheck, NONE);
    expect(confirmed.notifications).toEqual([{ kind: "serverUnreachable" }]);
    expect(confirmed.state.unreachable).toBe(true);
    // App states are frozen — no per-app notifications
    expect(confirmed.state.apps).toEqual({ a: "up", b: "up" });

    const still = detectTransitions(confirmed.state, { reachable: false }, null, NONE);
    expect(still.notifications).toEqual([]);
    expect(still.recheck).toBeNull();
  });

  it("сеть мигнула: к перепроверке сервер снова отвечает — молчание", () => {
    const prev = state({ a: "up" });
    const first = detectTransitions(prev, { reachable: false }, null, NONE);
    const confirmed = detectTransitions(
      prev,
      { reachable: true, apps: { a: "running" } },
      first.recheck,
      NONE,
    );
    expect(confirmed.notifications).toEqual([]);
    expect(confirmed.state).toEqual(state({ a: "up" }));
  });

  it("сервер пропал между циклом и перепроверкой приложений: кандидаты не подтверждаются", () => {
    const pending: PendingCheck = { downCandidates: ["a"], unreachableCandidate: false };
    const prev = state({ a: "up" });
    const result = detectTransitions(prev, { reachable: false }, pending, NONE);
    expect(result.notifications).toEqual([]);
    expect(result.recheck).toBeNull();
    expect(result.state).toEqual(prev);
  });

  it("после восстановления сервера упавшие за время простоя приложения идут обычным путём", () => {
    const frozen: ServerMonitorState = { apps: { a: "up", b: "down" }, unreachable: true };
    const result = detectTransitions(
      frozen,
      { reachable: true, apps: { a: "stopped", b: "stopped" } },
      null,
      NONE,
    );
    // a fell while the server was unreachable — a candidate now; b was already down
    expect(result.notifications).toEqual([]);
    expect(result.recheck).toEqual({ downCandidates: ["a"], unreachableCandidate: false });
    expect(result.state.unreachable).toBe(false);
  });

  it("во время деплоя статусы проекта не читаются и не меняют состояние", () => {
    const deploying = new Set(["a"]);
    const result = detectTransitions(
      state({ a: "up" }),
      { reachable: true, apps: { a: "stopped" } },
      null,
      deploying,
    );
    expect(result.notifications).toEqual([]);
    expect(result.recheck).toBeNull();
    expect(result.state.apps).toEqual({ a: "up" });

    // Deploy started between the cycle and the re-check — notification suppressed
    const pending: PendingCheck = { downCandidates: ["a"], unreachableCandidate: false };
    const confirm = detectTransitions(
      state({ a: "up" }),
      { reachable: true, apps: { a: "stopped" } },
      pending,
      deploying,
    );
    expect(confirm.notifications).toEqual([]);
    expect(confirm.state.apps).toEqual({ a: "up" });
  });

  it("новые проекты принимаются молча, удалённые исчезают из состояния", () => {
    const result = detectTransitions(
      state({ old: "up" }),
      { reachable: true, apps: { fresh: "stopped" } },
      null,
      NONE,
    );
    expect(result.notifications).toEqual([]);
    expect(result.recheck).toBeNull();
    expect(result.state.apps).toEqual({ fresh: "downAdopted" });
  });
});

describe("stateFromCache", () => {
  it("нет кэша — состояния нет (первый запуск)", () => {
    expect(stateFromCache(undefined)).toBeNull();
  });

  it("кэш прошлого сеанса становится базовым состоянием", () => {
    expect(stateFromCache({ a: "running", b: "unresponsive", c: "static" })).toEqual({
      apps: { a: "up", b: "downAdopted" },
      unreachable: false,
    });
  });
});
