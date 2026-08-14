/**
 * Spawned `dsh --profile desktop` child: host.pickDirectory and host.openPath
 * through process IPC, with PATH shims intercepting the native chooser and
 * opener so CI never launches a real OS dialog or application.
 */

import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { IpcApiClient, type IpcMessage } from '@deepseek-ai/dsh-host-apiproxy'
import { spawnDesktopHost, type DesktopHostChild } from '../src/host-child.ts'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const MODULES_CLIENT = join(REPO_ROOT, 'packages/client/modules/lib/client.js')
const CLI_BIN = join(REPO_ROOT, 'apps/cli/lib/bin.js')
const POSIX = process.platform !== 'win32'
const BUILT = existsSync(MODULES_CLIENT) && existsSync(CLI_BIN)

interface NativeCall {
  name: string
  args: string[]
}

function parseLog(text: string): NativeCall[] {
  return text.split('\n').filter(line => line !== '').map(line => JSON.parse(line) as NativeCall)
}

describe.skipIf(!POSIX || !BUILT)(
  'desktop Host native picker and opener through IPC',
  () => {
    let host: DesktopHostChild | undefined
    let client: IpcApiClient | undefined
    let home: string
    let binDir: string
    let logPath: string
    let modePath: string
    let pickPath: string
    let openPath: string

    beforeAll(async () => {
      home = await mkdtemp(join(tmpdir(), 'dsh-desktop-native-'))
      binDir = join(home, 'bin')
      await mkdir(binDir)
      logPath = join(home, 'native.log')
      modePath = join(home, 'picker-mode')
      pickPath = join(home, 'workspace')
      openPath = join(home, 'opened.txt')
      await mkdir(pickPath)
      await writeFile(openPath, 'opened\n')
      await writeFile(modePath, 'pick\n')
      await writeFile(logPath, '')

      const shim = join(home, 'native-shim.mjs')
      await writeFile(shim, `${[
        'import { appendFileSync, readFileSync } from "node:fs"',
        'const name = process.argv[2] ?? ""',
        'const args = process.argv.slice(3)',
        'const log = process.env.DSH_TEST_NATIVE_LOG',
        'if (log) appendFileSync(log, JSON.stringify({ name, args }) + "\\n")',
        'function mode() {',
        '  const file = process.env.DSH_TEST_PICKER_MODE_FILE',
        '  if (!file) return "pick"',
        '  try { return readFileSync(file, "utf8").trim() } catch { return "pick" }',
        '}',
        'if (name === "osascript" || name === "zenity" || name === "kdialog") {',
        '  if (mode() === "cancel") {',
        '    if (name === "osascript") process.stderr.write("execution error: User canceled. (-128)\\n")',
        '    process.exit(1)',
        '  }',
        '  process.stdout.write((process.env.DSH_TEST_PICK_PATH ?? "") + "\\n")',
        '  process.exit(0)',
        '}',
        'process.exit(0)',
        '',
      ].join('\n')}`)

      const commands = ['osascript', 'zenity', 'kdialog', 'open', 'xdg-open']
      for (const command of commands) {
        const wrapper = join(binDir, command)
        await writeFile(wrapper, `#!/bin/sh\nexec node ${JSON.stringify(shim)} ${command} "$@"\n`)
        await chmod(wrapper, 0o755)
      }

      const env: NodeJS.ProcessEnv = {
        DSH_HOME: home,
        DSH_TEST_NATIVE_LOG: logPath,
        DSH_TEST_PICKER_MODE_FILE: modePath,
        DSH_TEST_PICK_PATH: pickPath,
        PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      }
      if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        env.DISPLAY = ':0'
      }

      host = spawnDesktopHost({ cwd: REPO_ROOT, env })
      await host.awaitReady()
      client = new IpcApiClient({
        post(message) { host!.postRpc(message) },
        subscribe(handler) {
          return host!.subscribeRpc((payload) => { handler(payload as IpcMessage) })
        },
      })
    }, 120_000)

    afterAll(async () => {
      client?.dispose()
      await host?.dispose()
    })

    it('composes the native picker UI row and refuses browse RPCs', async () => {
      const graph = await host!.bootGraph()
      expect(graph.graph.entries.some(
        entry => entry.id === '@deepseek-ai/dsh-client-ui-directory-picker-native',
      )).toBe(true)
      const described = await client!.host.describe({})
      expect(described.result).toMatchObject({ ok: true, value: { canOpenPath: true } })
      const listed = await client!.host.listDirectory({})
      expect(listed.result).toMatchObject({
        ok: false,
        error: { code: 'directory-picker-unavailable', details: { capability: 'native' } },
      })
    })

    it('opens the Node native chooser through IPC and adopts the picked workspace', async () => {
      await writeFile(modePath, 'pick\n')
      const picked = await client!.host.pickDirectory({})
      expect(picked.result).toEqual({ ok: true, value: { path: pickPath } })
      const calls = parseLog(await readFile(logPath, 'utf8'))
      if (process.platform === 'darwin') {
        expect(calls.some(call =>
          call.name === 'osascript' && call.args.some(arg => arg.includes('choose folder')),
        )).toBe(true)
      } else {
        expect(calls.some(call =>
          call.name === 'zenity'
          && call.args.includes('--file-selection')
          && call.args.includes('--directory'),
        )).toBe(true)
      }
      const created = await client!.workspace.create({ path: pickPath })
      expect(created.result.ok).toBe(true)
      const canonical = await realpath(pickPath)
      const workspaces = await client!.workspace.list({})
      expect(workspaces.result.ok).toBe(true)
      if (workspaces.result.ok) {
        expect(workspaces.result.value.items.some(item => item.path === canonical)).toBe(true)
      }
    })

    it('maps native-chooser cancellation to null and does not create a workspace', async () => {
      const before = await client!.workspace.list({})
      const count = before.result.ok ? before.result.value.items.length : 0
      await writeFile(modePath, 'cancel\n')
      const cancelled = await client!.host.pickDirectory({})
      expect(cancelled.result).toEqual({ ok: true, value: { path: null } })
      const after = await client!.workspace.list({})
      expect(after.result.ok).toBe(true)
      if (after.result.ok) expect(after.result.value.items).toHaveLength(count)
    })

    it('hands host.openPath to the platform opener without launching an application', async () => {
      await writeFile(logPath, '')
      const opened = await client!.host.openPath({ path: openPath })
      expect(opened.result).toEqual({ ok: true, value: { opened: true } })
      const calls = parseLog(await readFile(logPath, 'utf8'))
      const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
      expect(calls.some(call => call.name === opener && call.args.includes(openPath))).toBe(true)
    })
  },
)
