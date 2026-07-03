import { ChevronRight, FileKey2, Plus, Trash2 } from "lucide-react";
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
const ENV_FILE_RE = /^\.env[\w.-]*$/;

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

/** Редактор одного .env-файла (тело раскрытой секции) */
function EnvFileEditor({
  project,
  file,
  onDirtyChange,
}: {
  project: ProjectRecord;
  file: string;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [lines, setLines] = useState<EnvLine[] | null>(null);
  const [dirty, setDirtyState] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setDirty = (value: boolean) => {
    setDirtyState(value);
    onDirtyChange(value);
  };

  useEffect(() => {
    void (async () => {
      const result = await window.plantar.readEnvFile(project.id, file);
      if (result.ok) setLines(parseEnv(result.data));
      else setError(result.error);
    })();
    // загружаем один раз при монтировании секции
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return <p className="px-4 py-3 text-[12.5px] text-clay">{error}</p>;
  }
  if (lines === null) {
    return <p className="px-4 py-3 text-[12.5px] text-ink-soft">Читаю файл…</p>;
  }

  function update(index: number, patch: Partial<{ key: string; value: string }>) {
    setLines((prev) =>
      prev!.map((l, i) => (i === index && l.type === "var" ? { ...l, ...patch } : l)),
    );
    setDirty(true);
  }

  function removeLine(index: number) {
    setLines((prev) => prev!.filter((_, i) => i !== index));
    setDirty(true);
  }

  function addVar() {
    setLines((prev) => [...prev!, { type: "var", key: "", value: "" }]);
    setDirty(true);
  }

  async function save() {
    const result = await window.plantar.writeEnvFile(project.id, file, serializeEnv(lines!));
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDirty(false);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 2000);
  }

  const varCount = lines.filter((l) => l.type === "var").length;

  return (
    <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
      {varCount === 0 && (
        <p className="text-[13px] text-ink-soft">Файл пуст — добавь первую переменную.</p>
      )}
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

      <div className="mt-1 flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={addVar}>
          <Plus />
          Добавить переменную
        </Button>
        <Button size="sm" onClick={save} disabled={!dirty}>
          Сохранить
        </Button>
        {savedFlash && <span className="text-[12.5px] font-semibold text-moss">Сохранено ✓</span>}
        {dirty && !savedFlash && (
          <span className="text-[12.5px] text-ink-soft">не сохранено</span>
        )}
      </div>
    </div>
  );
}

interface Props {
  project: ProjectRecord;
}

export function EnvTab({ project }: Props) {
  const [files, setFiles] = useState<string[] | null>(null);
  /** Раскрытые секции; однажды открытая остаётся смонтированной, чтобы не терять правки */
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState<Set<string>>(new Set());
  const [dirtyFiles, setDirtyFiles] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState(".env");
  const [error, setError] = useState<string | null>(null);

  const loadFiles = useCallback(async () => {
    const result = await window.plantar.listEnvFiles(project.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setFiles(result.data);
  }, [project.id]);

  useEffect(() => {
    setFiles(null);
    setOpen(new Set());
    setMounted(new Set());
    setDirtyFiles(new Set());
    setAdding(false);
    setError(null);
    void loadFiles();
  }, [loadFiles]);

  function toggle(file: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
    setMounted((prev) => new Set(prev).add(file));
  }

  function setFileDirty(file: string, dirty: boolean) {
    setDirtyFiles((prev) => {
      const next = new Set(prev);
      if (dirty) next.add(file);
      else next.delete(file);
      return next;
    });
  }

  const newNameValid = ENV_FILE_RE.test(newName) && !(files ?? []).includes(newName);

  async function createFile() {
    if (!newNameValid) return;
    const result = await window.plantar.writeEnvFile(project.id, newName, "");
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAdding(false);
    const created = newName;
    setNewName(".env");
    await loadFiles();
    toggle(created);
  }

  if (files === null && !error) {
    return <p className="text-[13px] text-ink-soft">Ищу env-файлы…</p>;
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <p className="rounded-lg bg-moss/8 px-3 py-2 text-[12.5px] leading-snug text-moss-deep">
        Переменные подставляются при сборке. Чтобы изменения попали на сайт — сохрани и задеплой
        проект заново. Файлы остаются на этом компьютере.
      </p>

      {error && (
        <p className="rounded-lg bg-clay/10 px-3 py-2 text-[12.5px] leading-snug whitespace-pre-wrap text-clay">
          {error}
        </p>
      )}

      <div className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        {files && files.length === 0 && !adding && (
          <div className="flex flex-col items-center py-10 text-center">
            <FileKey2 className="size-8 text-[#b8bfb8]" />
            <h3 className="mt-3 text-[15px] font-bold">В проекте нет .env-файлов</h3>
            <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-soft">
              Переменные окружения подставляются в приложение при сборке — например, адрес API
              или публичные ключи сервисов.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {(files ?? []).map((file) => {
            const isOpen = open.has(file);
            return (
              <div key={file} className="rounded-xl border border-line bg-card">
                <button
                  onClick={() => toggle(file)}
                  className="flex w-full items-center gap-2.5 rounded-xl px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-moss/50"
                >
                  <ChevronRight
                    className={`size-4 shrink-0 text-ink-soft/60 transition-transform ${isOpen ? "rotate-90" : ""}`}
                  />
                  <span className="font-mono text-[13px] font-medium">{file}</span>
                  {dirtyFiles.has(file) && (
                    <span
                      className="size-1.5 rounded-full bg-amber"
                      title="Есть несохранённые изменения"
                    />
                  )}
                </button>
                {mounted.has(file) && (
                  <div className={isOpen ? "" : "hidden"}>
                    <EnvFileEditor
                      project={project}
                      file={file}
                      onDirtyChange={(d) => setFileDirty(file, d)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {adding ? (
          <div className="mt-3 flex items-center gap-2">
            <Input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createFile()}
              placeholder=".env.production"
              className="w-64 font-mono text-[12.5px]"
            />
            <Button size="sm" onClick={createFile} disabled={!newNameValid}>
              Создать
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Отмена
            </Button>
            {!newNameValid && newName && (
              <span className="text-[12.5px] text-ink-soft">
                {(files ?? []).includes(newName)
                  ? "такой файл уже есть"
                  : "имя должно начинаться с .env"}
              </span>
            )}
          </div>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)} className="mt-3">
            <Plus />
            Добавить файл
          </Button>
        )}
      </div>
    </div>
  );
}
