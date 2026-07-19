import { build } from "esbuild";

// Собирает CLI в один самодостаточный файл для публикации в npm:
// workspace-пакеты и зависимости попадают внутрь бандла, поэтому у
// опубликованного пакета нет runtime-зависимостей. Снаружи остаются
// только опциональные нативные модули ssh2 — их require обёрнут в
// try/catch, без них ssh2 работает на чистом JS.
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.cjs",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  banner: { js: "#!/usr/bin/env node" },
  external: ["cpu-features", "*.node"],
  logLevel: "info",
});
