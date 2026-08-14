# Agent Note: P4 — Desktop installer packaging for Windows and macOS

Status: implemented

English | [中文](2026-08-14-desktop-installer-packaging.zh.md)

## Problem

P2 yields `electron .` on a developer machine that already has Node, pnpm, and a built workspace. That is not an installer. Operators on Windows and macOS need a downloadable package that contains the Electron shell, a Node runtime, the desktop-profile plugin closure, native addons, and the frontend dist, and that starts the GUI without a system Node.

The Python SDK [single-exe pipeline](../architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md) already materializes a symlink-free Node closure and stages `node-pty`, but its deploy root is the JSON-RPC agent, its targets omit Windows, and it produces a stdio exe rather than an Electron app.

## Decision

`pnpm run dist:desktop` (`scripts/build-desktop-installer.ts`) stages a **desktop deploy root** and runs **electron-builder** for the host OS.

### Contents of one install

| Piece | Source |
|---|---|
| Electron runtime + `apps/desktop` main/preload | electron-builder `app` (`lib/main.js`, `lib/preload.js`) |
| Node runtime for the Host child | the builder's Node (`process.execPath`), copied into extraResources `host/` |
| Plugin closure | pnpm deploy of [`desktop-runtime/package.json`](../../../../desktop-runtime/package.json) (`dsh-desktop-runtime`) |
| Frontend dist | `@deepseek-ai/dsh-web-frontend` export, extraResources `frontend/` |
| Native addons | `node-pty` (and Windows picker `koffi`) staged for the **Node** ABI, not Electron's |

The Host child is `host/node node_modules/@deepseek-ai/dsh/lib/bin.js --profile desktop` using the bundled Node. The Host is a directory extraResource, not a pkg-SEA exe. Unpackaged `electron .` still uses system Node.

### Deploy manifest

`dsh-desktop-runtime` is a zero-code workspace manifest whose dependencies are `@deepseek-ai/dsh`, `@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-desktop-app`, and every workspace package those pull. Adding a plugin to the installer is adding a dependency line and rebuilding. [`scripts/verify-runtime-closure.ts`](../../../../scripts/verify-runtime-closure.ts) checks this manifest and `python/sdk-runtime/package.json`; `pnpm run hygiene` and the desktop build run it before packaging.

### Staging

[`scripts/stage-runtime-closure.ts`](../../../../scripts/stage-runtime-closure.ts) owns the measured pnpm deploy flags from the Python exe (`--legacy --prod --config.node-linker=hoisted --config.auto-install-peers=false --config.link-workspace-packages=true`), restores legacy hoists, replaces remaining package links with files, and fails if any symlink remains. After deploy it writes back `node_modules/.pnpm-workspace-state-v1.json`: those flags otherwise persist `production: true` and `nodeLinker: hoisted` into the workspace, and the next `pnpm run dist:desktop` executes `pnpm install --production` and deletes `tsx`. The desktop builder then copies Node, and on macOS copies `node-pty`'s `spawn-helper` next to that binary as `node-spawn-helper`. A smoke boots the staged tree with `--profile desktop --help` and `--dump-config` and requires no webserver row.

### electron-builder

Owned by `apps/desktop` (`electron-builder.yml`). `pnpm run dist:desktop` is the supported entry (verify, build, stage, smoke, pack). `pnpm --filter @deepseek-ai/dsh-desktop run dist` runs only electron-builder against an already staged tree. `electron` is a `devDependency` of `apps/desktop`: electron-builder 26 refuses it under `dependencies`; unpackaged `electron .` still launches through that devDependency.

extraResources copies `apps/desktop/stage/` as a whole. electron-builder's `createFilter` always drops a copy-root `node_modules`, so `from: stage/host` would omit the Host closure. After pack, the installer script requires `host/node_modules/@deepseek-ai/dsh/lib/bin.js` and `frontend/index.html` in the unpacked extraResources. The script runs `electron-builder` and `tsx` from `node_modules/.bin`.

| Platform | Artifact | Arch |
|---|---|---|
| macOS | `.dmg` | arm64 |
| Windows | NSIS `.exe` | x64 |

Build on the target OS. Intel Mac, Windows arm64, and Linux AppImage are not v1. Artifacts land in `apps/desktop/dist/`.

macOS uses electron-builder identity `-` (ad-hoc). Windows sets `signAndEditExecutable: false`. Notarization, Developer ID, Authenticode, GitHub Releases, and auto-update remain [P5](../../proposed/process/2026-08-14-desktop-installer-release-ci.md).

## Alternatives considered

**electron-packager / Forge without a written builder choice.** Either tool can work; this note picks electron-builder so P4 does not bikeshed in the implementing PR. Switching requires editing this decision.

**pkg-SEA the Host and put only the exe next to Electron.** Attractive size-wise, but pkg VFS plus Electron extraResources plus Windows is three packaging systems. v1 prefers a real `node_modules` tree the child can `import`.

**Rebuild native addons for Electron and drop the Node child.** That is the in-process model, deferred by the [product note](../../proposed/architecture/2026-08-14-desktop-installer-product.md).

**Ship npm + `npx` inside the installer.** Still requires network and is not an offline desktop package.

## Consequences

Installer size is hundreds of MB (Electron + Node + closure). That is accepted for v1; trimming belongs in a later simplification note.

Windows Defender / SmartScreen warns on the unsigned exe. Gatekeeper blocks the ad-hoc macOS app until the user opens it from Finder. If that blocks an internal "can install" goal, P5 signing must follow immediately.

The bundled Node is the builder's `process.execPath`, ABI-matched to staged native addons. Portable official binaries are a P5 CI concern (`actions/setup-node`).

`dsh web` remains the default developer-preview entry in the root README.

## Testing

`scripts/runtime-closure.spec.ts` and `scripts/stage-runtime-closure.spec.ts` pin missing-peer failure, symlink materialization, and restoring pnpm workspace state after deploy. `apps/desktop/tests/packaged-paths.spec.ts` pins extraResources resolution. `scripts/build-desktop-installer.spec.ts` pins the host OS target, `pnpm run` `--` forwarding, and unpacked extraResources paths. The installer script smokes `--help` and `--dump-config` against the staged tree before electron-builder, then requires the Host bin and frontend `index.html` in the unpacked extraResources. Packaged Electron launch in CI remains [P5](../../proposed/process/2026-08-14-desktop-installer-release-ci.md).
