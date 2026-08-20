# Agent Note: P0 — IPC fetch carrier without Electron

Status: implemented

English | [中文](2026-08-14-desktop-ipc-carrier.zh.md)

## Problem

Every GUI client must speak the same four-quadrant RPC. `AbstractApiClient` owns protocol invariants; subclasses supply transport. The [layering note](./2026-07-19-gui-layering-and-rpc-protocol.md) names an IPC subclass as the Electron carrier and says swapping a carrier should not change the base class.

`WebApiClient` already overrides `openMux` / `openHost` rather than using the in-process SSE path, so implementing only `doFetch` is not sufficient for a product downlink. An IPC carrier that depended on Electron would make the protocol untestable in vitest.

## Decision

`@deepseek-ai/dsh-host-apiproxy` owns a **JSON IPC carrier** beside the existing fetch family, with no `electron` dependency. Types and both ends live next to `AbstractApiClient` / `toFetchHandler` / `InProcessApiClient`. The client is exported from the existing browser-safe `./client` subpath; `HostIpcGateway` is a host-only root export.

### Port

```text
interface IpcPort {
  post(message: IpcMessage): void
  subscribe(handler: (message: IpcMessage) => void): () => void
}
```

Tests implement `IpcPort` with `MessageChannel` or a pair of `EventEmitter`s. The [Electron shell](./2026-08-14-desktop-electron-shell.md) adapts `ipcMain` / `ipcRenderer` (and the Node child `process` IPC) to this interface without changing message types.

### Messages

Discriminated JSON documents, one object per `post`:

```text
unary-request  { type, id, url, method, headers, body? }
unary-response { type, id, status, headers, body }
unary-failure  { type, id, message }
unary-abort    { type, id }
stream-open    { type, id, path }           // path is /api/events.mux or /api/events.host
stream-frame   { type, id, envelope }       // envelope is a ServerRequest
stream-end     { type, id, error? }
stream-abort   { type, id }
```

`id` is an `IpcId` minted by the client per unary call and per downlink stream, distinct from `RpcId`. Unary `url` is resolved against `http://dsh.internal` as `InProcessApiClient` already does. Bodies are UTF-8 strings (JSON RPC). Headers include `content-type: application/json` on every unary POST so the [media-type fence](./2026-07-28-api-browser-trust-boundary.md) still holds when the host gateway feeds `toFetchHandler`.

The carrier keeps **two downlink streams** with no cross-stream ordering, matching `WebApiClient`. Mux and host are not multiplexed onto one channel tag.

### Client: `IpcApiClient`

Subclass of `AbstractApiClient`:

- `doFetch` posts `unary-request` and settles on `unary-response` / `unary-failure`. An `AbortSignal` posts `unary-abort` so user-paced unaries such as `host.pickDirectory` cancel on the host.
- `openMux` / `openHost` post `stream-open`, yield parsed `RpcRequest<Frame>` from `stream-frame`, and finish on `stream-end` or abort.

Malformed frames are dropped and logged, matching `WebApiClient`. A `stream-end` with `error` fails the connection generation the same way a WebSocket close does. `dispose()` unsubscribes and rejects in-flight work.

### Host: `HostIpcGateway`

Constructed with `toFetchHandler(api)` plus `api.events`. For each peer:

- `unary-request` → `handler.fetch` → `unary-response`; thrown fetch errors → `unary-failure`.
- `stream-open` for mux/host → iterate `api.events.mux` / `api.events.host` and post `stream-frame`; on completion or throw, post `stream-end`.
- `unary-abort` / `stream-abort` abort the matching work. An abort that arrives before the matching register is remembered so the work never starts.

The gateway treats the IPC peer as a **loopback, same-origin, already-authenticated product shell**. It does not listen on a TCP port and does not apply the browser Host/Origin fence. Privileged methods (`host.pickDirectory`, settings, credentials, and the loopback-only set in `dsh-client-connection`) are allowed for this peer. The gateway is unreachable from a web page. `dispose()` waits for in-flight work.

### Connection plugin

`dsh-client-connection` HTTP routes are unchanged. The [Electron shell](./2026-08-14-desktop-electron-shell.md) recognizes `window.__DSH_IPC_PORT__` and constructs the exported client; tests also construct `IpcApiClient` directly.

### Out of scope

Installers remain a later phase. The [Electron shell](./2026-08-14-desktop-electron-shell.md) adapts this carrier; apiproxy has no `electron` dependency.

## Alternatives considered

**Put `IpcApiClient` only in `apps/desktop`.** There would be no package to test, and the Electron app would own protocol types that every carrier test needs.

**A new `dsh-client-ipc` package.** One consumer, ownerless mixture. The layering note puts assembly in `apps/` and shared transport next to `AbstractApiClient`.

**Reuse HTTP to localhost from the renderer, IPC only for window chrome.** Leaves the shipped desktop on the webserver, which this product forbids.

**Full-duplex one-channel RPC (unary on the same socket as frames).** Rewrites timeout, abort, and correlation that HTTP uplink plus two downlinks already solved. IPC does not have the browser six-connection limit, but isomorphism with `IApiClient` is the point of this carrier.

**Depend on Electron `ipcMain` in apiproxy.** Makes unit tests pull Electron and couples a host library to a shell.

## Testing

`packages/host/apiproxy/tests/ipc-carrier.spec.ts` pairs `IpcApiClient` with `HostIpcGateway` over an in-process `IpcPort` (`MessageChannel` plus a synchronous mock port, no listening socket). It pins unary success and `rpcId` echo; unary abort of a hanging `host.pickDirectory`; mux and host frames in independent streams; abort of a live stream without killing the sibling; a malformed `stream-frame` dropped without killing the sibling; gateway `unary-failure` as a transport throw; a privileged unary without browser `Host`/`Origin` headers; and no `electron` dependency in the package manifest.

## Consequences

The four-quadrant RPC is testable over IPC without Electron, so the [Electron shell](./2026-08-14-desktop-electron-shell.md) adapts `ipcMain` / `ipcRenderer` (and Node child `process` IPC) to `IpcPort` without changing message types. `dsh-client-connection` still owns the browser HTTP/WebSocket carrier; this package has no `electron` dependency. The [desktop profile](./2026-08-14-desktop-profile-host.md) composes the Host; the shell instantiates the gateway in the child.

JSON serialization cannot carry binary bodies. The current RPC is JSON-only; a later method that needs bytes must add an explicit binary frame rather than silently base64-ing.

Treating every IPC peer as loopback is correct only while the Node child accepts connections solely from the Electron main process that spawned it. The shell must not open a TCP fallback.
