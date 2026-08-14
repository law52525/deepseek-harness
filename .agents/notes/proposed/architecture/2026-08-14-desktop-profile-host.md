# Agent Note: P1 — Desktop profile Host without HTTP

Status: proposed

English | [中文](2026-08-14-desktop-profile-host.zh.md)

## Problem

`dsh web` boots `dsh-base` plus [`dsh-web-app`](../../../../packages/bundle/web-app/README.md), which inserts `dsh-host-webserver`, `frontend-static`, `web-startup` (`--host` / `--port`), and a `web-runtime` that prints a URL. Dual-face client packages hard-inject that server: `dsh-client-modules` (`static inject = ['webServer', 'loader']`) registers `/plugins` and taps index.html to inject `window.__DSH_BOOT__`; `dsh-client-connection` (`inject = ['webServer']`) binds `/api` and WebSocket upgrades. Those fibers never activate without a webserver.

The desktop product needs the same Host business plugins and the same client roster graph, but [must not listen on HTTP](./2026-08-14-desktop-installer-product.md). `ClientModuleRegistry` already exposes `graph()` and `clientPath(id)` for a non-HTTP consumer; HTTP registration is mixed into construction.

## Proposal

Add a **`desktop` profile** whose second bundle is a new `@deepseek-ai/dsh-desktop-app` over `dsh-base`.

### Bundle contents

Copy the web-app rows that are Host business and client roster (api-gateway, workspace, storage, directory-picker-auto, the `dsh.client` roster, api-remotes, and the same persona/tools defaults the web bundle sets).

Do **not** insert:

- `dsh-host-webserver`
- `dsh-host-frontend-static`
- `web-startup` / `--host` / `--port` / `--trusted-host`
- `web-runtime` URL printing and LAN trust sampling
- `dsh-client-hmr` (keep disabled; desktop loads built bundles)

Insert a small **desktop-runtime** plugin owned by the desktop-app package (assembly glue, like web-runtime): config `{surfaceContext}` registers the harness-source prompt section when true, provides a `desktopRuntime` service holding nothing that implies a bind address, and does not print a URL.

### Make HTTP optional on dual-face node halves

`dsh-client-modules`: inject only `loader`. Compose the graph and provide `clientModules` regardless. Register `/plugins` and `tapIndex` only inside `ctx.inject(['webServer'], …)` so today's `dsh web` behavior is unchanged when the server exists.

`dsh-client-connection`: drop hard `inject = ['webServer']`. Register `/api` and upgrades only when `webServer` is present. The node half must still provide any Host-side RPC helper the client roster needs when HTTP is absent (if the only Host job is route registration, the fiber can be a no-op besides existing services).

`dsh-client-hmr` already requires `webServer`; the desktop bundle simply omits or disables that row. `dsh-client-ui-theme` already optional-injects `webServer`; leave it.

### Launcher

Add `dsh desktop` as an alias of `--profile desktop`, matching `dsh web`. Auto-initialize the profile from a shipped template on first use, same as web/headless. `dsh --profile desktop --help` must start no server and no Electron window.

`dsh --profile desktop --dump-config` must show no webserver row and no port expression.

### Boot graph without HTTP

desktop-runtime (or the Electron main in P2) reads `ctx.clientModules.graph()` after Loader settle. P1 proves that dump/boot in Node yields a complete graph and that `clientPath(id)` points at existing `lib/client.js` files after `pnpm run build`. P2 injects that graph into the renderer.

### P0 dependency

P1 does not instantiate `IpcApiClient`. It may import `HostIpcGateway` types only if a smoke test drives unary RPC in-process; that smoke is optional. P1 must land after or with P0 only if it wires the gateway; composition-only P1 can land in parallel with P0.

Preferred stack: P0 then P1, because P2 needs both.

### Out of scope

Electron, IPC wiring, installers, changing the Web profile's default bind.

## Alternatives considered

**Keep hard `webServer` inject and mount a stub server bound to `127.0.0.1` port 0.** Still an HTTP carrier. The desktop renderer would be one leak away from using it, and Electron would "reuse the webserver".

**Fork `dsh-client-modules` into a desktop-modules package.** Duplicates graph composition, the only part desktop needs.

**Make `dsh-web-app` itself HTTP-optional via config.** Mixes two products in one bundle and makes `dsh web --dump-config` depend on a flag for rows that are the web product.

## Acceptance criteria

- `@deepseek-ai/dsh-desktop-app` exists with `dsh.bundle.patch`, README, invariant companion, and a profile template listing `dsh-base` then `dsh-desktop-app`.
- `dsh --profile desktop --dump-config` (and `--dump-default-config`) contains the client roster and api-gateway, and does not contain `dsh-host-webserver` or a listen port.
- `dsh desktop --help` and `dsh --profile desktop --help` exit 0 without binding a port.
- Modules and connection still register HTTP routes under the web profile; existing web tests stay green.
- A Node boot of the desktop profile (no Electron) provides `ctx.clientModules.graph()` with the same immediately-tier packages as web, and `clientPath` for those ids exists on disk after build.
- When this ships, move this note to `implemented/`.

## Risks

Optional `webServer` on modules/connection is a load-order change: a mis-composed web overlay that forgets the webserver row will now boot a Host with a silent GUI, instead of failing at inject. Web profile templates must still include the webserver; a REAL-composition test for `dsh web` remains the guard.

Desktop-app will drift from web-app's roster. Document that adding a `dsh.client` row to web-app requires the same row on desktop-app until a shared roster fragment exists (do not invent that fragment in P1 unless both bundles can consume it without HTTP rows).

## Cursor prompt

Paste into a new Cursor agent:

1. Implement only P1 from `.agents/notes/proposed/architecture/2026-08-14-desktop-profile-host.md`. Read the [product note](./2026-08-14-desktop-installer-product.md), [P0](../../implemented/architecture/2026-08-14-desktop-ipc-carrier.md), `packages/bundle/web-app/cordis.patch.yml`, `packages/bundle/web-app/README.md`, `packages/client/modules/src/index.ts`, `packages/client/connection/src/index.ts`, `apps/cli/src/args.ts`, `docs/cookbook/adding-a-package.md`, `AGENTS.md`, and `packages/AGENTS.md`.
2. Do not add Electron or installer packaging. Do not remove HTTP from the web profile. Do not implement `apps/desktop`.
3. Add `@deepseek-ai/dsh-desktop-app` under `packages/bundle/desktop-app/` following the web-app bundle pattern. Register it in tsconfig, constraints, and the CLI profile templates.
4. Change modules and connection node halves so `webServer` is optional as specified. Prove web HTTP registration with existing tests; prove desktop dump-config and help with new tests.
5. If P0 has not landed, do not block on `IpcApiClient`; keep this PR composition-only.
6. Update READMEs, `apps/cli` help text, and this Agent Note (move to `implemented/` when shipped) plus the Chinese pair.
7. Do not start P2–P5.
8. Run focused bundle/CLI/modules/connection tests and the doc gates for the diff. Follow `.agents/skills/dsh-pre-push-checks/SKILL.md`.
