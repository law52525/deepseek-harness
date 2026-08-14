# `@deepseek-ai/dsh-desktop-app`

English | [中文](README.zh.md)

The dsh desktop-surface bundle. [`cordis.patch.yml`](cordis.patch.yml) rides over [`dsh-base`](../base/README.md): it sets the same coding persona and Host business rows as [`dsh-web-app`](../web-app/README.md) (API gateway, workspace, projection cache, storage, native directory picker, the `dsh.client` roster, api-remotes, agent-presets, and the same host-plane tool disables), and mounts this package's `desktop-runtime` glue plugin (config `{surfaceContext}`). That plugin provides `desktopRuntime` with no bind address, registers the harness-source prompt section when `surfaceContext` is true, and does not print a URL or mount HTTP. This bundle also owns the app command line: the ordinary `desktop-startup` provider ([`src/startup.ts`](src/startup.ts)) injects `ctx.cmdlineArgs` ([`dsh-cmdline`](../../boot/cmdline/README.md)), parses `--help`, then provides `desktopStartup`. Flag-gated rows inject that service, so `dsh --profile desktop --help` starts no server and no Electron window.

Adding a `dsh.client` row to web-app requires the same row here until a shared roster fragment exists.

## Model Experience

### Harness-source context

#### What the model sees

When `surfaceContext` is true, the `harness:source` section identifies the on-disk Harness implementation without claiming it is the working directory. When it is false, the section is not registered.

#### Token effect

One source line per session; constant per process.

#### KV Cache effect

The prompt section sits near the system prompt's head and is stable for the life of the process, so it does not invalidate the cache across turns.

## Known Limitations and Deferred Work

- **No HTTP listener** — this Host does not mount `dsh-host-webserver` or print a URL; the Electron renderer consumes `ctx.clientModules.graph()` through process IPC (`desktop-app/ipc-host`). Session-log download uses the same IPC: the shell's `dsh:` handler forwards `GET`/`HEAD` `/api/session.export` as a control document, and GET ZIP bytes return as a Host-written temp path.
- **Native directory picker is pinned** — `directory-picker-auto` injects `webServer`, so this bundle mounts `-native` Host and UI rows directly. `host.pickDirectory` and `host.openPath` run in the Node child over IPC; an Electron dialog backend is deferred.
- **Client roster must stay aligned with web-app** — a new `dsh.client` row belongs in both bundles until they share a fragment that omits HTTP rows.
