# Agent Note: P4 — Desktop installer packaging for Windows and macOS

Status: proposed

English | [中文](2026-08-14-desktop-installer-packaging.zh.md)

## Problem

P2 yields `electron .` on a developer machine that already has Node, pnpm, and a built workspace. That is not an installer. Operators on Windows and macOS need a downloadable package that contains the Electron shell, a Node runtime, the desktop-profile plugin closure, native addons, and the frontend dist, and that starts the GUI without a system Node.

The Python SDK [single-exe pipeline](../../implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md) already materializes a symlink-free Node closure and stages `node-pty`, but its deploy root is the JSON-RPC agent, its targets omit Windows, and it produces a stdio exe rather than an Electron app.

## Proposal

Add a **desktop deploy root** and an **electron-builder** pipeline that emits platform installers.

### Contents of one install

| Piece | Source |
|---|---|
| Electron runtime + `apps/desktop` main/preload/renderer | electron-builder `app` |
| Node runtime for the Host child | platform Node matching the engines range (`^22.19 \|\| >=24`), shipped beside the app, not Electron's Node |
| Plugin closure | pnpm deploy of a new workspace manifest (pattern of `python/sdk-runtime/package.json`) whose dependencies are `dsh-base` + `dsh-desktop-app` + every package those pull |
| Frontend dist | `@deepseek-ai/dsh-web-frontend` export, extraResource |
| Native addons | `node-pty` (and Windows picker `koffi`) staged for the **Node** ABI, not Electron's |

The Host child executable is `node path/to/dsh/bin --profile desktop` using the bundled Node. Do not pkg-SEA the Host in v1 unless the Python exe closure proves easier to reuse than a directory tree; a directory extraResource is acceptable.

### Deploy manifest

New workspace package (name TBD, e.g. `dsh-desktop-runtime`) that is a zero-code dependency manifest. `scripts/verify-runtime-closure.ts` (or a desktop sibling) fails the build if a required workspace peer is missing. Adding a plugin to the installer is adding a dependency line and rebuilding.

### electron-builder

Owned by `apps/desktop`. Scripts:

- `pnpm --filter <desktop-app> run dist` builds the current platform.
- CI (P5) runs the same on native runners.

Artifacts:

| Platform | Artifact | Arch first ship |
|---|---|---|
| macOS | `.dmg` (zip optional) | arm64 |
| Windows | NSIS `.exe` | x64 |

Intel Mac and Windows arm64 are explicit follow-ups, not v1 gates. Linux AppImage is out of v1.

Build on the target OS. Do not require cross-compiling Windows from macOS for the official artifact.

### Signing in P4

P4 may emit **unsigned** (Windows) and **ad-hoc signed** (macOS, as pkg already does for the Python exe) artifacts so a developer can install locally with Gatekeeper override / SmartScreen warning. README must state that. Notarization, Developer ID, and Authenticode live in [P5](./2026-08-14-desktop-installer-release-ci.md).

### CLI / docs

Root README gains a "Desktop (preview)" subsection that links to the installer instructions once artifacts exist, without removing `npx @deepseek-ai/dsh web`. `dsh web` stays the default.

### Tests

- Closure verification gate (hygiene or the desktop build script).
- A smoke that unpacks/runs the Host child from the staged closure with `--profile desktop --help` and `--dump-config` (no window).
- Optional: launch packaged Electron once in CI (P5 may own that if P4 only stages).

### Out of scope

Auto-update, notarization, publishing GitHub Releases (P5). Slice B Electron dialogs (P3).

## Alternatives considered

**electron-packager / Forge without a written builder choice.** Either tool can work; this note picks electron-builder so P4 does not bikeshed in the implementing PR. Switching requires editing this decision.

**pkg-SEA the Host and put only the exe next to Electron.** Attractive size-wise, but pkg VFS plus Electron extraResources plus Windows is three packaging systems. v1 prefers a real `node_modules` tree the child can `import`.

**Rebuild native addons for Electron and drop the Node child.** That is the in-process model, deferred by the [product note](../architecture/2026-08-14-desktop-installer-product.md).

**Ship npm + `npx` inside the installer.** Still requires network and is not an offline desktop package.

## Acceptance criteria

- `pnpm run dist:desktop` (or the filter equivalent) on macOS arm64 produces a `.dmg` that installs an app which opens the GUI without system Node.
- The same pipeline on Windows x64 produces an NSIS `.exe` with the same property.
- The staged Host closure boots `--profile desktop --dump-config` with no webserver row.
- `verify-runtime-closure` (or sibling) is wired into the desktop build and fails if a peer is missing.
- Unsigned/ad-hoc status is documented. This note moves to `implemented/` when both platform artifacts have been produced at least once on native machines (CI may still be P5).

## Risks

Installer size will be hundreds of MB (Electron + Node + closure). That is accepted for v1; trimming belongs in a later simplification note.

Windows Defender / SmartScreen will warn on unsigned exe. If that blocks the user's "can install" goal internally, P5 signing must follow immediately.

`node-pty` spawn-helper on macOS must sit next to the bundled Node binary, as the Python exe pipeline already learned.

## Cursor prompt

Paste into a new Cursor agent:

1. Implement only P4 from `.agents/notes/proposed/process/2026-08-14-desktop-installer-packaging.md`. P2 must be able to run unpackaged. Read that note, the [product note](../architecture/2026-08-14-desktop-installer-product.md), `.agents/notes/implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md`, `scripts/build-exe-for-python-sdk.ts`, `scripts/verify-runtime-closure.ts`, `python/sdk-runtime/package.json`, and `apps/desktop`.
2. Do not implement auto-update, notarization, or GitHub Release upload. Do not switch to Host-in-Electron-main. Do not drop the Node child.
3. Add a desktop deploy-root workspace package, stage Node + closure + frontend dist, configure electron-builder for macOS dmg (arm64) and Windows NSIS (x64), and add `dist:desktop`.
4. Reuse closure verification ideas from the Python exe; do not copy-paste a second unverified deploy flag set — measure symlink-free output.
5. Update root README (both languages) with preview install steps and Gatekeeper/SmartScreen warnings. Move this note to `implemented/` when artifacts exist, plus the Chinese pair.
6. Run closure verification and `--profile desktop --help` against the staged tree. Follow `.agents/skills/dsh-pre-push-checks/SKILL.md`.
7. Do not start P5 unless signing keys are in scope in the same user request.
