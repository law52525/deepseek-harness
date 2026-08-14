# Agent Note: P2 — Electron shell, preload, BootSeams, and boot manifest

Status: implemented

English | [中文](2026-08-14-desktop-electron-shell.zh.md)

## Problem

P0 supplies an IPC carrier. [P1](./2026-08-14-desktop-profile-host.md) supplies a Host profile with a client graph and no HTTP. Nothing yet creates a window, loads `dsh-web-frontend` dist, injects `window.__DSH_BOOT__`, or fetches plugin bundles. The Web shell kernel [`AppWebEntry`](../../../../packages/client/web/README.md) expects that manifest on `window` and loads plugins via `<script src="/plugins/…">`. `file://` origin is `'null'`, classic script tags cannot use the Host's `/plugins` routes (there are none), and `WebApiClient` would call `globalThis.fetch` against that null origin.

`BootSeams.loadBundle` already replaces script arrival for jsdom tests. The connection client `apply` constructed `WebApiClient` unless `?fixture` was set.

## Decision

**`apps/desktop`** (`@deepseek-ai/dsh-desktop`) is the Electron application assembly. It is not a capability package. `pnpm run dev:desktop` runs `pnpm run build` then `electron .`. Production packaging is [P4](../../proposed/architecture/2026-08-14-desktop-installer-product.md).

### Process model

Electron main spawns a system-Node child (`npm_node_execpath`, `NODE_BINARY`, or `PATH` `node` — never `process.execPath` when that is Electron, never `ELECTRON_RUN_AS_NODE`) with `stdio: ['ignore', 'inherit', 'inherit', 'ipc']` and `windowsHide: false`. Argv is `dsh --profile desktop` (source `tsx` launcher when `apps/cli/src/bin.ts` exists, else the built bin). The child runs [`HostIpcGateway`](./2026-08-14-desktop-ipc-carrier.md) inside `@deepseek-ai/dsh-desktop-app/ipc-host`. Main is a dumb forwarder: renderer ↔ preload ↔ main ↔ child. RPC payloads stay opaque JSON on the `rpc` channel; main never parses bodies.

The child posts `host-ready` after `loader.await()` (or immediately when no Loader is present). A terminal `dsh desktop` has no parent IPC channel, so `ipc-host` is a no-op and P1 CLI behavior is unchanged.

On quit, main aborts in-flight IPC handlers, SIGTERM the child, waits, then SIGKILL if needed. A child crash loads an error page; the window is not left attached to a dead port.

### Control versus RPC

Process IPC uses `DesktopIpcEnvelope` in `@deepseek-ai/dsh-desktop-app/ipc-protocol`: `{ channel: 'rpc', payload }` or `{ channel: 'control', payload }`. Control documents are `host-ready`, `boot-graph-request` / `boot-graph-response` (graph plus `themePreference`), and `plugin-bytes-request` / `plugin-bytes-response` / `plugin-bytes-failure`. Plugin bytes come only from `ctx.clientModules.clientPath(id)` inside the composed table, never from a renderer-supplied path.

### Preload and renderer

`contextIsolation: true`, `nodeIntegration: false`. Preload exposes `window.__DSH_IPC_PORT__` (`IpcPort` post/subscribe only) and `window.__DSH_DESKTOP__` (`bootGraph`, `readPlugin` via `ipcRenderer.invoke`). No general `ipcRenderer.send` of arbitrary channels from the page.

The renderer reuses `dsh-web-frontend` dist. Main registers a privileged `dsh:` scheme (`standard`, `secure`, `supportFetchAPI`) and serves that dist at `dsh://app/` so Vite's `/assets/…` URLs keep working without changing the web `base`. `apps/web/src/main.ts` branches on `__DSH_DESKTOP__`: it sets `window.__DSH_BOOT__` from the Host graph, applies the pre-plugin theme without importing `ui-theme`, and runs `new AppWebEntry(el, { loadBundle })`. `loadBundle` maps `/plugins/<id>/client.js?rev=…` to `readPlugin(id)` and evaluates the factory the same way jsdom assembled boot does.

### Connection client

When `window.__DSH_IPC_PORT__` has `post` and `subscribe`, `dsh-client-connection` client `apply` constructs `IpcApiClient` and passes `IpcApiClient.fetch` into generic Connection RPC so `file:` / `dsh:` pages do not hit `globalThis.fetch`. `?fixture` still wins. Absence of the port keeps `WebApiClient` for `dsh web`. `isLoopback` is true when the port is present, when `location.protocol` is `file:`, or when the hostname is loopback.

## Alternatives considered

**Renderer `loadURL('http://127.0.0.1:<port>')`.** Forbids the product rule and skips BootSeams work that a non-HTTP origin requires anyway.

**`nodeIntegration: true` and require Host modules in the renderer.** Drops process isolation and would not run the browser client plugins.

**In-process Host in Electron main.** Pulls native addon ABI into the first window. The product note deferred that.

**A second Vite app that statically bundles every client plugin.** Breaks the host-authored graph and HMR model; desktop would fork the loading architecture the rest of the GUI uses.

**`loadFile` of `index.html` with `base: './'`.** Would require a Vite `base` change that `dsh web` also consumes. The privileged `dsh://app` origin keeps `/assets` absolute paths.

## Testing

Unit tests cover the RPC forwarder (payload identity, no body decode), `loadBundle` factory eval, theme DOM fields, `dsh:` path mapping, Node-vs-Electron resolution, `ipc-host` no-op without `process.send`, host-ready / boot-graph / plugin-bytes / RPC against `HostIpcGateway`, and connection-client selection of `IpcApiClient` plus `file:` / IPC loopback.

`apps/desktop/tests/host-child.spec.ts` pairs `DesktopHostChild` with `attachDesktopIpcHost` over an in-memory child: `host.describe` and boot-graph succeed without Electron. `apps/desktop/tests/host-child.e2e.ts` spawns a real `--profile desktop` child (self-skips until client bundles exist) and asserts host-ready, boot-graph, `host.describe`, and both downlink streams.

**Electron e2e in CI is a named gap.** There is no Playwright Electron suite in this phase. jsdom plus a Node child prove the seams; `pnpm run dev:desktop` is the developer-machine window check.

## Consequences

Plugin bytes evaluated in the renderer are a trusted-path equivalent of serving `/plugins`. They must come only from `clientPath` inside the packaged closure.

`location.origin` under `dsh://app` is not `'null'`, but generic RPC still uses `IpcApiClient.fetch` with `http://dsh.internal` so the page origin never becomes an HTTP hop.

Two-process ready handshake uses an explicit `host-ready` document, not stdout scraping.

Native directory picker stays the Node `-native` pair. [P3](./2026-08-14-desktop-native-shell-capabilities.md) proves `host.pickDirectory` and `host.openPath` through the child's IPC. Child spawn keeps `windowsHide: false` so a Windows dialog can still appear.

## Related

- [Desktop product](../../proposed/architecture/2026-08-14-desktop-installer-product.md)
- [P0 IPC carrier](./2026-08-14-desktop-ipc-carrier.md)
- [P1 desktop profile Host](./2026-08-14-desktop-profile-host.md)
- [P3 native shell capabilities](./2026-08-14-desktop-native-shell-capabilities.md)
