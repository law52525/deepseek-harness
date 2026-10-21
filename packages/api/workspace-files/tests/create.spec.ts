/** The `create` endpoint: one empty entry inside the workspace, never over an existing one. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lstat, mkdir, readFile, readdir, readlink, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { realpathSync } from 'node:fs'
import { isEntryName } from '../src/name.ts'
import { failureOf, openWorkspace, signal, type Harness } from './harness.ts'

let harness: Harness
let workspace: string
let outside: string

beforeEach(async () => {
  harness = await openWorkspace('dsh-workspace-files-create-')
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

/** Create a link to a directory: a Windows junction where junctions exist, a directory symlink elsewhere. */
const directoryLink = (target: string, link: string): Promise<void> =>
  symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')

/** Every name under the two fixture directories, so a refused call can be shown to have written nothing. */
async function disk(): Promise<{ workspace: string[]; outside: string[] }> {
  return {
    workspace: (await readdir(workspace, { recursive: true })).sort(),
    outside: (await readdir(outside, { recursive: true })).sort(),
  }
}

describe('workspaceFiles.create — the happy path', () => {
  it('creates a 0-byte file in a workspace directory and returns its absolute path', async () => {
    await mkdir(join(workspace, 'src'))
    const created = await endpoint().create(harness.scope, join(workspace, 'src'), 'a.md', 'file', signal())
    expect(created).toEqual({ absolutePath: join(realpathSync(workspace), 'src', 'a.md'), type: 'file' })
    const info = await stat(created.absolutePath)
    expect(info.isFile()).toBe(true)
    expect(info.size).toBe(0)
    expect(await readdir(join(workspace, 'src'))).toEqual(['a.md'])
  })

  it('creates an empty directory', async () => {
    await mkdir(join(workspace, 'src'))
    const created = await endpoint().create(harness.scope, 'src', 'sub', 'directory', signal())
    expect(created).toEqual({ absolutePath: join(realpathSync(workspace), 'src', 'sub'), type: 'directory' })
    expect((await stat(created.absolutePath)).isDirectory()).toBe(true)
    expect(await readdir(created.absolutePath)).toEqual([])
    expect(await readdir(join(workspace, 'src'))).toEqual(['sub'])
  })

  it('creates in the workspace root, named relatively or absolutely', async () => {
    await endpoint().create(harness.scope, '.', 'root.txt', 'file', signal())
    await endpoint().create(harness.scope, workspace, 'root-dir', 'directory', signal())
    expect((await readdir(workspace)).sort()).toEqual(['root-dir', 'root.txt'])
  })

  it('keeps a name with spaces, dots, and non-ASCII characters as given', async () => {
    const created = await endpoint().create(harness.scope, '.', ' 笔记 v1..md', 'file', signal())
    expect(created.absolutePath).toBe(join(realpathSync(workspace), ' 笔记 v1..md'))
    expect(await readdir(workspace)).toEqual([' 笔记 v1..md'])
  })

  it('creates through a directory link whose target is inside the workspace', async () => {
    await mkdir(join(workspace, 'real-dir'))
    await directoryLink(join(workspace, 'real-dir'), join(workspace, 'dir-link'))
    const created = await endpoint().create(harness.scope, 'dir-link', 'child.txt', 'file', signal())
    expect(created.absolutePath).toBe(join(realpathSync(workspace), 'real-dir', 'child.txt'))
    expect(await readdir(join(workspace, 'real-dir'))).toEqual(['child.txt'])
  })

  it('fences the write to the Session workspace whatever the deployment sandbox mode', async () => {
    const service = endpoint()
    const writeText = vi.spyOn(harness.ctx.fs, 'writeText')
    const createDirectory = vi.spyOn(harness.ctx.fs, 'createDirectory')
    await service.create(harness.scope, '.', 'a.md', 'file', signal())
    await service.create(harness.scope, '.', 'sub', 'directory', signal())
    const policy = { mode: 'workspace-write', workspaceRoot: workspace }
    expect(writeText.mock.calls[0]?.slice(1, 3)).toEqual(['', { kind: 'createIfAbsent' }])
    expect(writeText.mock.calls[0]?.[4]).toEqual(policy)
    expect(createDirectory.mock.calls[0]?.[2]).toEqual(policy)
  })
})

describe('workspaceFiles.create — an existing entry is never replaced', () => {
  it.each(['file', 'directory'] as const)('refuses to create a %s over an existing file and keeps its bytes', async (type) => {
    const bytes = Buffer.from([0, 1, 2, 255, 10, 13])
    await writeFile(join(workspace, 'taken'), bytes)
    const before = await disk()
    const failure = await failureOf(endpoint().create(harness.scope, '.', 'taken', type, signal()))
    expect(failure.code).toBe('workspace-file/already-exists')
    expect(failure.details).toEqual({ path: join(realpathSync(workspace), 'taken') })
    expect((await readFile(join(workspace, 'taken'))).equals(bytes)).toBe(true)
    expect(await disk()).toEqual(before)
  })

  it.each(['file', 'directory'] as const)('refuses to create a %s over an existing directory and keeps its children', async (type) => {
    await mkdir(join(workspace, 'taken'))
    await writeFile(join(workspace, 'taken', 'child.txt'), 'kept', 'utf8')
    const before = await disk()
    const failure = await failureOf(endpoint().create(harness.scope, '.', 'taken', type, signal()))
    expect(failure.code).toBe('workspace-file/already-exists')
    expect(await readFile(join(workspace, 'taken', 'child.txt'), 'utf8')).toBe('kept')
    expect(await disk()).toEqual(before)
  })

  it.each(['file', 'directory'] as const)('refuses to create a %s over a dangling link and does not follow it', async (type) => {
    await symlink(join(workspace, 'missing'), join(workspace, 'dangling'))
    const failure = await failureOf(endpoint().create(harness.scope, '.', 'dangling', type, signal()))
    expect(failure.code).toBe('workspace-file/already-exists')
    expect(await readlink(join(workspace, 'dangling'))).toBe(join(workspace, 'missing'))
    expect((await readdir(workspace)).sort()).toEqual(['dangling'])
  })

  it.each(['file', 'directory'] as const)(
    'leaves an entry that appears after the existence check untouched (%s)',
    async (type) => {
      const service = endpoint()
      const taken = join(realpathSync(workspace), 'raced')
      // The check sees nothing at the name; the entry is there when the provider creates.
      const real = harness.ctx.fs.lstat.bind(harness.ctx.fs)
      vi.spyOn(harness.ctx.fs, 'lstat').mockImplementation(async (path, opts, abort) => {
        if (path !== taken) return real(path, opts, abort)
        if (type === 'file') await writeFile(taken, 'winner', 'utf8')
        else await mkdir(taken)
        return undefined
      })
      const failure = await failureOf(service.create(harness.scope, '.', 'raced', type, signal()))
      expect(failure.code).toBe('workspace-file/already-exists')
      expect(failure.details).toEqual({ path: taken })
      if (type === 'file') expect(await readFile(taken, 'utf8')).toBe('winner')
      else expect(await readdir(taken)).toEqual([])
      expect(await readdir(workspace)).toEqual(['raced'])
    },
  )

  it('refuses a file over a directory that appears after the existence check', async () => {
    const service = endpoint()
    const taken = join(realpathSync(workspace), 'raced')
    const real = harness.ctx.fs.lstat.bind(harness.ctx.fs)
    vi.spyOn(harness.ctx.fs, 'lstat').mockImplementation(async (path, opts, abort) => {
      if (path !== taken) return real(path, opts, abort)
      await mkdir(taken)
      return undefined
    })
    const failure = await failureOf(service.create(harness.scope, '.', 'raced', 'file', signal()))
    expect(failure.code).toBe('workspace-file/already-exists')
    expect((await lstat(taken)).isDirectory()).toBe(true)
  })
})

describe('workspaceFiles.create — the name is one path segment', () => {
  const NUL = String.fromCharCode(0)

  it.each([
    ['empty', ''],
    ['a space', ' '],
    ['whitespace only', ' \t\n'],
    ['the directory itself', '.'],
    ['the parent directory', '..'],
    ['a nested path', 'a/b'],
    ['a leading slash', '/etc'],
    ['a climbing path', '../escape'],
    ['a backslash', 'a\\b'],
    ['a climbing backslash path', '..\\escape'],
    ['a NUL', `a${NUL}b`],
  ])('refuses %s as invalid and writes nothing', async (_label, name) => {
    await mkdir(join(workspace, 'src'))
    const before = await disk()
    for (const type of ['file', 'directory'] as const) {
      const failure = await failureOf(endpoint().create(harness.scope, 'src', name, type, signal()))
      expect(failure.code).toBe('workspace-file/invalid-name')
      expect(failure.details).toEqual({ name })
    }
    expect(await disk()).toEqual(before)
  })

  it('refuses a drive or stream separator when the parent path is drive-rooted, and writes nothing', async () => {
    const service = endpoint()
    const before = await disk()
    vi.spyOn(harness.ctx.fs, 'processPath').mockReturnValue('C:\\work\\app')
    for (const name of ['a.txt:stream', 'D:']) {
      const failure = await failureOf(service.create(harness.scope, '.', name, 'file', signal()))
      expect(failure.code).toBe('workspace-file/invalid-name')
      expect(failure.details).toEqual({ name })
    }
    vi.restoreAllMocks()
    expect(await disk()).toEqual(before)
  })

  it('keeps a colon as an ordinary character where paths are not drive-rooted', () => {
    expect(isEntryName('a:b', false)).toBe(true)
    expect(isEntryName('a:b', true)).toBe(false)
    expect(isEntryName('C:', true)).toBe(false)
    expect(isEntryName('a.md', true)).toBe(true)
  })
})

describe('workspaceFiles.create — the parent is a workspace directory', () => {
  it.each(['file', 'directory'] as const)('refuses an absolute parent outside the workspace (%s)', async (type) => {
    const before = await disk()
    const failure = await failureOf(endpoint().create(harness.scope, outside, 'escape', type, signal()))
    expect(failure.code).toBe('workspace-file/outside-workspace')
    expect(await disk()).toEqual(before)
  })

  it('refuses a parent that climbs out of the workspace', async () => {
    const before = await disk()
    const failure = await failureOf(endpoint().create(harness.scope, '../outside', 'escape', 'file', signal()))
    expect(failure.code).toBe('workspace-file/outside-workspace')
    expect(await disk()).toEqual(before)
  })

  it.each(['file', 'directory'] as const)('refuses a parent link that resolves outside the workspace (%s)', async (type) => {
    await directoryLink(outside, join(workspace, 'escape'))
    const failure = await failureOf(endpoint().create(harness.scope, 'escape', 'planted', type, signal()))
    expect(failure.code).toBe('workspace-file/outside-workspace')
    expect(await readdir(outside)).toEqual([])
  })

  it.each(['file', 'directory'] as const)('refuses a name that is a link leaving the workspace (%s)', async (type) => {
    await writeFile(join(outside, 'secret.txt'), 'kept', 'utf8')
    await mkdir(join(outside, 'dir'))
    await symlink(join(outside, 'secret.txt'), join(workspace, 'to-file'))
    await directoryLink(join(outside, 'dir'), join(workspace, 'to-dir'))
    for (const name of ['to-file', 'to-dir']) {
      const failure = await failureOf(endpoint().create(harness.scope, '.', name, type, signal()))
      expect(failure.code).toBe('workspace-file/outside-workspace')
    }
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('kept')
    expect((await readdir(outside, { recursive: true })).sort()).toEqual(['dir', 'secret.txt'])
  })

  it('reports a missing parent as not found and does not create it', async () => {
    const failure = await failureOf(endpoint().create(harness.scope, 'nope', 'a.md', 'file', signal()))
    expect(failure.code).toBe('workspace-file/not-found')
    expect(await readdir(workspace)).toEqual([])
  })

  it('reports a file parent as not a directory', async () => {
    await writeFile(join(workspace, 'notes.txt'), 'hello', 'utf8')
    const failure = await failureOf(endpoint().create(harness.scope, 'notes.txt', 'a.md', 'file', signal()))
    expect(failure.code).toBe('workspace-file/not-directory')
    expect(failure.details).toMatchObject({ path: 'notes.txt', kind: 'file' })
    expect(await readFile(join(workspace, 'notes.txt'), 'utf8')).toBe('hello')
  })

  it('refuses an empty parent path as a bad request', async () => {
    const failure = await failureOf(endpoint().create(harness.scope, '', 'a.md', 'file', signal()))
    expect(failure.code).toBe('gateway/bad-request')
  })
})

describe('workspaceFiles.create — provider failures', () => {
  it('passes on a provider refusal that is not a collision, unclassified', async () => {
    const service = endpoint()
    const refusal = Object.assign(new Error('Directory creation is not supported by this provider.'), { code: 'FS_IO_ERROR' })
    vi.spyOn(harness.ctx.fs, 'createDirectory').mockRejectedValue(refusal)
    await expect(service.create(harness.scope, '.', 'sub', 'directory', signal())).rejects.toBe(refusal)
    expect(await readdir(workspace)).toEqual([])
  })
})

describe('workspaceFiles.create — the directory watch', () => {
  it.each(['file', 'directory'] as const)('invalidates an open watch on the parent directory (%s)', async (type) => {
    const service = endpoint()
    const controller = new AbortController()
    const frames = service.changes(harness.scope, '.', controller.signal)[Symbol.asyncIterator]()
    try {
      expect(await frames.next()).toEqual({ done: false, value: { kind: 'ready' } })
      await service.create(harness.scope, '.', 'made', type, signal())
      const frame = await frames.next()
      expect(frame.value).toMatchObject({ kind: 'change', change: { absolutePath: realpathSync(workspace) } })
    } finally {
      controller.abort()
      await frames.return?.()
    }
  })
})
