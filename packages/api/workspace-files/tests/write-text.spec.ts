/** The `writeText` endpoint: one whole-file replacement under the caller's version guard. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { realpathSync } from 'node:fs'
import { failureOf, openWorkspace, signal, type Harness } from './harness.ts'

let harness: Harness
let workspace: string
let outside: string

beforeEach(async () => {
  harness = await openWorkspace('dsh-workspace-files-write-')
  workspace = harness.workspace
  outside = harness.outside
})

afterEach(async () => {
  try {
    await harness.dispose()
  } finally {
    vi.restoreAllMocks()
  }
})

const endpoint = (): ReturnType<Harness['endpoint']> => harness.endpoint()

/** Every name under the two fixture directories, so a refused call can be shown to have written nothing. */
async function disk(): Promise<{ workspace: string[]; outside: string[] }> {
  return {
    workspace: (await readdir(workspace, { recursive: true })).sort(),
    outside: (await readdir(outside, { recursive: true })).sort(),
  }
}

/** The version a client reads before writing. */
async function versionOf(path: string): Promise<string> {
  return (await endpoint().stat(harness.scope, path, signal())).version
}

/** Create a link to a directory: a Windows junction where junctions exist, a directory symlink elsewhere. */
const directoryLink = (target: string, link: string): Promise<void> =>
  symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')

describe('workspaceFiles.writeText — a matching version replaces the file', () => {
  it('writes the content and reports a version the following stat agrees with', async () => {
    const path = join(workspace, 'notes.md')
    await writeFile(path, 'one\ntwo\nthree\n', 'utf8')
    const before = await versionOf('notes.md')
    const content = 'one\nTWO\nthree\n'
    const written = await endpoint().writeText(harness.scope, 'notes.md', content, before, signal())
    expect(written.absolutePath).toBe(join(realpathSync(workspace), 'notes.md'))
    expect(written.bytes).toBe(Buffer.byteLength(content, 'utf8'))
    expect(written.version).not.toBe(before)
    expect(await readFile(path, 'utf8')).toBe(content)
    expect(await endpoint().stat(harness.scope, 'notes.md', signal())).toEqual(written)
  })

  it('accepts an absolute path as well as a workspace-relative one', async () => {
    const path = join(workspace, 'notes.md')
    await writeFile(path, 'one\n', 'utf8')
    const written = await endpoint().writeText(harness.scope, path, 'two\n', await versionOf(path), signal())
    expect(written.absolutePath).toBe(join(realpathSync(workspace), 'notes.md'))
    expect(await readFile(path, 'utf8')).toBe('two\n')
  })

  it('fences the write to the Session workspace whatever the deployment sandbox mode', async () => {
    const path = join(workspace, 'notes.md')
    await writeFile(path, 'one\n', 'utf8')
    const writeText = vi.spyOn(harness.ctx.fs, 'writeText')
    await endpoint().writeText(harness.scope, 'notes.md', 'two\n', await versionOf(path), signal())
    expect(writeText.mock.calls[0]?.[1]).toBe('two\n')
    expect(writeText.mock.calls[0]?.[2]).toMatchObject({ kind: 'replaceIfVersion' })
    expect(writeText.mock.calls[0]?.[4]).toEqual({ mode: 'workspace-write', workspaceRoot: workspace })
  })
})

describe('workspaceFiles.writeText — a stale expected version refuses', () => {
  it('names the current version and keeps the bytes', async () => {
    const path = join(workspace, 'notes.md')
    await writeFile(path, 'disk\n', 'utf8')
    const held = await versionOf(path)
    await writeFile(path, 'newer disk\n', 'utf8')
    const before = await disk()
    const failure = await failureOf(endpoint().writeText(harness.scope, 'notes.md', 'mine\n', held, signal()))
    expect(failure.code).toBe('workspace-file/stale-version')
    expect(failure.details).toEqual({ path: 'notes.md', version: await versionOf(path) })
    expect(await readFile(path, 'utf8')).toBe('newer disk\n')
    expect(await disk()).toEqual(before)
  })

  it('reports the fresh version when the file changes between the stat and the guarded write', async () => {
    const path = join(workspace, 'notes.md')
    await writeFile(path, 'disk\n', 'utf8')
    const held = await versionOf(path)
    const refusal = Object.assign(new Error('file changed since it was read'), { code: 'FS_STALE_VERSION' })
    vi.spyOn(harness.ctx.fs, 'writeText').mockImplementation(async () => {
      await writeFile(path, 'external\n', 'utf8')
      throw refusal
    })
    const failure = await failureOf(endpoint().writeText(harness.scope, 'notes.md', 'mine\n', held, signal()))
    expect(failure.code).toBe('workspace-file/stale-version')
    expect(failure.details).toEqual({ path: 'notes.md', version: await versionOf(path) })
    expect(await readFile(path, 'utf8')).toBe('external\n')
  })
})

describe('workspaceFiles.writeText — the target must be an existing workspace file', () => {
  it('refuses an absolute path outside the workspace and writes nothing', async () => {
    await writeFile(join(outside, 'secret.md'), 'kept\n', 'utf8')
    const before = await disk()
    const failure = await failureOf(endpoint().writeText(harness.scope, join(outside, 'secret.md'), 'mine\n', 'v', signal()))
    expect(failure.code).toBe('workspace-file/outside-workspace')
    expect(failure.details).toEqual({ path: join(outside, 'secret.md') })
    expect(await readFile(join(outside, 'secret.md'), 'utf8')).toBe('kept\n')
    expect(await disk()).toEqual(before)
  })

  it('refuses a workspace path that climbs out and writes nothing', async () => {
    await writeFile(join(outside, 'secret.md'), 'kept\n', 'utf8')
    const before = await disk()
    const failure = await failureOf(endpoint().writeText(harness.scope, '../outside/secret.md', 'mine\n', 'v', signal()))
    expect(failure.code).toBe('workspace-file/outside-workspace')
    expect(await readFile(join(outside, 'secret.md'), 'utf8')).toBe('kept\n')
    expect(await disk()).toEqual(before)
  })

  it('refuses a path reached through a link that leaves the workspace', async () => {
    await writeFile(join(outside, 'secret.md'), 'kept\n', 'utf8')
    await directoryLink(outside, join(workspace, 'escape'))
    const before = await disk()
    const failure = await failureOf(endpoint().writeText(harness.scope, 'escape/secret.md', 'mine\n', 'v', signal()))
    expect(failure.code).toBe('workspace-file/outside-workspace')
    expect(await readFile(join(outside, 'secret.md'), 'utf8')).toBe('kept\n')
    expect(await disk()).toEqual(before)
  })

  it('reports a missing file as not found and does not create it', async () => {
    const before = await disk()
    const failure = await failureOf(endpoint().writeText(harness.scope, 'nope.md', 'mine\n', 'v', signal()))
    expect(failure.code).toBe('workspace-file/not-found')
    expect(failure.details).toEqual({ path: 'nope.md' })
    expect(await disk()).toEqual(before)
  })

  it('refuses a directory and writes nothing', async () => {
    await mkdir(join(workspace, 'dir.md'))
    const before = await disk()
    const failure = await failureOf(endpoint().writeText(harness.scope, 'dir.md', 'mine\n', 'v', signal()))
    expect(failure.code).toBe('workspace-file/not-regular-file')
    expect(failure.details).toEqual({ path: 'dir.md', kind: 'directory' })
    expect(await disk()).toEqual(before)
  })

  it('refuses a final symlink even when it points back inside the workspace', async () => {
    await writeFile(join(workspace, 'real.md'), 'kept\n', 'utf8')
    await symlink(join(workspace, 'real.md'), join(workspace, 'link.md'))
    const before = await disk()
    const failure = await failureOf(endpoint().writeText(harness.scope, 'link.md', 'mine\n', 'v', signal()))
    expect(failure.code).toBe('workspace-file/not-regular-file')
    expect(failure.details).toEqual({ path: 'link.md', kind: 'symlink' })
    expect(await readFile(join(workspace, 'real.md'), 'utf8')).toBe('kept\n')
    expect(await disk()).toEqual(before)
  })
})

describe('workspaceFiles.writeText — the content cap', () => {
  it('refuses content one byte above the cap without touching the file', async () => {
    const path = join(workspace, 'notes.md')
    await writeFile(path, 'small\n', 'utf8')
    const limit = 1024 * 1024
    const failure = await failureOf(endpoint().writeText(harness.scope, 'notes.md', 'a'.repeat(limit + 1), await versionOf(path), signal()))
    expect(failure.code).toBe('workspace-file/too-large')
    expect(failure.details).toEqual({ path: 'notes.md', limit })
    expect(await readFile(path, 'utf8')).toBe('small\n')
  })

  it('accepts content exactly at the cap', async () => {
    const path = join(workspace, 'notes.md')
    await writeFile(path, 'small\n', 'utf8')
    const content = 'a'.repeat(1024 * 1024)
    const written = await endpoint().writeText(harness.scope, 'notes.md', content, await versionOf(path), signal())
    expect(written.bytes).toBe(1024 * 1024)
    expect((await readFile(path)).length).toBe(1024 * 1024)
  })
})

describe('workspaceFiles.writeText — line ending fidelity', () => {
  it('keeps an LF file byte-identical when the text is written back unchanged', async () => {
    const path = join(workspace, 'notes.md')
    await writeFile(path, 'one\ntwo\n', 'utf8')
    await endpoint().writeText(harness.scope, 'notes.md', 'one\ntwo\n', await versionOf(path), signal())
    expect(await readFile(path, 'utf8')).toBe('one\ntwo\n')
  })

  it('keeps a CRLF file CRLF when the LF text is written back unchanged', async () => {
    const path = join(workspace, 'notes.md')
    await writeFile(path, 'one\r\ntwo\r\n', 'utf8')
    await endpoint().writeText(harness.scope, 'notes.md', 'one\ntwo\n', await versionOf(path), signal())
    expect(await readFile(path, 'utf8')).toBe('one\r\ntwo\r\n')
  })

  it('keeps a CRLF file without a trailing newline byte-identical on write-back', async () => {
    const path = join(workspace, 'notes.md')
    await writeFile(path, 'one\r\ntwo', 'utf8')
    await endpoint().writeText(harness.scope, 'notes.md', 'one\ntwo', await versionOf(path), signal())
    expect(await readFile(path, 'utf8')).toBe('one\r\ntwo')
  })

  it('keeps a file without a trailing newline as read', async () => {
    const path = join(workspace, 'notes.md')
    await writeFile(path, 'one\ntwo', 'utf8')
    await endpoint().writeText(harness.scope, 'notes.md', 'one\ntwo', await versionOf(path), signal())
    expect(await readFile(path, 'utf8')).toBe('one\ntwo')
  })

  it('rewrites one line of a CRLF file and leaves every ending CRLF', async () => {
    const path = join(workspace, 'notes.md')
    await writeFile(path, 'one\r\ntwo\r\nthree\r\n', 'utf8')
    const written = await endpoint().writeText(harness.scope, 'notes.md', 'one\nTWO\nthree\n', await versionOf(path), signal())
    expect(await readFile(path, 'utf8')).toBe('one\r\nTWO\r\nthree\r\n')
    expect(written.bytes).toBe(Buffer.byteLength('one\r\nTWO\r\nthree\r\n', 'utf8'))
  })

  it('the filesystem seam writes the given text verbatim, so style restoration belongs to this endpoint', async () => {
    const path = join(workspace, 'notes.md')
    await writeFile(path, 'one\r\ntwo\r\n', 'utf8')
    const target = await harness.ctx.fs.resolve(path, { cwd: workspace })
    const info = await harness.ctx.fs.stat(target)
    if (info === undefined) throw new Error('expected the fixture file')
    await harness.ctx.fs.writeText(target, 'one\ntwo\n', { kind: 'replaceIfVersion', version: info.version })
    expect(await readFile(path, 'utf8')).toBe('one\ntwo\n')
  })

  it('writes a decoded BOM-stripped text back without the BOM, so editor clients refuse BOM files', async () => {
    const path = join(workspace, 'notes.md')
    await writeFile(path, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('one\ntwo\n', 'utf8')]))
    const raw = await readFile(path)
    expect(raw.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(true)
    // Read the way the preview client does: raw bytes through a UTF-8 decoder, which drops the BOM.
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(raw)
    expect(decoded).toBe('one\ntwo\n')
    await endpoint().writeText(harness.scope, 'notes.md', decoded, await versionOf(path), signal())
    expect(await readFile(path, 'utf8')).toBe('one\ntwo\n')
  })
})

describe('workspaceFiles.writeText — open watches observe the write', () => {
  it('reports one change to the file watch and one to the parent directory watch', async () => {
    const path = join(workspace, 'notes.md')
    await writeFile(path, 'one\n', 'utf8')
    const fileController = new AbortController()
    const dirController = new AbortController()
    const fileWatch = endpoint().changes(harness.scope, 'notes.md', fileController.signal)[Symbol.asyncIterator]()
    const dirWatch = endpoint().changes(harness.scope, '.', dirController.signal)[Symbol.asyncIterator]()
    try {
      expect(await fileWatch.next()).toEqual({ done: false, value: { kind: 'ready' } })
      expect(await dirWatch.next()).toEqual({ done: false, value: { kind: 'ready' } })
      const written = await endpoint().writeText(harness.scope, 'notes.md', 'two\n', await versionOf(path), signal())
      expect((await fileWatch.next()).value).toMatchObject({
        kind: 'change',
        change: { absolutePath: join(realpathSync(workspace), 'notes.md'), version: written.version },
      })
      expect((await dirWatch.next()).value).toMatchObject({
        kind: 'change',
        change: { absolutePath: realpathSync(workspace) },
      })
    } finally {
      fileController.abort()
      dirController.abort()
      await fileWatch.return?.()
      await dirWatch.return?.()
    }
  })
})
