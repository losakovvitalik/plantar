const express = require("express");

const app = express();
const port = process.env.PORT || 3000;
const startedAt = new Date().toISOString();

// Лог каждого запроса — чтобы видеть живой поток во вкладке «Логи»
app.use((req, _res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
  next();
});

app.get("/", (_req, res) => {
  res.send(
    `<h1>Plantar node demo</h1><p>PORT=${port}, запущено: ${startedAt}</p>`,
  );
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, startedAt });
});

app.listen(port, () => {
  console.log(`node-demo-app слушает порт ${port}`);
});
