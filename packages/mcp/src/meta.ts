/**
 * Endpoint constants shared with the GUI. This module is intentionally pure
 * (no Node imports) so the renderer can import it via the `@plantar/mcp/meta`
 * subpath without dragging Node-only code into the browser bundle — the same
 * pattern as `@plantar/core/paths`.
 */

/** Default port of the local MCP endpoint; the listener binds to 127.0.0.1 only */
export const MCP_PORT = 43917;

export const MCP_PATH = "/mcp";

/** The URL an AI agent connects to (streamable HTTP transport) */
export function mcpEndpointUrl(port: number = MCP_PORT): string {
  return `http://127.0.0.1:${port}${MCP_PATH}`;
}
