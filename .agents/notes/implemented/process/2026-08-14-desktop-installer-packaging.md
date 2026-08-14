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

Owned by `apps/desktop` (`electron-builder.yml`). `pnpm run dist:desktop` is the supported entry (verify, build, stage, smoke, pack). `pnpm --filter @deepseek-ai/dsh-desktop run dist` runs only electron-builder against an already staged tree. `electron` is a `devDependency` of `apps/desktop`: electron-builder 26 refuses it under `dependencies`; unpackaged `electron .` still launches through that devDependency. The pack uses `resources/icon.png` (1024×1024 raster of the Harness favicon's light-scheme fill `#000`); electron-builder derives `.icns` / `.ico` from it. The live SVG switches black/white with `prefers-color-scheme`; a packaged icon is one raster. `files` omit `node_modules`, so tsdown `alwaysBundle` inlines `electron-updater` and `@deepseek-ai/dsh-desktop-app/ipc-protocol`; a leftover package import in `lib/main.js` / `lib/preload.js` fails the pack.

extraResources copies `apps/desktop/stage/` as a whole. electron-builder's `createFilter` always drops a copy-root `node_modules`, so `from: stage/host` would omit the Host closure. After pack, the installer script requires `host/node_modules/@deepseek-ai/dsh/lib/bin.js` and `frontend/index.html` in the unpacked extraResources. The script runs `tsx`, `electron-builder`, and pnpm as `node` plus a JavaScript entry (`tsx/dist/cli.mjs`, `electron-builder/cli.js`, `npm_execpath`); Windows cannot spawn `.cmd` shims (CVE-2024-27980), and `shell: true` space-joins args unescaped (DEP0190). Host `desktop-app` references `packages/client/ui-theme/tsconfig.host.json` so `tsc -b tsconfig.host.json` typechecks theme settings without compiling that package's Client half, which imports `/remote` modules Host tsdown has not generated yet.

| Platform | Artifact | Arch |
|---|---|---|
| macOS | `.dmg` | arm64 |
| Windows | NSIS `.exe` | x64 |

Build on the target OS. Intel Mac, Windows arm64, and Linux AppImage are not v1. Artifacts land in `apps/desktop/dist/`.

Unsigned `pnpm run dist:desktop` passes electron-builder identity `-` (ad-hoc). Windows keeps `signAndEditExecutable: true` so rcedit writes the Harness icon into the exe and shortcuts; Authenticode still does not run because unsigned packs set `CSC_IDENTITY_AUTO_DISCOVERY=false`. NSIS is an assisted installer (`oneClick: false`, `allowToChangeInstallationDirectory: true`). [P5](./2026-08-14-desktop-installer-release-ci.md) notarizes the arm64 `.dmg` (Developer ID plus nested Host `node` and `node-spawn-helper`) and publishes GitHub Releases; Windows stays unsigned (no Authenticode). The staged tree is the desktop deploy root plus copied Node, not the repository root; a gitignored `.env` is not an extraResource.

## Alternatives considered

**electron-packager / Forge without a written builder choice.** Either tool can work; this note picks electron-builder so P4 does not bikeshed in the implementing PR. Switching requires editing this decision.

**pkg-SEA the Host and put only the exe next to Electron.** Attractive size-wise, but pkg VFS plus Electron extraResources plus Windows is three packaging systems. v1 prefers a real `node_modules` tree the child can `import`.

**Rebuild native addons for Electron and drop the Node child.** That is the in-process model, deferred by the [product note](../architecture/2026-08-14-desktop-installer-product.md).

**Ship npm + `npx` inside the installer.** Still requires network and is not an offline desktop package.

## Consequences

Installer size is hundreds of MB (Electron + Node + closure). That is accepted for v1; trimming belongs in a later simplification note.

Windows Defender / SmartScreen warns on the unsigned exe. Gatekeeper blocks the ad-hoc macOS app from `dist:desktop` until the user opens it from Finder. [P5](./2026-08-14-desktop-installer-release-ci.md) notarization is the Mac path on GitHub Releases; Windows remains unsigned with that warning documented.

The bundled Node is the builder's `process.execPath`, ABI-matched to staged native addons. The Desktop Release workflow uses `actions/setup-node` so CI Node matches staged native addons.

`dsh web` remains the default developer-preview entry in the root README.

## Testing

`scripts/runtime-closure.spec.ts` and `scripts/stage-runtime-closure.spec.ts` pin missing-peer failure, symlink materialization, restoring pnpm workspace state after deploy, and pnpm/package-bin spawn as `process.execPath` plus a JavaScript entry (never a `.cmd` shim). `apps/desktop/tests/packaged-paths.spec.ts` pins extraResources resolution. `apps/desktop/tests/packager-icon.spec.ts` pins `resources/icon.png` as a 1024 PNG, the electron-builder `icon` field, `signAndEditExecutable: true`, and NSIS `oneClick: false`. `apps/desktop/tests/host-child.spec.ts` pins Host spawn `windowsHide: true`. `scripts/desktop-shell-bundle.spec.ts` pins leftover `dsh-desktop-app` / `electron-updater` imports as a pack failure. `scripts/build-desktop-installer.spec.ts` pins the host OS target, `pnpm run` `--` forwarding, unpacked extraResources paths, and the workspace `tsx` / `electron-builder` JS bins. The installer script smokes `--help` and `--dump-config` against the staged tree before electron-builder, then requires the Host bin and frontend `index.html` in the unpacked extraResources. [P5](./2026-08-14-desktop-installer-release-ci.md) packs signed macOS and unsigned Windows on the Desktop Release workflow; packaged Electron GUI launch remains a named gap.
