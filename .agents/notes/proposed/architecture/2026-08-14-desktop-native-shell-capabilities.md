# Agent Note: P3 — Native capabilities on the desktop shell

Status: proposed

English | [中文](2026-08-14-desktop-native-shell-capabilities.zh.md)

## Problem

The GUI already picks directories and opens paths through Host RPCs. [`directory-picker-native`](../../../../packages/host/directory-picker-native/README.md) runs OS choosers in the Node process (`osascript`, Windows `IFileOpenDialog`, Linux Zenity/KDialog). [`host.openPath`](../../../../packages/host/apiproxy/README.md) hands files to the OS. Both are gated as privileged / loopback operations.

The [picker seam note](../../implemented/architecture/2026-07-28-directory-picker-capability-seam.md) says an Electron shell may provide the `native` interaction through its own dialog API as another dual-face backend, without gateway or ui-workspace edits. The [workspace file-link note](../../implemented/feature/2026-07-31-web-workspace-file-links.md) records an embedded WebView as the right isolation for in-product file preview and explicitly defers that to the desktop shell.

P2's Node child can already call the existing native picker. The first installer does not need Electron dialogs. P3 exists so the shell owns platform UX where Electron is strictly better, and so preview work has a recorded home rather than growing inside the Web carrier.

## Proposal

Land P3 in two slices. Only slice A is required before P4.

### Slice A — required: confirm Node native ops through IPC

Through the running desktop shell:

- `host.pickDirectory` opens the existing Node native chooser (not the in-app browse modal) and returns a path or cancel.
- `host.openPath` / produced-file "open" uses the existing opener.
- `isLoopback` remains true so those actions stay visible.
- Cancellation of pick (Escape / abort) maps to the existing `null` cancel result.

No new package if the auto picker already selected `native` for a local desktop. If auto-detection treats the Electron-spawned child as headless, pin `directory-picker-native` in the desktop-app patch.

### Slice B — optional before P4: Electron dialog provider

Add `@deepseek-ai/dsh-host-directory-picker-electron` as a dual-face backend: Host `pick` calls `dialog.showOpenDialog` in the **Electron main** process (the child asks main over the dumb forwarder; main never parses RPC envelopes). Client half is the same renderless occupant pattern as `-native`. Compose it from the desktop bundle instead of `-native` when slice B ships.

Do not edit ui-workspace. Do not add a kind besides `native` / `browse`.

### Deferred: WebView preview

Not in the first installer. When scheduled, a later note owns a `BrowserView` / `webContents` that loads `file://` workspace documents without sharing the GUI renderer origin. Until then, open-in-OS remains the preview.

### Out of scope

Installers, auto-update, replacing `host.openPath` for non-desktop profiles.

## Alternatives considered

**Block P4 until Electron dialogs ship.** The Node chooser already works on macOS and Windows. Installer delivery does not wait on a second picker.

**Serve workspace files over HTTP for preview.** Rejected for the Web product; do not revive it for desktop.

**Let the renderer call Electron `dialog` directly.** Would require exposing extra preload APIs and bypass the picker seam.

## Acceptance criteria

Slice A:

- In the desktop window, Choose workspace → native OS folder dialog → workspace appears in the sidebar.
- A produced-file open action opens in the OS (or the test intercepts the opener the same way web e2e does).
- Cancel does not create a workspace.

Slice B (if included):

- Desktop bundle mounts the Electron picker backend; web profile still uses auto/native/browse as today.
- ui-workspace has no Electron import.

When slice A ships, move this note to `implemented/` and record slice B and WebView as deferred work in Consequences (or keep this note proposed if only docs landed — do not move it until A is in code).

## Risks

Windows COM picker from a process without a console/desktop session can fail if the child is spawned with `windowsHide` in a way that breaks dialogs. P2 spawn flags must keep the child in the user's session; P3 tests on Windows are the proof.

Electron dialogs from main while the child also runs a Node picker would double-prompt if both backends mount. The desktop bundle must mount exactly one native backend.

## Cursor prompt

Paste into a new Cursor agent:

1. Implement P3 slice A from `.agents/notes/proposed/architecture/2026-08-14-desktop-native-shell-capabilities.md`. P2 must already run a window. Read that note, the [product note](./2026-08-14-desktop-installer-product.md), `.agents/notes/implemented/architecture/2026-07-28-directory-picker-capability-seam.md`, `packages/host/directory-picker-native/README.md`, and `packages/client/ui-workspace` directory-flow occupancy.
2. Do not implement WebView preview. Do not implement slice B unless the user asks. Do not start P4–P5.
3. Prove Choose workspace uses a native dialog through IPC on at least macOS; add a Windows note or test if you can run it. Pin `directory-picker-native` in the desktop bundle if auto-detect fails under Electron spawn.
4. Reuse existing opener intercepts from web e2e rather than launching real apps in CI.
5. Update READMEs and this Agent Note (move to `implemented/` when slice A ships) plus the Chinese pair.
6. Follow `.agents/skills/dsh-pre-push-checks/SKILL.md`.
