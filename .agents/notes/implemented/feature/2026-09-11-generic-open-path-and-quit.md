# Agent Note: Generic open-path-and-quit and https-only open-external

Status: implemented

English | [中文](2026-09-11-generic-open-path-and-quit.zh.md)

## Problem

A Host plugin can download an installer and know its absolute path, but it cannot quit the Electron app or open that file with the OS default handler. The same gap exists for opening an `https:` download page or release-note link. Electron's `app.quit`, `shell.openPath`, `shell.openExternal`, and detached `spawn` only exist in the main process. Leaving packaged startup on `startDesktopAutoUpdate` would run a second updater beside the plugin dialog and race downloads.

## Decision

The desktop shell exposes two generic Host → parent messages, with no product names, versions, or download hosts in the new code:

- **`open-path-and-quit { id, path }`** — `path` must be absolute. Windows `spawn`s the exe detached then `app.quit()` only after a next-tick `error` event does not fire (ENOENT must not quit). macOS/`openPath` returns an empty string then quits. The `quit` callback disarms the blocking overlay (`update-install`) first so an armed force-update gate cannot `preventDefault` the quit. Any failure replies `open-path-result { id, ok: false, detail }` and **does not quit**. Success quits without a reply.
- **`open-external { id, url }`** — only `https:` calls `shell.openExternal`; every other scheme is refused. The parent always replies `open-external-result { id, ok, detail? }`.

`apps/desktop/src/main.ts` packaged `whenReady` no longer calls `startDesktopAutoUpdate`. `auto-update.ts` and the `check-for-updates` Host dispatch stay so older clients that still send that message keep a path; new Host code does not send it.

## Alternatives considered

- **Keep electron-updater as the only installer** — rejected. Mac `latest-mac.yml` historically listed dmg first, so `MacUpdater` never installed, and silent updates have no UI.
- **Host `child_process` / renderer `window.open`** — rejected. The Host child cannot quit the shell, and a renderer cannot reliably spawn an NSIS installer then exit the app.
- **Allow `http:` / `file:` in `open-external`** — rejected. Release notes and the download page are https; other schemes are an unnecessary open-redirect surface.

## Consequences

Plugins own feed URLs, copy, and sha512. The shell only opens a path or an https URL. Switching to the official shell means mapping these two messages onto whatever equivalent IPC it grows, or keeping them in a fork. Packaged startup no longer silently checks GitHub/generic yml; in-app check + dialog is the only update entry.
