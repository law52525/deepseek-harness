/**
 * Spawned `dsh --profile desktop` child: host-ready, host.describe, both
 * downlink streams, and boot-graph over process IPC. Self-skips until the
 * CLI bin and a client bundle exist (`pnpm run build`).
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { IpcApiClient, type IpcMessage } from '@deepseek-ai/dsh-host-apiproxy'
import { DesktopHostChild, hostChildArgv } from '../src/host-child.ts'
import { resolveNodeExecutable } from '../src/node-executable.ts'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const MODULES_CLIENT = join(REPO_ROOT, 'packages/client/modules/lib/client.js')
const CLI_BIN = join(REPO_ROOT, 'apps/cli/lib/bin.js')

describe.skipIf(!existsSync(MODULES_CLIENT) || !existsSync(CLI_BIN))(
  'desktop Host child process IPC',
  () => {
    let host: DesktopHostChild | undefined

    afterAll(async () => {
      await host?.dispose()
    })

    it('handshakes, describes the host, and opens both downlinks', async () => {
      const node = resolveNodeExecutable()
      const argv = hostChildArgv(node)
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const child = spawn(argv.command, argv.args, {
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
        env,
        cwd: REPO_ROOT,
      })
      host = new DesktopHostChild(child)
      await host.awaitReady()
      const graph = await host.bootGraph()
      expect(graph.graph.entries.some(entry => entry.id === '@deepseek-ai/dsh-client-connection')).toBe(true)

      const client = new IpcApiClient({
        post(message) { host!.postRpc(message) },
        subscribe(handler) {
          return host!.subscribeRpc((payload) => { handler(payload as IpcMessage) })
        },
      })
      try {
        const described = await client.host.describe({})
        expect(described.result.ok).toBe(true)
        const muxAbort = new AbortController()
        const hostAbort = new AbortController()
        const mux = client.events.mux({}, muxAbort.signal)[Symbol.asyncIterator]()
        const hostEvents = client.events.host({}, hostAbort.signal)[Symbol.asyncIterator]()
        const muxFrame = mux.next()
        const hostFrame = hostEvents.next()
        muxAbort.abort()
        hostAbort.abort()
        expect((await muxFrame).done).toBe(true)
        expect((await hostFrame).done).toBe(true)
      } finally {
        client.dispose()
      }
    }, 120_000)
  },
)
