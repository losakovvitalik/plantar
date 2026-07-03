import { useState } from "react";
import type { ServerInfo } from "@plantar/core";
import type { ConnectionParams } from "../../preload/index.d";

export default function App() {
  const [form, setForm] = useState<ConnectionParams>({
    host: "",
    port: "22",
    user: "root",
    keyPath: "~/.ssh/id_ed25519",
    password: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<ServerInfo | null>(null);

  const set = (field: keyof ConnectionParams) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm({ ...form, [field]: e.target.value });

  async function checkServer(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setInfo(null);
    const result = await window.plantar.getServerInfo(form);
    setLoading(false);
    if (result.ok) {
      setInfo(result.data);
    } else {
      setError(result.error);
    }
  }

  return (
    <div className="app">
      <h1>Plantar</h1>

      <form className="card" onSubmit={checkServer}>
        <h2>Сервер</h2>
        <div className="grid">
          <label>
            Адрес
            <input value={form.host} onChange={set("host")} placeholder="1.2.3.4" required />
          </label>
          <label>
            Порт
            <input value={form.port} onChange={set("port")} />
          </label>
          <label>
            Пользователь
            <input value={form.user} onChange={set("user")} required />
          </label>
          <label>
            Путь к SSH-ключу
            <input value={form.keyPath} onChange={set("keyPath")} />
          </label>
          <label>
            Пароль (если без ключа)
            <input type="password" value={form.password} onChange={set("password")} />
          </label>
        </div>
        <button type="submit" disabled={loading || !form.host}>
          {loading ? "Подключаюсь…" : "Проверить сервер"}
        </button>
      </form>

      {error && <div className="card error">{error}</div>}

      {info && (
        <div className="card">
          <h2>
            {info.os.pretty}{" "}
            <span className={info.supported ? "badge ok" : "badge fail"}>
              {info.supported ? "поддерживается" : "не поддерживается"}
            </span>
          </h2>
          <p>
            CPU: {info.cpuCores} · RAM: {info.memoryTotalMb} МБ · Свободно на диске:{" "}
            {info.diskFreeRootGb} ГБ
          </p>
          <h3>Инструменты</h3>
          <ul className="tools">
            {Object.entries(info.tools).map(([tool, version]) => (
              <li key={tool}>
                <span className={version ? "dot ok" : "dot fail"} />
                <strong>{tool}</strong> {version ?? "не установлен"}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
