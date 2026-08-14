# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

Electron shell for the desktop profile. Main spawns a system-Node `dsh --profile desktop` child with stdio IPC, serves [`dsh-web-frontend`](../web/package.json) dist at `dsh://app/`, and forwards opaque RPC. [`HostIpcGateway`](../../packages/host/apiproxy/README.md) runs in the child; this package does not decode RPC bodies. The renderer reuses the Web shell kernel with `BootSeams.loadBundle`.

`contextIsolation` is true and `nodeIntegration` is false. Preload exposes `window.__DSH_IPC_PORT__` (`IpcPort`) and `window.__DSH_DESKTOP__` (`bootGraph`, `readPlugin`). Plugin bytes come only from `clientPath` inside the Host graph.

From the repository root: `pnpm run dev:desktop` (runs `pnpm run build`, then `electron .`). Packaging, signing, and auto-update are later phases.

## Known Limitations and Deferred Work

- **Electron e2e is not in CI** — jsdom and a Node child prove the seams; there is no Playwright Electron suite yet.
- **Native OS dialogs stay on the Node child** — `host.pickDirectory` opens the Node `osascript` / Zenity / `IFileOpenDialog` chooser; `host.openPath` uses the existing opener. Electron `dialog.showOpenDialog` and WebView preview are later phases. Spawn keeps `windowsHide: false` so a Windows dialog can still appear. Tests intercept those commands the same way web e2e spies `host.openPath`, and do not launch Electron or a real application.
