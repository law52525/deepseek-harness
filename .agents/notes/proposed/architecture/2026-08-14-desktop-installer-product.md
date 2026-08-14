# Agent Note: Desktop product — Electron shell over a Node Host

Status: proposed

English | [中文](2026-08-14-desktop-installer-product.zh.md)

## Problem

The shipped GUI is `dsh web`: a Node Host plus a browser page at a loopback HTTP URL. Operators who want a Windows or macOS application must install Node, run a CLI, and keep a browser tab attached to that process. The Web UI is not a static site; without the Host it cannot open sessions, read the workspace, or run tools. Wrapping only the Vite dist therefore cannot produce a desktop product.

The [GUI layering note](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md) already reserves an Electron client that reuses `packages/client/*` and does not reuse `dsh-host-webserver`. No such application, profile, or installer pipeline exists. The JSON IPC carrier lives in `dsh-host-apiproxy` ([P0](../../implemented/architecture/2026-08-14-desktop-ipc-carrier.md)). The Python SDK [single-exe pipeline](../../implemented/architecture/2026-07-10-single-file-executable-sdk-runtime-distribution.md) packages a Node runtime closure for linux-x64, linux-arm64, and macos-arm64; it is a headless JSON-RPC peer, not a GUI shell, and Windows is a non-goal there.

## Proposal

Ship DeepSeek Harness as a desktop application whose window renders the existing Web UI and whose Host is a real Node process, then produce macOS `.dmg` and Windows `.exe` (NSIS) installers from that application.

### Process model

The first ship uses **two processes**:

1. **Electron shell** — `BrowserWindow`, preload, IPC to the renderer, auto-update from GitHub Releases (P5).
2. **Node Host child** — boots a new `desktop` profile over `dsh-base`, with no HTTP listener.

Native addons (`node-pty`, Windows directory-picker `koffi`) stay on Node's ABI. Rebuilding them for Electron's Node is a later convergence, not a ship gate. The renderer never talks HTTP to a user-visible port; every RPC and downlink frame crosses IPC.

In-process Host-in-Electron-main remains allowed as a later simplification once addon ABI is proven. It must not block installer delivery.

### What this product reuses

- `dsh-base` and the Web client roster (`packages/client/*`, `dsh-web-frontend` dist).
- `dsh-host-apiproxy` envelopes, `AbstractApiClient`, and `toFetchHandler`.
- Native directory picking and `host.openPath` as they already run in Node.
- Runtime-closure discipline from the Python SDK deploy root: one manifest names the packaged plugin set.

### What this product must not do

- Package only the frontend dist.
- Load `http://127.0.0.1:3080` in `BrowserWindow` as the shipped carrier.
- Introduce a parallel `packages/electron-*` UI family.
- Use Tauri or a non-Node Host.
- Replace or weaken `dsh web`.
- Pack a developer-machine root `.env` or `DEEPSEEK_API_KEY` into the installer; the model key is saved in Settings after first launch.

### Phase map

Implement in this order. Each phase has its own Agent Note. One Cursor session implements one phase unless that phase's note names an allowed overlap.

| Phase | Note | Delivers |
|---|---|---|
| P0 | [IPC carrier](../../implemented/architecture/2026-08-14-desktop-ipc-carrier.md) | Message protocol, `IpcApiClient`, host gateway, tests with no Electron |
| P1 | [Desktop profile](../../implemented/architecture/2026-08-14-desktop-profile-host.md) | `desktop` profile, Host without HTTP, optional `webServer` on dual-face plugins |
| P2 | [Electron shell](../../implemented/architecture/2026-08-14-desktop-electron-shell.md) | `apps/desktop`, preload, `BootSeams.loadBundle`, boot-manifest injection |
| P3 | [Native shell capabilities](../../implemented/architecture/2026-08-14-desktop-native-shell-capabilities.md) | Wire picker and path-open through the shell; WebView preview stays deferred |
| P4 | [Installer packaging](../../implemented/process/2026-08-14-desktop-installer-packaging.md) | electron-builder, Node closure including Windows, `.dmg` / `.exe` |
| P5 | [Release CI](../process/2026-08-14-desktop-installer-release-ci.md) | macOS notarization, unsigned Windows, GitHub Releases, auto-update |

P3 may overlap P4 after P2. P4 may start after P2; the first installer may keep the existing Node native picker. P5 starts after P4 produces unsigned artifacts.

### Done

On a clean Windows x64 machine and a clean macOS arm64 machine, with no system Node:

1. The user installs the shipped package (`.exe` / `.dmg`).
2. The application window opens the existing GUI.
3. The user can add a workspace, save a model key, and start a session.

The installer must not contain a developer `DEEPSEEK_API_KEY`. Step 3 is the first time a model key is stored.

`dsh web` remains the default developer-preview entry in the root README until a later product decision promotes the installer.

## Alternatives considered

**Electron wrapping `dsh web`'s loopback URL.** Fastest spike, and it keeps today's HTTP trust fence. It makes the desktop product inherit ports, LAN trust, browser connection limits, and index.html taps, against the layering rule that Electron does not reuse the webserver.

**Host inside Electron main in v1.** Matches the layering checklist's "zero ports" ideal, but `node-pty` and Windows `koffi` must rebuild for Electron's ABI on every Electron upgrade. That risk dominates installer delivery.

**Tauri or a Rust Host.** The agent loop, tools, sandbox, and client plugin loader are Node plugins. A second runtime would fork every seam.

**pkg single-exe that still opens the system browser.** Removes the Node install step but is not a desktop application and does not use the reserved Electron client.

**A new electron-named package family for UI.** Rejected in the layering note: products share host/client capabilities; assembly lives in `apps/`.

## Acceptance criteria

- Six phase notes exist and this note remains the product decision until the installer ships, at which point this file moves to `implemented/` with the process model that actually shipped.
- No phase adds a user-visible HTTP URL as the desktop carrier.
- After P5, a notarized macOS arm64 `.dmg` and an explicitly unsigned Windows x64 `.exe` exist on GitHub Releases and satisfy the Done section.

## Risks

Two-process lifetime (crash of the child, orphan windows, shutdown ordering) is new relative to `dsh web`. P2 must dispose the Host before quitting.

The packaged plugin closure will drift from `dsh-web-app` if the desktop deploy manifest is edited by hand. P4 must generate or verify that closure the same way `verify-runtime-closure` gates the Python exe.

Developer preview still breaks compatibility. Until P5 ships auto-update from GitHub Releases, operators stay on stale bits; P4 README must say so. Auto-update must replace the whole app so extraResources is never half-written.

## Cursor prompt

Use this prompt in a new Cursor agent to author or revise the phase notes, not to implement code:

1. Read `AGENTS.md`, `docs/architecture.md`, `docs/AGENTS.md`, `.agents/notes/README.md`, and this note plus every phase note linked from the phase map.
2. Do not implement P0–P5 in the same session as an edit to these notes unless the user names one phase.
3. Keep the process model, the reuse list, and the forbidden list. Change them only by editing this note's Proposal and Alternatives considered.
4. After any edit, update the Chinese counterpart in the same change and run `pnpm run verify-translation-pairing --write` on each touched pair, then `pnpm run verify-agent-note-format` and `pnpm run verify-md-links`.
