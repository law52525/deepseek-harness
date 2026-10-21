/** Tab-local directory caches, expansion preferences, and refresh settings. */
import { describe, expect, it } from 'vitest'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { createFilesStore } from '../src/client/store.ts'
import type { DirLevel } from '../src/client/store.ts'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'

const ROOT = '/work/app'
const TAB = 'tab-1' as TabId

const LEVEL: DirLevel = {
  entries: [{ name: 'src', type: 'directory' }, { name: 'README.md', type: 'file', size: 12 }],
  truncated: false,
}

describe('createFilesStore', () => {
  it('mints an independent instance per call', () => {
    const first = createFilesStore().create()
    const second = createFilesStore().create()
    first.actions.start(TAB, ROOT)
    expect(second.getSnapshot().byTab[TAB]).toBeUndefined()
  })

  it('seeds a tab at its root with the root expanded and nothing loaded', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const getSnapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot()
    actions.start(TAB, ROOT)
    expect(getSnapshot().byTab[TAB]).toEqual({ root: ROOT, levels: {}, expanded: [ROOT], scrollTop: 0, autoRefresh: true })
  })

  it('shows a failed initial listing and replaces it with a successful retry', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const getSnapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot()
    actions.start(TAB, ROOT)
    actions.loading(TAB, ROOT)
    expect(getSnapshot().byTab[TAB]!.levels[ROOT]).toEqual({ kind: 'loading' })
    const failure = new RemoteError('workspace-file/not-found', 'gone', { path: ROOT })
    actions.failed(TAB, ROOT, failure)
    expect(getSnapshot().byTab[TAB]!.levels[ROOT]).toEqual({ kind: 'failed', failure })
    actions.loading(TAB, ROOT)
    expect(getSnapshot().byTab[TAB]!.levels[ROOT]).toEqual({ kind: 'loading' })
    actions.loaded(TAB, ROOT, LEVEL)
    expect(getSnapshot().byTab[TAB]!.levels[ROOT]).toEqual({ kind: 'ready', level: LEVEL })
  })

  it('retains a loaded level during refresh and beside a refresh failure', () => {
    const store = createFilesStore().create()
    const { actions } = store
    actions.start(TAB, ROOT)
    actions.loaded(TAB, ROOT, LEVEL)
    const cached = store.getSnapshot().byTab[TAB]!.levels[ROOT]
    actions.loading(TAB, ROOT)
    expect(store.getSnapshot().byTab[TAB]!.levels[ROOT]).toBe(cached)
    const failure = new RemoteError('workspace-file/not-found', 'gone', { path: ROOT })
    actions.failed(TAB, ROOT, failure)
    expect(store.getSnapshot().byTab[TAB]!.levels[ROOT]).toEqual({ kind: 'ready', level: LEVEL, failure })
    actions.loaded(TAB, ROOT, LEVEL)
    expect(store.getSnapshot().byTab[TAB]!.levels[ROOT]).toEqual({ kind: 'ready', level: LEVEL })
  })

  it('toggles a directory in and out of the expanded set without touching its level', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const getSnapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot()
    const child = `${ROOT}/src`
    actions.start(TAB, ROOT)
    actions.loaded(TAB, child, LEVEL)
    actions.toggled(TAB, child)
    expect(getSnapshot().byTab[TAB]!.expanded).toEqual([ROOT, child])
    actions.toggled(TAB, child)
    expect(getSnapshot().byTab[TAB]!.expanded).toEqual([ROOT])
    expect(getSnapshot().byTab[TAB]!.levels[child]).toEqual({ kind: 'ready', level: LEVEL })
  })

  it('keeps one name row per tab through open, pending, refusal, and close', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const draft = (): unknown => store.getSnapshot().byTab[TAB]!.draft
    const failure = new RemoteError('workspace-file/already-exists', 'taken', { path: `${ROOT}/a.md` })
    actions.start(TAB, ROOT)
    actions.draftPending(TAB)
    actions.draftFailed(TAB, failure)
    expect(draft()).toBeUndefined()
    actions.draftOpened(TAB, ROOT, 'file')
    expect(draft()).toEqual({ parent: ROOT, type: 'file', pending: false })
    actions.draftFailed(TAB, failure)
    expect(draft()).toEqual({ parent: ROOT, type: 'file', pending: false, failure })
    actions.draftPending(TAB)
    expect(draft()).toEqual({ parent: ROOT, type: 'file', pending: true })
    actions.draftOpened(TAB, `${ROOT}/src`, 'directory')
    expect(draft()).toEqual({ parent: `${ROOT}/src`, type: 'directory', pending: false })
    actions.draftClosed(TAB)
    expect(draft()).toBeUndefined()
    expect('draft' in store.getSnapshot().byTab[TAB]!).toBe(false)
  })

  it('closes the name row when its directory is collapsed or leaves the listing', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const draft = (): unknown => store.getSnapshot().byTab[TAB]!.draft
    const src = `${ROOT}/src`
    const nested = `${src}/nested`
    actions.start(TAB, ROOT)
    actions.loaded(TAB, ROOT, LEVEL)
    actions.toggled(TAB, src)
    actions.toggled(TAB, nested)
    // Expanding and collapsing an unrelated or descendant directory leaves the row alone.
    actions.draftOpened(TAB, src, 'file')
    actions.toggled(TAB, nested)
    expect(draft()).toEqual({ parent: src, type: 'file', pending: false })
    actions.toggled(TAB, `${ROOT}/srcs`)
    actions.toggled(TAB, `${ROOT}/srcs`)
    expect(draft()).toEqual({ parent: src, type: 'file', pending: false })
    actions.toggled(TAB, src)
    expect(draft()).toBeUndefined()
    // A row in a descendant closes with its collapsed ancestor.
    actions.toggled(TAB, src)
    actions.draftOpened(TAB, nested, 'directory')
    actions.toggled(TAB, src)
    expect(draft()).toBeUndefined()
    // A row in the root survives; one under a directory that vanished does not.
    actions.draftOpened(TAB, ROOT, 'file')
    actions.loaded(TAB, ROOT, { entries: [], truncated: false })
    expect(draft()).toEqual({ parent: ROOT, type: 'file', pending: false })
    actions.loaded(TAB, ROOT, LEVEL)
    actions.draftOpened(TAB, nested, 'file')
    actions.loaded(TAB, ROOT, { entries: [], truncated: false })
    expect(draft()).toBeUndefined()
  })

  it('reset drops levels while keeping expansion, scroll, and the automatic setting', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const getSnapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot()
    const child = `${ROOT}/src`
    actions.start(TAB, ROOT)
    actions.loaded(TAB, ROOT, LEVEL)
    actions.toggled(TAB, child)
    actions.loaded(TAB, child, LEVEL)
    actions.scrolled(TAB, 120)
    actions.autoRefresh(TAB, false)
    actions.reset(TAB)
    expect(getSnapshot().byTab[TAB]).toEqual({ root: ROOT, levels: {}, expanded: [ROOT, child], scrollTop: 120, autoRefresh: false })
  })

  it('keeps the automatic setting independent for each tab', () => {
    const store = createFilesStore().create()
    const other = 'tab-2' as TabId
    store.actions.start(TAB, ROOT)
    store.actions.start(other, ROOT)
    store.actions.autoRefresh(TAB, false)
    expect(store.getSnapshot().byTab[TAB]!.autoRefresh).toBe(false)
    expect(store.getSnapshot().byTab[other]!.autoRefresh).toBe(true)
    store.actions.autoRefresh(TAB, true)
    expect(store.getSnapshot().byTab[TAB]!.autoRefresh).toBe(true)
  })

  it.each(['removed', 'file'] as const)('drops cached descendants and expansion when a directory is %s', (replacement) => {
    const store = createFilesStore().create()
    const { actions } = store
    const child = `${ROOT}/src`
    const grandchild = `${child}/nested`
    const sibling = `${ROOT}/src-other`
    actions.start(TAB, ROOT)
    actions.loaded(TAB, ROOT, { entries: [
      { name: 'src', type: 'directory' }, { name: 'src-other', type: 'directory' },
    ], truncated: false })
    for (const path of [child, grandchild, sibling]) {
      actions.toggled(TAB, path)
      actions.loaded(TAB, path, LEVEL)
    }
    actions.loaded(TAB, ROOT, { entries: replacement === 'file'
      ? [{ name: 'src', type: 'file' }, { name: 'src-other', type: 'directory' }]
      : [{ name: 'src-other', type: 'directory' }], truncated: false })
    const state = store.getSnapshot().byTab[TAB]!
    expect(state.expanded).toEqual([ROOT, sibling])
    expect(Object.keys(state.levels)).toEqual([ROOT, sibling])
    expect(state.levels[sibling]).toEqual({ kind: 'ready', level: LEVEL })
  })

  it('remembers where the body is scrolled to', () => {
    const store = createFilesStore().create()
    const { actions } = store
    actions.start(TAB, ROOT)
    actions.scrolled(TAB, 120)
    expect(store.getSnapshot().byTab[TAB]!.scrollTop).toBe(120)
  })

  it('refuses to write a level for a tab that was never started', () => {
    const { actions } = createFilesStore().create()
    expect(() => { actions.loading('tab-nowhere' as TabId, ROOT) }).toThrow('no tree for tab "tab-nowhere"')
  })

  it('forget removes exactly the tab that went away', () => {
    const store = createFilesStore().create()
    const { actions } = store
    const getSnapshot = (): ReturnType<typeof store.getSnapshot> => store.getSnapshot()
    actions.start(TAB, ROOT)
    actions.start('tab-2' as TabId, ROOT)
    actions.forget(TAB)
    expect(Object.keys(getSnapshot().byTab)).toEqual(['tab-2'])
  })
})
