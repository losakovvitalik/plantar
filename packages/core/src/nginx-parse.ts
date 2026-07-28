/**
 * Shared nginx-config parsing used by discovery (`nginx -T` dump) and by the
 * in-place edits of a foreign config. Keeping one implementation stops the
 * offer-side and execute-side matchers from drifting apart.
 */

/** Hosts that mean "this machine" in server/proxy_pass addresses */
export const LOCAL_HOST_RE = "(?:127\\.0\\.0\\.1|localhost|0\\.0\\.0\\.0)";

/**
 * Replaces comments with spaces of the same length: braces inside comments
 * must not break block matching, while every position in the cleaned text
 * still maps 1:1 onto the original — required for position-based insertion.
 */
export function blankComments(text: string): string {
  return text.replace(/#[^\n]*/g, (comment) => " ".repeat(comment.length));
}

export interface RawBlock {
  /** `<keyword> …` between the previous delimiter and the opening brace */
  header: string;
  /** Position right after the opening brace */
  open: number;
  /** Position of the closing brace; body = [open, close) */
  close: number;
}

/**
 * `<keyword> … { … }` blocks with their positions, nested braces respected.
 * Expects text already passed through blankComments.
 */
export function findBlocks(clean: string, keyword: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  const re = new RegExp(`(?:^|[\\s;{}])(${keyword}\\b[^{;]*)\\{`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(clean))) {
    const open = match.index + match[0].length;
    let depth = 1;
    let i = open;
    while (i < clean.length && depth > 0) {
      if (clean[i] === "{") depth++;
      else if (clean[i] === "}") depth--;
      i++;
    }
    blocks.push({ header: match[1].trim(), open, close: i - 1 });
    re.lastIndex = i;
  }
  return blocks;
}

/** upstream name → local ports of its servers, from the given cleaned text */
export function upstreamPorts(clean: string): Map<string, number[]> {
  const ports = new Map<string, number[]>();
  for (const block of findBlocks(clean, "upstream")) {
    const name = block.header.split(/\s+/)[1];
    if (!name) continue;
    const body = clean.slice(block.open, block.close);
    const found = [
      ...body.matchAll(new RegExp(`(?:^|\\s)server\\s+${LOCAL_HOST_RE}:(\\d+)`, "g")),
    ].map((m) => Number(m[1]));
    if (found.length > 0) ports.set(name, found);
  }
  return ports;
}

/** Local ports the block body proxies to, upstream names resolved via the map */
export function proxyPassPorts(
  body: string,
  upstreams: Map<string, number[]>,
): number[] {
  const ports: number[] = [];
  for (const m of body.matchAll(/(?:^|\s)proxy_pass\s+(https?:\/\/[^;\s]+)/g)) {
    const direct = m[1].match(new RegExp(`^https?://${LOCAL_HOST_RE}:(\\d+)`));
    if (direct) {
      ports.push(Number(direct[1]));
      continue;
    }
    const upstream = m[1].match(/^https?:\/\/([^/:]+)/);
    if (upstream) ports.push(...(upstreams.get(upstream[1]) ?? []));
  }
  return ports;
}
