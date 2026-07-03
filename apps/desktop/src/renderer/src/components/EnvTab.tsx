import { FileKey2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ProjectRecord } from "../../../preload/index.d";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

/**
 * Построчная модель .env: переменные редактируются,
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
}

export function EnvTab({ project }: Props) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [lines, setLines] = useState<EnvLine[]>([]);
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFiles = useCallback(async () => {
    const result = await window.plantar.listEnvFiles(project.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setFiles(result.data);
    setSelected(result.data.includes(".env") ? ".env" : (result.data[0] ?? null));
  }, [project.id]);

  useEffect(() => {
    setFiles(null);
    setSelected(null);
    setError(null);
    setDirty(false);
    void loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    if (!selected) {
      setLines([]);
      return;
    }
    void (async () => {
      const result = await window.plantar.readEnvFile(project.id, selected);
      if (result.ok) {
        setLines(parseEnv(result.data));
        setDirty(false);
        setError(null);
      } else {
        setError(result.error);
      }
    })();
  }, [project.id, selected]);

  function update(index: number, patch: Partial<{ key: string; value: string }>) {
    setLines((prev) =>
      prev.map((l, i) => (i === index && l.type === "var" ? { ...l, ...patch } : l)),
    );
    setDirty(true);
  }

  function removeLine(index: number) {
    setLines((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  }

  function addVar() {
    setLines((prev) => [...prev, { type: "var", key: "", value: "" }]);
    setDirty(true);
  }

  async function save() {
    if (!selected) return;
    const result = await window.plantar.writeEnvFile(project.id, selected, serializeEnv(lines));
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDirty(false);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2000);
  }

  async function createEnvFile() {
    const result = await window.plantar.writeEnvFile(project.id, ".env", "");
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await loadFiles();
  }

  if (files !== null && files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-sm text-center">
          <FileKey2 className="mx-auto size-8 text-ink-soft/40" />
          <h3 className="mt-3 text-[15px] font-bold">В проекте нет .env-файлов</h3>
          <p className="mt-1.5 mb-4 text-[13px] leading-relaxed text-ink-soft">
            Переменные окружения подставляются в приложение при сборке — например, адрес API или
            публичные ключи сервисов.
          </p>
          <Button onClick={createEnvFile}>Создать .env</Button>
        </div>
      </div>
    );
  }

  const varCount = lines.filter((l) => l.type === "var").length;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center gap-3">
        {files && files.length > 1 && (
          <select
            value={selected ?? ""}
            onChange={(e) => setSelected(e.target.value)}
            className="h-8 rounded-lg border border-line bg-card px-2 font-mono text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-moss/40"
          >
            {files.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        )}
        {files && files.length === 1 && (
          <span className="font-mono text-[12.5px] text-ink-soft">{files[0]}</span>
        )}

        <Button onClick={save} disabled={!dirty} size="sm">
          Сохранить
        </Button>
        {savedFlash && <span className="text-[12.5px] font-semibold text-moss">Сохранено ✓</span>}
        {dirty && !savedFlash && (
          <span className="text-[12.5px] text-ink-soft">есть несохранённые изменения</span>
        )}
      </div>

      <p className="rounded-lg bg-moss/8 px-3 py-2 text-[12.5px] leading-snug text-moss-deep">
        Переменные подставляются при сборке. Чтобы изменения попали на сайт — сохрани и задеплой
        проект заново. Файл остаётся на этом компьютере.
      </p>

      {error && (
        <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap text-clay">
          {error}
        </p>
      )}

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        {varCount === 0 && (
          <p className="py-2 text-[13px] text-ink-soft">Файл пуст — добавь первую переменную.</p>
        )}
        <div className="flex flex-col gap-2">
          {lines.map((line, i) =>
            line.type === "var" ? (
              <div key={i} className="group flex items-center gap-2">
                <Input
                  value={line.key}
                  onChange={(e) => update(i, { key: e.target.value })}
                  placeholder="ИМЯ_ПЕРЕМЕННОЙ"
                  className="w-64 font-mono text-[12.5px]"
                />
                <span className="text-ink-soft/50">=</span>
                <Input
                  value={line.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                  placeholder="значение"
                  className="flex-1 font-mono text-[12.5px]"
                />
                <button
                  onClick={() => removeLine(i)}
                  title="Удалить переменную"
                  className="rounded-md p-1.5 text-ink-soft/50 opacity-0 outline-none group-hover:opacity-100 hover:bg-clay/10 hover:text-clay focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-moss/50"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            ) : null,
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={addVar} className="mt-3">
          <Plus />
          Добавить переменную
        </Button>
      </div>
    </div>
  );
}
