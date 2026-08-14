# Agent Note: P3 — Native capabilities on the desktop shell

Status: implemented

English | [中文](2026-08-14-desktop-native-shell-capabilities.zh.md)

## Problem

The GUI already picks directories and opens paths through Host RPCs. [`directory-picker-native`](../../../../packages/host/directory-picker-native/README.md) runs OS choosers in the Node process (`osascript`, Windows `IFileOpenDialog`, Linux Zenity/KDialog). [`host.openPath`](../../../../packages/host/apiproxy/README.md) hands files to the OS. Both are gated as privileged / loopback operations.

The [picker seam note](./2026-07-28-directory-picker-capability-seam.md) says an Electron shell may provide the `native` interaction through its own dialog API as another dual-face backend, without gateway or ui-workspace edits. The [workspace file-link note](../feature/2026-07-31-web-workspace-file-links.md) records an embedded WebView as the right isolation for in-product file preview and explicitly defers that to the desktop shell.

P2's Node child can already call the existing native picker. The first installer does not need Electron dialogs. P3 exists so the shell owns platform UX where Electron is strictly better, and so preview work has a recorded home rather than growing inside the Web carrier.

## Decision

Slice A ships. The desktop Host child already pinned `@deepseek-ai/dsh-host-directory-picker-native` and `@deepseek-ai/dsh-client-ui-directory-picker-native` because `directory-picker-auto` injects `webServer`. This phase keeps that pin and proves the Node chooser and opener through the same IPC the window uses.

Through the running desktop shell:

- `host.pickDirectory` opens the Node native chooser (not the in-app browse modal) and returns a path or cancel.
- `host.openPath` / produced-file "open" uses the existing opener.
- `isLoopback` remains true when `window.__DSH_IPC_PORT__` is present, so those actions stay visible.
- Cancellation of pick (Escape / abort) maps to the existing `null` cancel result; the native flow occupant reports `onCancel` and ui-workspace does not create a workspace.

No new package. ui-workspace is unchanged. The renderer never calls Electron `dialog`.

### Deferred: Electron dialog provider

Slice B remains unbuilt: `@deepseek-ai/dsh-host-directory-picker-electron` would be a dual-face backend whose Host `pick` calls `dialog.showOpenDialog` in the **Electron main** process (the child asks main over the dumb forwarder; main never parses RPC envelopes). Client half would reuse the renderless occupant pattern as `-native`. The desktop bundle would mount it **instead of** `-native`, never both.

ui-workspace stays unchanged. There is no kind besides `native` / `browse`.

### Deferred: WebView preview

Not in the first installer. When scheduled, a later note owns a `BrowserView` / `webContents` that loads `file://` workspace documents without sharing the GUI renderer origin. Until then, open-in-OS remains the preview.

## Alternatives considered

**Block P4 until Electron dialogs ship.** The Node chooser already works on macOS and Windows. Installer delivery does not wait on a second picker.

**Serve workspace files over HTTP for preview.** Rejected for the Web product; do not revive it for desktop.

**Let the renderer call Electron `dialog` directly.** Would require exposing extra preload APIs and bypass the picker seam.

## Testing

`packages/bundle/desktop-app/tests/composition.spec.ts` pins the `-native` Host and UI rows and excludes `directory-picker-auto`.

`apps/desktop/tests/native-ops.e2e.ts` (built-bin-smoke) spawns a real `--profile desktop` child (self-skips until client bundles exist, and on Windows). PATH shims intercept `osascript` / Zenity and `open` / `xdg-open` so CI never launches a dialog or application — the same intercept stance as web e2e's spy on `host.openPath`. The suite asserts: boot graph includes the native UI row; `host.describe.canOpenPath` is true; `host.listDirectory` answers `directory-picker-unavailable` with `capability: 'native'`; pick returns the shim path and `workspace.create` adopts it; cancel returns `null` and does not add a workspace; `host.openPath` reaches the platform opener command.

Connection-client `isLoopback` with an IPC port is already pinned in `packages/client/connection/tests/client-apply.client.spec.ts`. NativeDirectoryFlow maps `null` to `onCancel` in `packages/client/ui-directory-picker-native/tests/client-flow.client.spec.tsx`.

Windows COM `IFileOpenDialog` is not PATH-shimmed here. [`directory-picker-native`](../../../../packages/host/directory-picker-native/README.md) owns those tests; the dialog worker already uses `windowsHide: true`. Host spawn also uses `windowsHide: true` so packaged Windows does not open a `node.exe` console. **Electron e2e in CI remains a named gap** (no Playwright Electron suite; no sidebar screenshot of Choose workspace).

## Consequences

The desktop bundle mounts exactly one native picker backend. Overlaying `directory-picker-auto` onto desktop reintroduces a `webServer` inject this Host does not satisfy.

Slice B must replace the `-native` rows, not stack a second native backend, or Choose workspace would double-prompt.

A Windows child spawned without a desktop session can still fail COM; `windowsHide: true` only sets CREATE_NO_WINDOW and leaves the child in the user's session. Proof on Windows is a developer-machine window check until a Windows e2e runner exists.

WebView preview stays out of this note's code. Open-in-OS is the preview until a later note owns `BrowserView`.

## Related

- [Desktop product](./2026-08-14-desktop-installer-product.md)
- [P0 IPC carrier](./2026-08-14-desktop-ipc-carrier.md)
- [P1 desktop profile Host](./2026-08-14-desktop-profile-host.md)
- [P2 Electron shell](./2026-08-14-desktop-electron-shell.md)
- [Directory-picker seam](./2026-07-28-directory-picker-capability-seam.md)
- [Workspace file links](../feature/2026-07-31-web-workspace-file-links.md)
