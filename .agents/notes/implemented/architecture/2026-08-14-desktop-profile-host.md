# Agent Note: P1 — Desktop profile Host without HTTP

Status: implemented

English | [中文](2026-08-14-desktop-profile-host.zh.md)

## Problem

The shipped GUI is `dsh web`: `dsh-base` plus [`dsh-web-app`](../../../../packages/bundle/web-app/README.md), which inserts `dsh-host-webserver`, `frontend-static`, `web-startup` (`--host` / `--port`), and a `web-runtime` that prints a URL. Dual-face client packages mixed HTTP registration into construction: `dsh-client-modules` composed the boot graph only after injecting `webServer`, and `dsh-client-connection` bound `/api` the same way. Those fibers never activated without a webserver.

The [desktop product](../../proposed/architecture/2026-08-14-desktop-installer-product.md) needs the same Host business plugins and the same client roster graph, but must not listen on HTTP. `ClientModuleRegistry` already exposes `graph()` and `clientPath(id)` for a non-HTTP consumer.

## Decision

A **`desktop` profile** ships as a template whose second bundle is `@deepseek-ai/dsh-desktop-app` over `dsh-base`. `dsh desktop` is a hardcoded alias of `--profile desktop`, matching `dsh web`. First use auto-initializes from that template.

### Bundle contents

The desktop-app patch copies the web-app Host business and client roster rows (api-gateway, workspace, storage, the `dsh.client` roster, api-remotes, and the same persona/tools defaults the web bundle sets).

It does **not** insert `dsh-host-webserver`, `dsh-host-frontend-static`, `web-startup` / `--host` / `--port` / `--trusted-host`, `web-runtime` URL printing and LAN trust sampling, or `dsh-client-hmr`.

It does **not** use `directory-picker-auto`, which injects `webServer`. The patch pins `@deepseek-ai/dsh-host-directory-picker-native` on the Host and `@deepseek-ai/dsh-client-ui-directory-picker-native` as a static `dsh.client` row. Later shell wiring owns any change to that pairing.

A small **desktop-runtime** plugin owned by the desktop-app package (assembly glue, like web-runtime) takes `{surfaceContext}`: when true it registers the harness-source prompt section; it provides `desktopRuntime` as `{ surface: 'desktop' }` with no bind address and does not print a URL.

The ordinary **desktop-startup** provider parses `--help` and unknown extras as usage errors, then provides `desktopStartup` as `{}`. There are no bind flags.

### Make HTTP optional on dual-face node halves

`dsh-client-modules`: `static inject = ['loader']`. Compose the graph and provide `clientModules` regardless. Register `/plugins` and `tapIndex` only inside `ctx.inject(['webServer'], …)` so `dsh web` is unchanged when the server exists.

`dsh-client-connection`: `export const inject: string[] = []`. Always construct `HostConnectionService`. Register `/api` and upgrades only inside `ctx.inject(['webServer'], …)`.

`dsh-client-hmr` already requires `webServer`; the desktop bundle omits that row. `dsh-client-ui-theme` already optional-injects `webServer`.

### YAML startup inject for `--help`

Plugin-level `loader`-only inject is not enough to keep `--help` from scanning client bundles: `appExit` is an async shutdown, not a synchronous `process.exit`. Web-app's `modules` row therefore injects `[webStartup]`. Desktop-app's `modules` and `connection` rows inject `[desktopStartup]`. `dsh --profile desktop --help` provides nothing, so those rows stay pending.

### Composition only

This phase does not instantiate `IpcApiClient` or `HostIpcGateway`. The [IPC carrier](./2026-08-14-desktop-ipc-carrier.md) already exists; a later Electron shell consumes `ctx.clientModules.graph()` and wires that carrier. Electron, installers, and `apps/desktop` remain later phases. The web profile still mounts HTTP.

Adding a `dsh.client` row to web-app requires the same row on desktop-app until a shared roster fragment exists that both bundles can consume without HTTP rows. That fragment is not invented here.

## Alternatives considered

**Keep hard `webServer` inject and mount a stub server bound to `127.0.0.1` port 0.** Still an HTTP carrier. The desktop renderer would be one leak away from using it, and Electron would reuse the webserver.

**Fork `dsh-client-modules` into a desktop-modules package.** Duplicates graph composition, the only part desktop needs.

**Make `dsh-web-app` itself HTTP-optional via config.** Mixes two products in one bundle and makes `dsh web --dump-config` depend on a flag for rows that are the web product.

**Plugin-level inject without a YAML `desktopStartup` / `webStartup` gate.** `--help` would still activate modules and scan client bundles because shutdown is async. The YAML entry inject is what leaves the graph pending.

**Change `directory-picker-auto` so it no longer injects `webServer`.** Out of scope here; later shell wiring owns picker pairing. Pinning the native Host and UI rows avoids pulling HTTP in through auto.

## Testing

`packages/bundle/desktop-app/tests/composition.spec.ts` composes base plus desktop-app and asserts the client roster and api-gateway without `dsh-host-webserver`, `directory-picker-auto`, HMR, or a port expression. `tests/startup.spec.ts` proves `--help` and unknown `--port` leave `desktopStartup` absent. `tests/desktop-app.spec.ts` proves the runtime marker and optional harness-source section with no URL print.

`packages/client/modules/tests/node-half.client.spec.ts` and `packages/client/connection/tests/node-half.host.spec.ts` prove graph / `connection` without HTTP, while existing web tests still register routes when `webServer` is present.

`apps/cli/tests/args.spec.ts` and `packages/boot/app-boot/tests/profile.spec.ts` pin the `desktop` alias and template. `apps/cli/tests/built-bin.e2e.ts` dumps the desktop profile without a webserver row and prints `--help` without `--port`. `packages/bundle/desktop-app/tests/host-graph.e2e.ts` (built-bin-smoke, self-skips until `pnpm run build` emits client bundles) boots the desktop composition in Node and asserts the immediately-tier graph plus on-disk `clientPath` with no `webServer`.

## Consequences

Optional `webServer` on modules/connection is a load-order change: a mis-composed web overlay that forgets the webserver row now boots a Host with a silent GUI, instead of failing at inject. Web profile templates still include the webserver; a REAL-composition test for `dsh web` remains the guard.

Desktop-app will drift from web-app's roster until a shared fragment exists. `packages/client/AGENTS.md` requires every new `dsh.client` row on both bundles.

The native directory picker is pinned until later shell wiring. Operators who overlay `directory-picker-auto` onto desktop reintroduce a `webServer` inject this Host does not satisfy.

`dsh --profile desktop --dump-config` and `--help` start no server and no Electron window. A later shell reads the same graph this Host already composes.

## Related

- [Desktop product](../../proposed/architecture/2026-08-14-desktop-installer-product.md)
- [P0 IPC carrier](./2026-08-14-desktop-ipc-carrier.md)
- [P2 Electron shell](../../proposed/architecture/2026-08-14-desktop-electron-shell.md)
- [Profile plugin bundles](./2026-08-05-profile-plugin-bundles.md)
