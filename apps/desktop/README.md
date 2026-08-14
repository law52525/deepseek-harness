# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

Electron shell for the desktop profile. Main spawns a system-Node `dsh --profile desktop` child with stdio IPC, serves [`dsh-web-frontend`](../web/package.json) dist at `dsh://app/`, answers `GET`/`HEAD` `/api/session.export` from that Host child, and forwards opaque RPC. [`HostIpcGateway`](../../packages/host/apiproxy/README.md) runs in the child; this package does not decode RPC bodies. The renderer reuses the Web shell kernel with `BootSeams.loadBundle`.

`contextIsolation` is true and `nodeIntegration` is false. Preload exposes `window.__DSH_IPC_PORT__` (`IpcPort`) and `window.__DSH_DESKTOP__` (`bootGraph`, `readPlugin`). Plugin bytes come only from `clientPath` inside the Host graph.

From the repository root: `pnpm run dev:desktop` (runs `pnpm run build`, then `electron .`). `pnpm run dist:desktop` stages a symlink-free Node Host closure plus frontend dist and runs electron-builder for the host OS (macOS arm64 `.dmg` and `.zip`, Windows x64 NSIS). Windows artifacts stay unsigned. macOS artifacts are ad-hoc unless you run `pnpm run dist:mac:signed` with a Developer ID Application identity and `APPLE_*`. GitHub Releases publish the notarized `.dmg` and the unsigned `.exe`; packaged builds check that Release for full-app auto-updates.

## Known Limitations and Deferred Work

- **Electron e2e is not in CI** — jsdom and a Node child prove the seams; there is no Playwright Electron suite yet.
- **Windows package is unsigned** — SmartScreen will warn. Intel Mac, Windows arm64, Linux, MAS, and Authenticode are out of scope. The notarized Mac package opens without a Gatekeeper block.
- **Native OS dialogs stay on the Node child** — `host.pickDirectory` opens the Node `osascript` / Zenity / `IFileOpenDialog` chooser; `host.openPath` uses the existing opener. Electron `dialog.showOpenDialog` and WebView preview are later phases. Host spawn uses `windowsHide: true` so Windows does not open a `node.exe` console; the Win32 picker worker already uses `windowsHide: true`. Tests intercept those commands the same way web e2e spies `host.openPath`, and do not launch Electron or a real application.
