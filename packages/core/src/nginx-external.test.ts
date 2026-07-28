import { describe, expect, it } from "vitest";
import { addAccessLogDirective } from "./nginx-external";

const LOG = "/var/log/nginx/academicals.access.log";

describe("addAccessLogDirective", () => {
  it("adds the directive to the server block that proxies to the app port", () => {
    const conf = `server {
    listen 80;
    server_name academicals.ru;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}`;
    const { content, patched } = addAccessLogDirective(conf, 3000, LOG);
    expect(patched).toBe(1);
    expect(content).toBe(`server {
    access_log ${LOG};
    listen 80;
    server_name academicals.ru;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}`);
  });

  it("patches every block that proxies to the port, skipping redirect-only blocks", () => {
    // The real academicals.ru layout: an http→https redirect block plus an
    // ssl block that actually serves the traffic
    const conf = `server {
    listen 80;
    server_name academicals.ru www.academicals.ru;
    return 301 https://academicals.ru$request_uri;
}

server {
    listen 443 ssl;
    server_name academicals.ru;
    location / {
        proxy_pass http://127.0.0.1:1337;
    }
}`;
    const { content, patched } = addAccessLogDirective(conf, 1337, LOG);
    expect(patched).toBe(1);
    // The redirect block carries no directive — redirect hits are not visits
    expect(content.indexOf(`access_log ${LOG};`)).toBeGreaterThan(
      content.indexOf("return 301"),
    );
  });

  it("leaves blocks with an existing access_log untouched", () => {
    const conf = `server {
    listen 80;
    access_log /var/log/nginx/own.log;
    location / { proxy_pass http://127.0.0.1:3000; }
}`;
    const { content, patched } = addAccessLogDirective(conf, 3000, LOG);
    expect(patched).toBe(0);
    expect(content).toBe(conf);
  });

  it("treats access_log off as an existing directive: off cancels other logs", () => {
    const conf = `server {
    listen 80;
    access_log off;
    location / { proxy_pass http://127.0.0.1:3000; }
}`;
    expect(addAccessLogDirective(conf, 3000, LOG).patched).toBe(0);
  });

  it("respects an access_log inside a nested location block", () => {
    const conf = `server {
    listen 80;
    location /api {
        access_log /var/log/nginx/api.log;
        proxy_pass http://127.0.0.1:3000;
    }
}`;
    expect(addAccessLogDirective(conf, 3000, LOG).patched).toBe(0);
  });

  it("ignores server blocks proxying to a different port", () => {
    const conf = `server {
    listen 80;
    server_name other.ru;
    location / { proxy_pass http://127.0.0.1:4000; }
}`;
    const { content, patched } = addAccessLogDirective(conf, 3000, LOG);
    expect(patched).toBe(0);
    expect(content).toBe(conf);
  });

  it("resolves the port through an upstream declared in the same file", () => {
    const conf = `upstream app_backend {
    server 127.0.0.1:3000;
}

server {
    listen 80;
    server_name academicals.ru;
    location / {
        proxy_pass http://app_backend;
    }
}`;
    const { content, patched } = addAccessLogDirective(conf, 3000, LOG);
    expect(patched).toBe(1);
    // The upstream block itself must stay untouched
    expect(content).toContain(`upstream app_backend {
    server 127.0.0.1:3000;
}`);
  });

  it("does not count braces inside comments when matching blocks", () => {
    const conf = `server {
    listen 80;
    # a stray brace } in a comment must not end the block
    location / { proxy_pass http://127.0.0.1:3000; }
}`;
    const { content, patched } = addAccessLogDirective(conf, 3000, LOG);
    expect(patched).toBe(1);
    // The comment survives byte for byte
    expect(content).toContain("# a stray brace } in a comment must not end the block");
  });

  it("does not mistake a commented-out access_log for a real one", () => {
    const conf = `server {
    listen 80;
    # access_log /var/log/nginx/old.log;
    location / { proxy_pass http://127.0.0.1:3000; }
}`;
    expect(addAccessLogDirective(conf, 3000, LOG).patched).toBe(1);
  });

  it("matches the indentation of the block's first directive", () => {
    const conf = `server {
  listen 80;
  location / { proxy_pass http://127.0.0.1:3000; }
}`;
    const { content } = addAccessLogDirective(conf, 3000, LOG);
    expect(content).toContain(`server {\n  access_log ${LOG};\n  listen 80;`);
  });

  it("changes nothing else: the original lines survive byte for byte", () => {
    const conf = `# hand-written config, odd formatting kept on purpose
server {
      listen   80 ;
    server_name    academicals.ru;
        location / {
        proxy_pass http://127.0.0.1:3000;
    }
}`;
    const { content } = addAccessLogDirective(conf, 3000, LOG);
    const inserted = `\n      access_log ${LOG};`;
    expect(content.replace(inserted, "")).toBe(conf);
  });
});
