import { describe, expect, it } from "vitest";

import { extractPm2Json, findDomainConflicts, parseNginxSites } from "./discover";

/** Дамп nginx -T: конфиг Plantar и чужой конфиг с тем же доменом */
const dump = (foreignFile: string, foreignServerName: string) => `
# configuration file /etc/nginx/sites-enabled/myapp.conf:
server {
    listen 80;
    server_name backend.example.com;
    location / {
        proxy_pass http://127.0.0.1:3001;
    }
}
# configuration file ${foreignFile}:
server {
    listen 443 ssl;
    server_name ${foreignServerName};
    location / {
        proxy_pass http://127.0.0.1:1337;
    }
}
`;

describe("findDomainConflicts", () => {
  it("находит чужой конфиг в sites-enabled с тем же server_name", () => {
    const sites = parseNginxSites(
      dump("/etc/nginx/sites-enabled/old-backend", "backend.example.com"),
    );
    const conflicts = findDomainConflicts(sites, "backend.example.com", "myapp");
    expect(conflicts.map((site) => site.file)).toEqual([
      "/etc/nginx/sites-enabled/old-backend",
    ]);
  });

  it("не считает конфликтом собственный конфиг Plantar", () => {
    const sites = parseNginxSites(
      dump("/etc/nginx/sites-enabled/other.conf", "other.example.com"),
    );
    expect(findDomainConflicts(sites, "backend.example.com", "myapp")).toEqual([]);
  });

  it("собственный конфиг в sites-available тоже исключается", () => {
    const sites = parseNginxSites(
      dump("/etc/nginx/sites-available/myapp.conf", "backend.example.com"),
    );
    expect(findDomainConflicts(sites, "backend.example.com", "myapp")).toEqual([]);
  });

  it("catch-all («_» и wildcard) не считается конфликтом без точного совпадения", () => {
    const sites = parseNginxSites(
      dump("/etc/nginx/sites-enabled/default", "_ *.example.com"),
    );
    expect(findDomainConflicts(sites, "backend.example.com", "myapp")).toEqual([]);
  });

  it("конфликт по одному из нескольких server_name", () => {
    const sites = parseNginxSites(
      dump("/etc/nginx/sites-enabled/legacy", "www.example.com backend.example.com"),
    );
    expect(findDomainConflicts(sites, "backend.example.com", "myapp")).toHaveLength(1);
  });
});

describe("extractPm2Json", () => {
  const json = '[{"name":"app","pid":1,"pm2_env":{"status":"online"}}]';

  it("читает JSON без служебных строк", () => {
    expect(extractPm2Json(json)).toHaveLength(1);
  });

  it("пропускает баннер [PM2] перед JSON", () => {
    const stdout = `[PM2] Spawning PM2 daemon with pm2_home=/root/.pm2\n[PM2] PM2 Successfully daemonized\n${json}`;
    expect(extractPm2Json(stdout)).toHaveLength(1);
  });

  it("пустой список процессов после баннера", () => {
    expect(extractPm2Json("[PM2] PM2 Successfully daemonized\n[]")).toEqual([]);
  });

  it("вывод без JSON — пустой список", () => {
    expect(extractPm2Json("[PM2] PM2 Successfully daemonized\n")).toEqual([]);
  });
});
