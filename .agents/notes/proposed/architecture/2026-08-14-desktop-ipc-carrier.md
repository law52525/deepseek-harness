# Agent Note: P0 — IPC fetch carrier without Electron

Status: proposed

English | [中文](2026-08-14-desktop-ipc-carrier.zh.md)

## Problem

Every GUI client must speak the same four-quadrant RPC. `AbstractApiClient` owns protocol invariants; subclasses supply transport. Today those subclasses are `InProcessApiClient` (injected `fetch`) and `WebApiClient` (HTTP uplink plus two WebSocket downlinks). The [layering note](../../implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md) names an IPC subclass as the Electron carrier and says swapping a carrier should not change the base class.

`WebApiClient` already overrides `openMux` / `openHost` rather than using the in-process SSE path, so "implement only `doFetch`" is not sufficient for a product downlink. No IPC message types, client subclass, or host gateway exist, and none of them should depend on Electron if the protocol is to be tested in vitest.

## Proposal

Add a **JSON IPC carrier** next to the existing fetch family, with no `electron` dependency.

Place the types and both ends in `@deepseek-ai/dsh-host-apiproxy` beside `AbstractApiClient` / `toFetchHandler` / `InProcessApiClient`, and export the client from the existing browser-safe `./client` subpath.

### Port

```text
interface IpcPort {
  post(message: IpcMessage): void
  subscribe(handler: (message: IpcMessage) => void): () => void
}
```

Tests implement `IpcPort` with `MessageChannel` or a pair of `EventEmitter`s. P2 adapts Electron `ipcMain` / `ipcRenderer` (and the Node child `process` IPC) to this interface without changing message types.

### Messages

Discriminated JSON documents, one object per `post`:

```text
unary-request  { type, id, url, method, headers, body? }
unary-response { type, id, status, headers, body }
unary-failure  { type, id, message }
stream-open    { type, id, path }           // path is /api/events.mux or /api/events.host
stream-frame   { type, id, envelope }       // envelope is a ServerRequest
stream-end     { type, id, error? }
stream-abort   { type, id }
```

`id` is minted by the client per unary call and per downlink stream. Unary `url` is resolved against `http://dsh.internal` as `InProcessApiClient` already does. Bodies are UTF-8 strings (JSON RPC). Headers include `content-type: application/json` on every unary POST so the [media-type fence](../../implemented/architecture/2026-07-28-api-browser-trust-boundary.md) still holds when the host gateway feeds `toFetchHandler`.

Keep **two downlink streams** with no cross-stream ordering, matching `WebApiClient`. Do not multiplex mux and host onto one channel tag in P0.

### Client: `IpcApiClient`

Subclass `AbstractApiClient`:

- `doFetch` sends `unary-request` and settles on `unary-response` / `unary-failure`, honoring `AbortSignal` with `stream-abort` unused for unary (send a unary abort by dropping the pending id and posting `unary-failure` locally, or add `unary-abort` if abort must reach the handler; prefer aborting the in-flight gateway fetch via an `unary-abort { type, id }` message so `host.pickDirectory` cancellation works).
- Add `unary-abort { type, id }` so user-paced unary calls cancel on the host.
- `openMux` / `openHost` send `stream-open`, yield parsed `RpcRequest<Frame>` from `stream-frame`, and finish on `stream-end` or abort.

Malformed frames are dropped and logged, matching `WebApiClient`. A `stream-end` with `error` fails the connection generation the same way a WebSocket close does.

### Host: `HostIpcGateway`

Constructed with `toFetchHandler(api)` plus `api.events`. For each peer:

- `unary-request` → `handler.fetch` → `unary-response`; thrown fetch errors → `unary-failure`.
- `stream-open` for mux/host → iterate `api.events.mux` / `api.events.host` and post `stream-frame`; on completion or throw, post `stream-end`.
- `unary-abort` / `stream-abort` abort the matching work.

The gateway treats the IPC peer as a **loopback, same-origin, already-authenticated product shell**. It must not listen on a TCP port. Privileged methods (`host.pickDirectory`, settings, credentials, and the loopback-only set in `dsh-client-connection`) are allowed for this peer. The gateway is unreachable from a web page.

### Connection plugin in P0

Do not change `dsh-client-connection` HTTP routes in P0. Export `IpcApiClient` so P2 can construct it. Optionally recognize a documented `globalThis` seam later in P2; P0 tests construct the class directly.

### Out of scope

Electron, a `desktop` profile, `file://` plugin loading, installers.

## Alternatives considered

**Put `IpcApiClient` only in `apps/desktop`.** P0 would have no package to test, and the Electron app would own protocol types that every carrier test needs.

**A new `dsh-client-ipc` package.** One consumer, ownerless mixture. The layering note puts assembly in `apps/` and shared transport next to `AbstractApiClient`.

**Reuse HTTP to localhost from the renderer, IPC only for window chrome.** Leaves the shipped desktop on the webserver, which this product forbids.

**Full-duplex one-channel RPC (unary on the same socket as frames).** Rewrites timeout, abort, and correlation that HTTP uplink plus two downlinks already solved. IPC does not have the browser six-connection limit, but isomorphism with `IApiClient` is the point of P0.

**Depend on Electron `ipcMain` in apiproxy.** Makes unit tests pull Electron and couples a host library to a shell.

## Acceptance criteria

- `IpcApiClient` plus `HostIpcGateway` plus `IpcPort` exist in `dsh-host-apiproxy` with no `electron` import in `packages/`.
- Carrier tests over an in-process `IpcPort` pair prove: unary success and `rpcId` echo; unary abort of a hanging handler; mux and host frames in independent streams; abort of a live stream; malformed `stream-frame` dropped without killing the sibling stream; gateway `unary-failure` becomes a transport throw.
- A privileged unary (`host.pickDirectory` or a test double) succeeds through the gateway without HTTP `Host`/`Origin` headers from a browser.
- `pnpm --filter @deepseek-ai/dsh-host-apiproxy test` is green. No `apps/desktop` yet.

## Risks

Serializing `Request`/`Response` as JSON strings cannot carry binary bodies. The current RPC is JSON-only; if a later method needs bytes, this carrier must gain an explicit binary frame rather than silently base64-ing.

Treating every IPC peer as loopback is correct only while the Node child accepts connections solely from the Electron main process that spawned it. P2 must not open a TCP fallback.

## Cursor prompt

Paste into a new Cursor agent:

1. Implement only P0 from `.agents/notes/proposed/architecture/2026-08-14-desktop-ipc-carrier.md`. Also read `.agents/notes/proposed/architecture/2026-08-14-desktop-installer-product.md`, `.agents/notes/implemented/architecture/2026-07-19-gui-layering-and-rpc-protocol.md`, `.agents/notes/implemented/architecture/2026-08-04-websocket-downlink-carrier.md`, `packages/host/apiproxy/src/fetch/client.ts`, `packages/host/apiproxy/src/fetch/` handler + `toFetchHandler`, `packages/client/connection/src/client/web-api-client.ts`, `AGENTS.md`, `packages/AGENTS.md`, and `.agents/skills/dsh-prose-standard/SKILL.md`.
2. Do not add Electron, a desktop profile, `apps/desktop`, or installer scripts. Do not change `dsh-host-webserver` or Connection HTTP routes.
3. Add `IpcPort`, the message union, `IpcApiClient`, and `HostIpcGateway` in `@deepseek-ai/dsh-host-apiproxy`. Export the client on the existing `./client` subpath. Keep protocol invariants in `AbstractApiClient`.
4. Cover the Acceptance criteria with focused tests that use `MessageChannel` or EventEmitters, `toFetchHandler` over a fake `ApiProxy`, and no listening socket.
5. Update this package README and JSDoc in the same change. When behavior matches the proposal, move this Agent Note to `implemented/architecture/`, rewrite Proposal → Decision and Acceptance criteria → Consequences, keep Alternatives considered, and update the Chinese pair.
6. Do not start P1–P5.
7. Run the narrowest checks for the diff (apiproxy tests, `doc-sync` pieces that cover Agent Notes, `git diff --check`). Follow `.agents/skills/dsh-pre-push-checks/SKILL.md`.
