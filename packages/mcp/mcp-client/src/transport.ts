/**
 * Transport factory: creates the appropriate MCP transport based on the
 * plugin's resolved config. Stdio spawns a child process (with credential
 * scrubbing); Streamable HTTP connects to a URL.
 *
 * @module
 */

import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { scrubbedParentEnv } from '@deepseek-ai/dsh-subprocess'
import type { Config, StreamableHttpConfig } from './index.ts'

/**
 * The subprocess seam's scrubbed parent env (credential-shaped and stale
 * `DSH_*` names dropped), plus the spec's explicit env. The MCP SDK owns the
 * actual spawn, so this transport shares the scrub definition rather than the
 * spawn path.
 */
function buildChildEnv(extra: Record<string, string>): Record<string, string> {
  return { ...scrubbedParentEnv(), ...extra }
}

/**
 * Resolve the request headers for a Streamable HTTP transport.
 *
 * A static object is returned unchanged (backward compatible). A function
 * resolver is invoked on every call so each reconnect re-reads a credential
 * that may have changed since startup; a throwing resolver (or one returning
 * `null`/`undefined`) falls back to empty headers so a transient read failure
 * fails the connection attempt — which the supervisor then retries — rather
 * than crashing transport construction.
 *
 * @param config - Streamable HTTP config whose `headers` may be a resolver.
 * @returns The resolved headers for this connection attempt.
 */
export function resolveHeaders(config: StreamableHttpConfig): Record<string, string> {
  if (typeof config.headers !== 'function') return config.headers
  try {
    return config.headers() ?? {}
  } catch {
    return {}
  }
}

/**
 * Create an MCP transport from the resolved plugin config.
 *
 * @param config - Resolved plugin config discriminated on `transport`.
 * @returns A connected-ready MCP Transport (stdio or Streamable HTTP).
 */
export function createTransport(config: Config): Transport {
  switch (config.transport) {
    case 'stdio':
      return new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: buildChildEnv(config.env),
        cwd: config.cwd,
      })
    case 'streamable-http':
      // The MCP SDK's StreamableHTTPClientTransport has optional callback
      // properties typed without `| undefined` (exactOptionalPropertyTypes
      // mismatch with the Transport interface); the SDK constructed the
      // object, so the cast records only that widening.
      return new StreamableHTTPClientTransport(
        new URL(config.url),
        { requestInit: { headers: resolveHeaders(config) } },
      ) as Transport
  }
}
