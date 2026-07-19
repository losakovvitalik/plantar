import {
  Eye,
  EyeOff,
  FileKey2,
  Import,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { ProjectRecord, ServerRecord } from "../../../preload/index.d";
import { useI18n } from "../i18n";
import { canConnectSilently, passwordFor } from "../lib/server-auth";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/**
 * Построчная модель env-файла: переменные редактируются,
 * комментарии и пустые строки сохраняются как есть.
 */
type EnvLine =
  | { type: "var"; key: string; value: string }
  | { type: "raw"; text: string };

const VAR_RE = /^([A-Za-z_][A-Za-z0-9_.]*)\s*=(.*)$/;

function parseEnv(content: string): EnvLine[] {
  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop(); // файл заканчивается \n — не плодим пустые строки
  return lines.map((line) => {
    const match = line.trim().startsWith("#") ? null : line.match(VAR_RE);
    return match
      ? { type: "var" as const, key: match[1], value: match[2] }
      : { type: "raw" as const, text: line };
  });
}

function serializeEnv(lines: EnvLine[]): string {
  const out = lines
    .map((l) => (l.type === "var" ? `${l.key}=${l.value}` : l.text))
    .join("\n");
  return out ? out + "\n" : "";
}

interface Props {
  project: ProjectRecord;
  server: ServerRecord;
  askPassword: (server: ServerRecord) => Promise<string | null>;
}

export function EnvTab({ project, server, askPassword }: Props) {
  const { t } = useI18n();
  const [lines, setLines] = useState<EnvLine[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Индексы строк, значения которых раскрыты вручную */
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [showAll, setShowAll] = useState(false);
  /** Локальные .env-файлы в папке проекта — предлагаются для импорта */
  const [localFiles, setLocalFiles] = useState<string[]>([]);

  async function load() {
    if (dirty && !window.confirm(t("env.confirmDiscard"))) return;
    const password = await passwordFor(server, askPassword);
    if (password === null) return;
    setLoading(true);
    setError(null);
    const result = await window.plantar.readEnv(project.id, password);
    setLoading(false);
    if (result.ok) {
      setLines(parseEnv(result.data));
      setDirty(false);
      setRevealed(new Set());
    } else {
      setError(result.error);
    }
  }

  useEffect(() => {
    void window.plantar.listLocalEnvFiles(project.id).then((result) => {
      if (result.ok) setLocalFiles(result.data);
    });
    // Без запроса пароля (ключ или живое соединение) — грузим сразу, иначе по кнопке
    void canConnectSilently(server).then((ok) => {
      if (ok) void load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    const password = await passwordFor(server, askPassword);
    if (password === null) return;
    setSaving(true);
    setError(null);
    const result = await window.plantar.writeEnv(
      project.id,
      serializeEnv(lines!),
      password,
    );
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDirty(false);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 3000);
  }

  function update(
    index: number,
    patch: Partial<{ key: string; value: string }>,
  ) {
    setLines((prev) =>
      prev!.map((l, i) =>
        i === index && l.type === "var" ? { ...l, ...patch } : l,
      ),
    );
    setDirty(true);
  }

  function removeLine(index: number) {
    setLines((prev) => prev!.filter((_, i) => i !== index));
    // Индексы строк после удалённой сдвигаются — пересчитываем раскрытые
    setRevealed(
      (prev) =>
        new Set(
          [...prev]
            .filter((i) => i !== index)
            .map((i) => (i > index ? i - 1 : i)),
        ),
    );
    setDirty(true);
  }

  function toggleReveal(index: number) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function addVar() {
    setLines((prev) => [...(prev ?? []), { type: "var", key: "", value: "" }]);
    setDirty(true);
  }

  /**
   * Вставка многострочного текста в поле строки разбирается как env-файл:
   * переменные добавляются отдельными строками (пустая строка заменяется,
   * иначе вставка идёт после текущей). Однострочная вставка работает как обычно.
   */
  function pasteEnv(index: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (!text.includes("\n")) return;
    const pasted = parseEnv(text);
    if (!pasted.some((l) => l.type === "var")) return;
    e.preventDefault();
    const current = lines![index];
    const replaceEmpty =
      current.type === "var" && !current.key && !current.value;
    const at = replaceEmpty ? index : index + 1;
    setLines((prev) => {
      const next = [...prev!];
      next.splice(at, replaceEmpty ? 1 : 0, ...pasted);
      return next;
    });
    // Индексы строк после точки вставки сдвигаются — пересчитываем раскрытые
    const shift = pasted.length - (replaceEmpty ? 1 : 0);
    setRevealed(
      (prev) => new Set([...prev].map((i) => (i >= at ? i + shift : i))),
    );
    setDirty(true);
  }

  async function importLocal(file: string) {
    const result = await window.plantar.readLocalEnvFile(project.id, file);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const imported = parseEnv(result.data).filter((l) => l.type === "var");
    if (imported.length === 0) {
      setError(t("env.noVarsInFile", { file }));
      return;
    }
    setLines((prev) => [...(prev ?? []), ...imported]);
    setDirty(true);
  }

  const varCount = (lines ?? []).filter((l) => l.type === "var").length;

  return (
    <div className="flex h-full flex-col gap-4">
      <p className="rounded-lg bg-moss/8 px-3 py-2 text-[12.5px] leading-snug text-moss-deep">
        {/* Внешний проект: переменные живут в .env его папки, а не в хранилище Plantar */}
        {project.external ? t("env.bannerExternal") : t("env.banner")}
      </p>

      {error && (
        <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap text-clay">
          {error}
        </p>
      )}

      {lines === null ? (
        loading ? (
          <p className="text-[13px] text-ink-soft">{t("env.loading")}</p>
        ) : (
          <div>
            <Button onClick={load} variant="outline" size="sm">
              <RefreshCw />
              {t("env.load")}
            </Button>
            {server.auth === "password" && (
              <p className="mt-2 text-[12.5px] text-ink-soft">
                {t("env.passwordNeeded")}
              </p>
            )}
          </div>
        )
      ) : (
        <>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={addVar}>
              <Plus />
              {t("env.addVar")}
            </Button>
            <Button size="sm" onClick={save} disabled={!dirty || saving}>
              {saving ? t("common.saving") : t("common.save")}
            </Button>
            {savedFlash && (
              <span className="text-[12.5px] font-semibold text-moss">
                {t("env.savedFlash")}
              </span>
            )}
            {dirty && !savedFlash && (
              <span className="text-[12.5px] text-ink-soft">
                {t("env.unsaved")}
              </span>
            )}
            {varCount > 0 && (
              <div className="ml-auto flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={load}
                  disabled={loading}
                  className="text-ink-soft"
                  title={t("env.refreshTitle")}
                >
                  <RefreshCw className={cn(loading && "animate-spin")} />
                  {t("env.refresh")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAll((v) => !v)}
                  className="text-ink-soft"
                >
                  {showAll ? <EyeOff /> : <Eye />}
                  {showAll ? t("env.hideAll") : t("env.showAll")}
                </Button>
              </div>
            )}
          </div>

          <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
            {varCount === 0 && (
              <div className="flex flex-col items-center py-10 text-center">
                <FileKey2 className="size-8 text-[#b8bfb8]" />
                <h3 className="mt-3 text-[15px] font-bold">
                  {t("env.emptyTitle")}
                </h3>
                <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-soft">
                  {t("env.emptyHint")}
                </p>
                {localFiles.length > 0 && (
                  <div className="mt-4 flex flex-col items-center gap-2">
                    <p className="text-[12.5px] text-ink-soft">
                      {t("env.importHint")}
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {localFiles.map((file) => (
                        <Button
                          key={file}
                          variant="outline"
                          size="sm"
                          onClick={() => importLocal(file)}
                          className="font-mono text-[12.5px]"
                        >
                          <Import />
                          {file}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2">
              {(lines ?? []).map((line, i) => {
                if (line.type !== "var") return null;
                const isRevealed = showAll || revealed.has(i);
                return (
                  <div key={i} className="group flex items-center gap-2">
                    <Input
                      value={line.key}
                      onChange={(e) => update(i, { key: e.target.value })}
                      onPaste={(e) => pasteEnv(i, e)}
                      placeholder={t("env.keyPlaceholder")}
                      className="w-64 font-mono text-[12.5px]"
                    />
                    <span className="text-ink-soft/50">=</span>
                    <Input
                      value={line.value}
                      onChange={(e) => update(i, { value: e.target.value })}
                      onPaste={(e) => pasteEnv(i, e)}
                      placeholder={t("env.valuePlaceholder")}
                      className="flex-1 font-mono text-[12.5px]"
                      autoComplete="off"
                      style={
                        isRevealed
                          ? undefined
                          : ({
                              WebkitTextSecurity: "disc",
                            } as React.CSSProperties)
                      }
                    />
                    <button
                      onClick={() => toggleReveal(i)}
                      disabled={showAll}
                      title={
                        isRevealed ? t("env.hideValue") : t("env.showValue")
                      }
                      className="rounded-md p-1.5 text-ink-soft/50 outline-none hover:bg-moss/10 hover:text-ink disabled:pointer-events-none disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-moss/50"
                    >
                      {isRevealed ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </button>
                    <button
                      onClick={() => removeLine(i)}
                      title={t("env.removeVar")}
                      className="rounded-md p-1.5 text-ink-soft/50 opacity-0 outline-none group-hover:opacity-100 hover:bg-clay/10 hover:text-clay focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-moss/50"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
