# Agent Note: P2 — Electron shell, preload, BootSeams, and boot manifest

Status: proposed

English | [中文](2026-08-14-desktop-electron-shell.zh.md)

## Problem

P0 supplies an IPC carrier. [P1](../../implemented/architecture/2026-08-14-desktop-profile-host.md) supplies a Host profile with a client graph and no HTTP. Nothing yet creates a window, loads `dsh-web-frontend` dist, injects `window.__DSH_BOOT__`, or fetches plugin bundles. The Web shell kernel [`AppWebEntry`](../../../../packages/client/web/README.md) expects that manifest on `window` and loads plugins via `<script src="/plugins/…">`. `file://` origin is `'null'`, classic script tags cannot use the Host's `/plugins` routes (there are none), and `WebApiClient` would call `globalThis.fetch` against that null origin.

`BootSeams.loadBundle` already replaces script arrival for jsdom tests. The connection client `apply` always constructs `WebApiClient` unless `?fixture` is set.

## Proposal

Add **`apps/desktop`**: the Electron application assembly. It is not a capability package.

### Main process

- Spawn the Node Host child with the `desktop` profile (dev: `pnpm dsh --profile desktop` / source launcher; packaged: the bundled Node entry from P4).
- Wait until the child is ready (a single IPC handshake: child posts `host-ready` after Loader settle).
- Create `BrowserWindow` with `contextIsolation: true`, `nodeIntegration: false`, preload script.
- `loadFile` the built `dsh-web-frontend` `index.html`.
- On quit, abort in-flight RPC, dispose the Host child, then exit. Follow [defensive patterns](../../../../docs/defensive-patterns.md) for subprocess teardown.

The main process adapts Electron IPC + the child's process IPC to `IpcPort` and runs `HostIpcGateway` **in the child** (the child owns `ctx.apiProxy`). Main is a dumb forwarder: renderer ↔ main ↔ child. Do not reimplement RPC in main.

### Preload

Expose a structured `IpcPort` via `contextBridge` (post/subscribe only, no `require`, no filesystem). No general `ipcRenderer.send` of arbitrary channels from the page.

### Renderer boot

A thin `main.ts` (or the existing web entry with a desktop flag) runs `new AppWebEntry(el, { loadBundle }).run()`:

- Before boot, set `window.__DSH_BOOT__` from the Host graph (preload request `boot-graph` → child `ctx.clientModules.graph()`).
- `loadBundle(url)` maps `/plugins/<id>/client.js?rev=…` to an IPC read of `clientPath(id)` bytes, then evaluates the factory the same way the jsdom seam does in `apps/web/tests/assembled-boot.ts`.
- Inject initial theme without `tapIndex` (read preference over a unary RPC or pass it beside the boot graph). `ui-theme`'s HTTP tap simply does not run.

### Connection client

When the preload seam is present (name it `window.__DSH_IPC_PORT__` implementing `IpcPort`), `dsh-client-connection` client `apply` constructs `IpcApiClient` instead of `WebApiClient`. `?fixture` still wins. Absence of the seam keeps `WebApiClient` for `dsh web`.

Treat `file://` as loopback for `isLoopback` so native-only UI (directory picker, open-in-folder) stays enabled.

### Dev versus packaged

Development: from repo root, `pnpm run dev:desktop` builds or reuses frontend dist, starts Electron, and spawns the source `dsh --profile desktop` child. Production packaging is P4; P2 only needs `electron .` to work on a developer machine with Node and `pnpm run build`.

### Tests

- Unit: preload/main forwarder does not decode RPC bodies (binary-safe enough for JSON strings); `loadBundle` evaluates a fixture factory.
- Keyless assembled smoke: Electron or a jsdom stand-in that uses `IpcApiClient` + `HostIpcGateway` + desktop profile and asserts the loading page settles. A full Playwright Electron suite may wait for P4 if launching Electron in CI is not yet wired; P2 must then prove the seam with jsdom plus a Node child, and name the Electron e2e gap.

### Out of scope

electron-builder, code signing, auto-update, Electron `dialog.showOpenDialog` (P3), WebView file preview.

## Alternatives considered

**Renderer `loadURL('http://127.0.0.1:<port>')`.** Forbids the product rule and skips BootSeams work that `file://` requires anyway.

**`nodeIntegration: true` and require Host modules in the renderer.** Drops process isolation and would not run the browser client plugins.

**In-process Host in Electron main in P2.** Pulls native addon ABI into the first window. The product note deferred that.

**A second Vite app that statically bundles every client plugin.** Breaks the host-authored graph and HMR model; desktop would fork the loading architecture the rest of the GUI uses.

## Acceptance criteria

- `apps/desktop` starts a window on macOS (developer machine) that shows the real GUI shell against a desktop-profile child, without printing or binding a webserver port.
- Plugin bundles arrive through `BootSeams.loadBundle`, not `<script src="/plugins/…">` over HTTP.
- Unary `host.describe` and both downlink streams work through `IpcApiClient`.
- `dsh web` still uses `WebApiClient` and HTTP; web e2e/replay stays green.
- Window close disposes the child; a child crash surfaces an error page rather than a zombie window with a dead IPC port.
- This note moves to `implemented/` when the above is true, recording whether Electron e2e runs in CI or remains a named gap.

## Risks

`file://` plus `eval`/script injection of plugin bytes is a trusted-path equivalent of serving `/plugins`. Those bytes must come only from `clientPath` inside the packaged closure, never from the workspace.

`location.origin === 'null'` must not disable loopback UI. Tests must pin `isLoopback === true` under the IPC seam.

Two-process ready handshake can deadlock if the child logs instead of posting `host-ready`. Use an explicit message, not stdout scraping.

## Cursor prompt

Paste into a new Cursor agent:

1. Implement only P2 from `.agents/notes/proposed/architecture/2026-08-14-desktop-electron-shell.md`. P0 and P1 must already be on the branch. Read those notes, the [product note](./2026-08-14-desktop-installer-product.md), `packages/client/web/src/boot.tsx`, `packages/client/connection/src/client/index.ts`, `apps/web/tests/assembled-boot.ts`, `packages/client/modules/src/index.ts` (`graph`, `clientPath`), `docs/defensive-patterns.md`, `AGENTS.md`, and `packages/client/AGENTS.md`.
2. Do not add electron-builder, signing, or auto-update. Do not bind `dsh-host-webserver` in the desktop profile. Do not implement P3 WebView preview.
3. Create `apps/desktop` with Electron main, preload `IpcPort`, child spawn of `--profile desktop`, `AppWebEntry` + `loadBundle`, and connection-client selection of `IpcApiClient` via `window.__DSH_IPC_PORT__`.
4. `contextIsolation: true`, `nodeIntegration: false`. Main forwards IPC; `HostIpcGateway` runs in the Node child.
5. Add tests named in Acceptance criteria. Prefer jsdom/Node proofs if Electron CI is not ready; document the gap in this note when moving it to `implemented/`.
6. Update READMEs and bilingual Agent Notes. Do not start P3–P5 except for interfaces P3 will hook (leave TODOs out of product UI).
7. Run focused tests plus any `test:web` replay if connection-client behavior changed. Follow `.agents/skills/dsh-pre-push-checks/SKILL.md`.
