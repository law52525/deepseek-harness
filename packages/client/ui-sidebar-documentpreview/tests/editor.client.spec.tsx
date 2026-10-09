// @vitest-environment jsdom
/**
 * The editable source viewer: which files open as text, when the draft reaches
 * the disk, and what happens when the disk moves under it.
 *
 * The fixture's engine runs over scripted Remote mocks; `scriptedDisk` gives
 * the write half a small disk, so "the file changed underneath" is a fact the
 * test makes rather than one it asserts around. Debounce timing runs on fake
 * timers, so 800 ms is exact and no case waits in real time.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { WorkspaceFileStat } from '@deepseek-ai/dsh-api-workspace-files/types'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import type { AddToConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { TextPreview } from '../src/client/TextPreview.tsx'
import type { TextPreviewProps } from '../src/client/TextPreview.tsx'
import type { DocumentPreviewDefinition } from '../src/client/document/registry.ts'
import { CODE_BODY_ID } from '../src/client/code/index.ts'
import { markdownDefinition } from '../src/client/markdown/index.ts'
import { PLAIN_BODY_ID, textBodyDefinition } from '../src/client/text/index.ts'
import { EDIT_DEBOUNCE_MS, EDIT_MAX_BYTES } from '../src/client/edit/access.ts'
import {
  ABSOLUTE_PATH, FILE, PATH, TAB_ID, harness, page, settle, type Harness,
} from './fixtures.client.ts'

afterEach(cleanup)

const TAB2 = 'tab-2' as TabId
const EDITOR = '[data-textpreview-editor]'
const CWD = '/host/project'

const scrollTopDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop')

// jsdom lays nothing out and drops `scrollTop` writes; the specs keep the
// value so the editor's own restore path can be asserted.
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', {
    configurable: true,
    get(this: HTMLElement & { __scrollTop?: number }) { return this.__scrollTop ?? 0 },
    set(this: HTMLElement & { __scrollTop?: number }, value: number) { this.__scrollTop = value },
  })
})
afterAll(() => {
  if (scrollTopDescriptor === undefined) Reflect.deleteProperty(HTMLElement.prototype, 'scrollTop')
  else Object.defineProperty(HTMLElement.prototype, 'scrollTop', scrollTopDescriptor)
})

/** The three viewers the access matrix distinguishes: Markdown, Code, plain. */
function viewers(): readonly DocumentPreviewDefinition[] {
  return [
    markdownDefinition(() => 'Markdown'),
    {
      id: CODE_BODY_ID, extensions: ['md', 'markdown', 'yaml', 'yml', 'json', 'ts'],
      priority: 'builtin', title: () => 'Code', loading: 'text-pages', wrap: true,
    },
    textBodyDefinition(() => 'Plain text'),
  ]
}

/** The tab's props with the viewer list and any per-case extras. */
function propsFor(h: Harness, overrides: { addToConversation?: AddToConversation } = {}): TextPreviewProps {
  return {
    ...h.props(),
    useDocumentPreviews: selector => selector(viewers()),
    ...overrides,
  }
}

/** The mounted editor textarea. */
function areaOf(view: { container: HTMLElement }): HTMLTextAreaElement {
  const area = view.container.querySelector(EDITOR)
  if (!(area instanceof HTMLTextAreaElement)) throw new Error('the editor textarea is not mounted')
  return area
}

/** One tab's editor state, as the body reads it. */
function editOf(h: Harness) {
  return h.instance.getSnapshot().byTab[TAB_ID]?.edit
}

/** Run this case's clock on fake timers, restored however it ends. */
function fakeTimers(): void {
  vi.useFakeTimers()
  onTestFinished(() => { vi.useRealTimers() })
}

/** Move the fake clock and settle the async work the timers start. */
async function tick(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    await Promise.resolve()
    await Promise.resolve()
  })
}

/**
 * The engine's write half behind a small in-memory disk: complete reads answer
 * its current text and version, a version-guarded write replaces the text or
 * refuses as stale, and `external` is someone else writing.
 */
function scriptedDisk(h: Harness, initial: string, version = 'v1') {
  let text = initial
  let current = version
  const encoder = new TextEncoder()
  const bytes = (value: string): Uint8Array<ArrayBuffer> => encoder.encode(value)
  const bump = (): void => { current = `v${String(Number(current.slice(1)) + 1)}` }
  h.bytes.mockImplementation(async () => ({
    ok: true,
    value: { absolutePath: ABSOLUTE_PATH, version: current, offset: 0, eof: true, bytes: bytes(text).byteLength, data: bytes(text) },
  }))
  h.write.mockImplementation(async (_file, content, expectedVersion) => {
    if (expectedVersion !== current) {
      return { ok: false, error: new RemoteError('workspace-file/stale-version', 'disk moved', { path: PATH, version: current }) }
    }
    text = content
    bump()
    return { ok: true, value: { absolutePath: ABSOLUTE_PATH, version: current } }
  })
  h.stat.mockImplementation(async () => ({ ok: true, value: { absolutePath: ABSOLUTE_PATH, version: current } }))
  return {
    get text() { return text },
    get version() { return current },
    external(next: string) { text = next; bump() },
  }
}

/**
 * Render the body over one harness and wait for its read. `viewer` is the
 * viewer chosen before the first render; the default is editable, and `null`
 * leaves the automatic selection alone.
 */
async function mountEditor(
  h: Harness,
  overrides: { addToConversation?: AddToConversation } = {},
  viewer: string | null = PLAIN_BODY_ID,
) {
  if (viewer !== null) h.instance.actions.selected(TAB_ID, viewer)
  const view = render(<TextPreview {...propsFor(h, overrides)} />)
  await settle()
  return view
}

/** A tab that has typed one edit and still holds it, for the save paths. */
async function dirty(h: Harness, text = 'alpha!', viewer: string | null = PLAIN_BODY_ID) {
  const view = await mountEditor(h, {}, viewer)
  fireEvent.change(areaOf(view), { target: { value: text } })
  return view
}

describe('editable viewer access', () => {
  it.each([
    { label: 'notes.md default viewer', path: 'notes.md', viewer: undefined, editable: false },
    { label: 'notes.md via Code', path: 'notes.md', viewer: CODE_BODY_ID, editable: true },
    { label: 'notes.md via Plain text', path: 'notes.md', viewer: PLAIN_BODY_ID, editable: true },
    { label: 'config.yaml default viewer', path: 'config.yaml', viewer: undefined, editable: true },
    { label: 'config.yaml via Plain text', path: 'config.yaml', viewer: PLAIN_BODY_ID, editable: true },
    { label: 'config.yml default viewer', path: 'config.yml', viewer: undefined, editable: true },
    { label: 'notes.txt (plain fallback only)', path: 'notes.txt', viewer: undefined, editable: false },
    { label: 'app.json via Code', path: 'app.json', viewer: CODE_BODY_ID, editable: false },
    { label: 'mod.ts via Code', path: 'mod.ts', viewer: CODE_BODY_ID, editable: false },
  ])('$label: editor present = $editable', async ({ path, viewer, editable }) => {
    const h = harness({}, TAB_ID, { cwd: CWD, path })
    scriptedDisk(h, 'alpha\nbeta')
    const view = await mountEditor(h, {}, viewer ?? null)
    const area = view.container.querySelector(EDITOR)
    expect(area !== null).toBe(editable)
    // Reasons are only for files the rules would otherwise allow.
    expect(view.container.querySelector('[data-textpreview-readonly]')).toBeNull()
    if (editable) {
      expect((area as HTMLTextAreaElement).value).toBe('alpha\nbeta')
      expect(h.bytes).toHaveBeenCalledOnce()
      expect(h.read).not.toHaveBeenCalled()
    } else {
      expect(h.read).toHaveBeenCalled()
    }
  })

  it('names the reason a workspace-external markdown stays read-only', async () => {
    const h = harness({}, TAB_ID, { cwd: CWD, path: '../outside.md' })
    scriptedDisk(h, 'alpha')
    const view = await mountEditor(h)
    expect(view.container.querySelector(EDITOR)).toBeNull()
    expect(view.container.querySelector('[data-textpreview-readonly]')?.getAttribute('data-textpreview-readonly')).toBe('outside')
    expect(view.container.querySelector('[data-textpreview-readonly]')?.textContent).toBe('edit.readonly.outside')
  })

  it('refuses files the disk read finds too large, non-text, or carrying a BOM', async () => {
    const cases = [
      { path: 'notes.md', data: new Uint8Array(EDIT_MAX_BYTES + 1), reason: 'too-large' },
      { path: 'config.yaml', data: new Uint8Array([0x61, 0xff]), reason: 'not-text' },
      { path: 'config.yaml', data: new Uint8Array([0xef, 0xbb, 0xbf, 0x61]), reason: 'bom' },
    ] as const
    for (const { path, data, reason } of cases) {
      const h = harness({}, TAB_ID, { cwd: CWD, path })
      h.scriptBytes({ ok: true, value: { absolutePath: ABSOLUTE_PATH, version: 'v1', offset: 0, eof: true, data } })
      const view = await mountEditor(h)
      expect(view.container.querySelector(EDITOR)).toBeNull()
      expect(view.container.querySelector('[data-textpreview-readonly]')?.getAttribute('data-textpreview-readonly')).toBe(reason)
      view.unmount()
    }
  })

  it('defaults a refused editable file to the reason span\'s exact text', async () => {
    const h = harness({}, TAB_ID, { cwd: CWD })
    h.scriptBytes({ ok: true, value: { absolutePath: ABSOLUTE_PATH, version: 'v1', offset: 0, eof: true, data: new Uint8Array(EDIT_MAX_BYTES + 1) } })
    const view = await mountEditor(h)
    expect(view.container.querySelector('[data-textpreview-readonly]')?.textContent).toBe('edit.readonly.tooLarge(limit=1 MB)')
  })
})

describe('editor content', () => {
  it('holds the complete file, not just its first page', async () => {
    const h = harness({}, TAB_ID, { cwd: CWD })
    const text = Array.from({ length: 12 }, (_v, index) => `line-${index + 1}`).join('\n')
    scriptedDisk(h, text)
    const view = await mountEditor(h)
    expect(areaOf(view).value).toBe(text)
    expect(h.read).not.toHaveBeenCalled()
  })
})

describe('autosave', () => {
  it('writes once 800 ms after the last input, with the baseline version', async () => {
    fakeTimers()
    const h = harness({}, TAB_ID, { cwd: CWD })
    const disk = scriptedDisk(h, 'alpha\nbeta')
    const view = await dirty(h, 'alpha\nbeta!')
    await tick(EDIT_DEBOUNCE_MS - 1)
    expect(h.write).not.toHaveBeenCalled()
    await tick(1)
    expect(h.write).toHaveBeenCalledExactlyOnceWith(FILE, 'alpha\nbeta!', 'v1', expect.any(AbortSignal))
    expect(disk.text).toBe('alpha\nbeta!')
    expect(disk.version).toBe('v2')
    expect(editOf(h)).toMatchObject({ savedText: 'alpha\nbeta!', version: 'v2', saving: false })
    expect(view.container.querySelector('[data-textpreview-edit-status]')?.getAttribute('data-textpreview-edit-status')).toBe('saved')
  })

  it('coalesces a burst to its last text and sends nothing when the text is unchanged', async () => {
    fakeTimers()
    const h = harness({}, TAB_ID, { cwd: CWD })
    scriptedDisk(h, 'alpha')
    const view = await dirty(h, 'a')
    await tick(300)
    fireEvent.change(areaOf(view), { target: { value: 'ab' } })
    await tick(700)
    expect(h.write).not.toHaveBeenCalled()
    await tick(100)
    expect(h.write).toHaveBeenCalledExactlyOnceWith(FILE, 'ab', 'v1', expect.any(AbortSignal))
    // Back to the saved text: the store owes the disk nothing.
    await settle()
    fireEvent.change(areaOf(view), { target: { value: 'ab' } })
    await tick(EDIT_DEBOUNCE_MS)
    expect(h.write).toHaveBeenCalledOnce()
  })

  it('chains the newest draft behind an in-flight save instead of racing it', async () => {
    fakeTimers()
    const h = harness({}, TAB_ID, { cwd: CWD })
    scriptedDisk(h, 'alpha')
    const calls: { content: string; expected: string; settle: (result: RemoteResult<WorkspaceFileStat>) => void }[] = []
    h.write.mockImplementation((_file, content, expectedVersion) => new Promise((resolve) => {
      calls.push({ content, expected: expectedVersion, settle: resolve })
    }))
    const view = await dirty(h, 'a')
    await tick(EDIT_DEBOUNCE_MS)
    expect(calls.map(call => [call.content, call.expected])).toEqual([['a', 'v1']])
    expect(typeof calls[0]?.settle).toBe('function')
    fireEvent.change(areaOf(view), { target: { value: 'ab' } })
    await tick(EDIT_DEBOUNCE_MS)
    fireEvent.blur(areaOf(view))
    expect(calls).toHaveLength(1)
    await act(async () => { calls[0]!.settle({ ok: true, value: { absolutePath: ABSOLUTE_PATH, version: 'v2' } }) })
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({ content: 'ab', expected: 'v2' })
    await act(async () => { calls[1]!.settle({ ok: true, value: { absolutePath: ABSOLUTE_PATH, version: 'v3' } }) })
    expect(editOf(h)).toMatchObject({ text: 'ab', savedText: 'ab', version: 'v3', saving: false })
  })

  it('saves at once when the body leaves the editor: blur, ⌘S, unmount', async () => {
    for (const how of ['blur', 'meta-s', 'unmount'] as const) {
      const h = harness({}, TAB_ID, { cwd: CWD })
      scriptedDisk(h, 'alpha')
      const view = await dirty(h, 'alpha!')
      if (how === 'blur') fireEvent.blur(areaOf(view))
      else if (how === 'meta-s') fireEvent.keyDown(window, { key: 's', metaKey: true })
      else view.unmount()
      expect(h.write, how).toHaveBeenCalledExactlyOnceWith(FILE, 'alpha!', 'v1', expect.any(AbortSignal))
    }
  })

  it('saves before the viewer menu switches to Markdown, which renders the new text', async () => {
    const h = harness({}, TAB_ID, { cwd: CWD })
    const disk = scriptedDisk(h, 'alpha\nbeta\ngamma')
    const view = await dirty(h, 'alpha\nbeta\ngamma\ndelta')
    h.script(1, page(1, ['alpha', 'beta', 'gamma', 'delta'], true))
    fireEvent.click(view.container.querySelector('[data-document-viewer-menu]')!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Markdown' }))
    expect(h.write).toHaveBeenCalledExactlyOnceWith(FILE, 'alpha\nbeta\ngamma\ndelta', 'v1', expect.any(AbortSignal))
    expect(disk.text).toBe('alpha\nbeta\ngamma\ndelta')
    await settle()
    expect(view.container.querySelector(EDITOR)).toBeNull()
    expect(view.container.querySelector('[data-textpreview-plain]')?.textContent).toContain('delta')
  })

  it('keeps the draft when Code and Plain text switch between each other', async () => {
    const h = harness({}, TAB_ID, { cwd: CWD })
    scriptedDisk(h, 'alpha')
    const view = await dirty(h, 'alpha!', CODE_BODY_ID)
    fireEvent.click(view.container.querySelector('[data-document-viewer-menu]')!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Plain text' }))
    await settle()
    expect(areaOf(view).value).toBe('alpha!')
    expect(h.bytes).toHaveBeenCalledOnce()
    expect(h.read).not.toHaveBeenCalled()
  })
})

describe('the disk moves under the editor', () => {
  it('treats the version echo of its own save as no change', async () => {
    fakeTimers()
    const h = harness({}, TAB_ID, { cwd: CWD })
    const disk = scriptedDisk(h, 'alpha')
    const view = await dirty(h, 'alpha!')
    await tick(EDIT_DEBOUNCE_MS)
    expect(disk.version).toBe('v2')
    areaOf(view).setSelectionRange(3, 3)
    act(() => { h.setVersion('v2'); h.instance.actions.resourceChanged(TAB_ID) })
    await settle()
    expect(h.bytes).toHaveBeenCalledOnce()
    expect(areaOf(view).value).toBe('alpha!')
    expect(areaOf(view).selectionStart).toBe(3)
    expect(view.container.querySelector('[data-textpreview-changed]')).toBeNull()
    expect(view.container.querySelector('[data-textpreview-edit-conflict]')).toBeNull()
  })

  it('follows an external change silently while the draft is clean', async () => {
    const h = harness({}, TAB_ID, { cwd: CWD })
    const disk = scriptedDisk(h, 'alpha\nbeta')
    const view = await mountEditor(h)
    act(() => { disk.external('fresh\nlines'); h.setVersion(disk.version); h.instance.actions.resourceChanged(TAB_ID) })
    await settle()
    expect(h.bytes).toHaveBeenCalledTimes(2)
    expect(areaOf(view).value).toBe('fresh\nlines')
    expect(editOf(h)).toMatchObject({ version: 'v2', conflict: false })
    expect(view.container.querySelector('[data-textpreview-edit-status]')?.getAttribute('data-textpreview-edit-status')).toBe('saved')
    expect(h.write).not.toHaveBeenCalled()
  })

  it('pauses on an external change under a dirty draft and resumes after overwriting', async () => {
    fakeTimers()
    const h = harness({}, TAB_ID, { cwd: CWD })
    const disk = scriptedDisk(h, 'alpha')
    const view = await dirty(h, 'alpha!')
    act(() => { disk.external('their version'); h.setVersion(disk.version); h.instance.actions.resourceChanged(TAB_ID) })
    await settle()
    expect(view.container.querySelector('[data-textpreview-edit-conflict]')).not.toBeNull()
    expect(editOf(h)?.conflict).toBe(true)
    // While the question stands, neither input nor a flush writes.
    fireEvent.change(areaOf(view), { target: { value: 'alpha!!' } })
    await tick(EDIT_DEBOUNCE_MS)
    fireEvent.blur(areaOf(view))
    expect(h.write).not.toHaveBeenCalled()
    fireEvent.click(view.container.querySelector('[data-textpreview-edit-overwrite]')!)
    await settle()
    expect(h.stat).toHaveBeenCalledOnce()
    expect(h.write).toHaveBeenCalledExactlyOnceWith(FILE, 'alpha!!', 'v2', expect.any(AbortSignal))
    expect(disk.text).toBe('alpha!!')
    expect(editOf(h)?.conflict).toBe(false)
    // The fresh version became the baseline: the next save carries it.
    fireEvent.change(areaOf(view), { target: { value: 'alpha!!!' } })
    await tick(EDIT_DEBOUNCE_MS)
    expect(h.write).toHaveBeenLastCalledWith(FILE, 'alpha!!!', 'v3', expect.any(AbortSignal))
    expect(view.container.querySelector('[data-textpreview-edit-conflict]')).toBeNull()
  })

  it('replaces the draft with the disk version on demand', async () => {
    fakeTimers()
    const h = harness({}, TAB_ID, { cwd: CWD })
    const disk = scriptedDisk(h, 'alpha')
    const view = await dirty(h, 'mine')
    act(() => { disk.external('theirs'); h.setVersion(disk.version); h.instance.actions.resourceChanged(TAB_ID) })
    await settle()
    fireEvent.click(view.container.querySelector('[data-textpreview-edit-load-disk]')!)
    await settle()
    expect(areaOf(view).value).toBe('theirs')
    expect(editOf(h)).toMatchObject({ version: 'v2', conflict: false })
    fireEvent.change(areaOf(view), { target: { value: 'theirs!' } })
    await tick(EDIT_DEBOUNCE_MS)
    expect(h.write).toHaveBeenCalledExactlyOnceWith(FILE, 'theirs!', 'v2', expect.any(AbortSignal))
  })

  it('pauses when a save is refused as stale, keeping the draft', async () => {
    fakeTimers()
    const h = harness({}, TAB_ID, { cwd: CWD })
    const disk = scriptedDisk(h, 'alpha')
    const view = await dirty(h, 'alpha!')
    // The disk moves without the metadata telling this tab.
    disk.external('moved on')
    await tick(EDIT_DEBOUNCE_MS)
    expect(h.write).toHaveBeenCalledOnce()
    await settle()
    expect(editOf(h)?.conflict).toBe(true)
    expect(areaOf(view).value).toBe('alpha!')
    expect(view.container.querySelector('[data-textpreview-edit-conflict]')).not.toBeNull()
    fireEvent.change(areaOf(view), { target: { value: 'alpha!!' } })
    await tick(EDIT_DEBOUNCE_MS)
    expect(h.write).toHaveBeenCalledOnce()
  })

  it('shows a failed save with a retry that then succeeds', async () => {
    fakeTimers()
    const h = harness({}, TAB_ID, { cwd: CWD })
    const disk = scriptedDisk(h, 'alpha')
    h.write.mockResolvedValueOnce({ ok: false, error: new RemoteError('workspace-file/too-large', 'too big', { path: PATH, limit: 1024 * 1024 }) })
    const view = await dirty(h, 'alpha!')
    await tick(EDIT_DEBOUNCE_MS)
    await settle()
    const bar = view.container.querySelector('[data-textpreview-edit-failed]')
    expect(bar?.getAttribute('data-textpreview-edit-failed')).toBe('workspace-file/too-large')
    expect(areaOf(view).value).toBe('alpha!')
    expect(view.container.querySelector('[data-textpreview-edit-status]')?.getAttribute('data-textpreview-edit-status')).toBe('failed')
    fireEvent.click(view.container.querySelector('[data-textpreview-edit-retry]')!)
    await settle()
    expect(h.write).toHaveBeenCalledTimes(2)
    expect(disk.text).toBe('alpha!')
    expect(view.container.querySelector('[data-textpreview-edit-failed]')).toBeNull()
    expect(view.container.querySelector('[data-textpreview-edit-status]')?.getAttribute('data-textpreview-edit-status')).toBe('saved')
  })

  it('saves again after a failure when the reader keeps typing', async () => {
    fakeTimers()
    const h = harness({}, TAB_ID, { cwd: CWD })
    const disk = scriptedDisk(h, 'alpha')
    h.write.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'carrier fault', {}) })
    const view = await dirty(h, 'alpha!')
    await tick(EDIT_DEBOUNCE_MS)
    await settle()
    expect(view.container.querySelector('[data-textpreview-edit-failed]')).not.toBeNull()
    fireEvent.change(areaOf(view), { target: { value: 'alpha!!' } })
    expect(view.container.querySelector('[data-textpreview-edit-failed]')).toBeNull()
    await tick(EDIT_DEBOUNCE_MS)
    expect(h.write).toHaveBeenCalledTimes(2)
    expect(disk.text).toBe('alpha!!')
  })
})

describe('editor key handling', () => {
  it('inserts two spaces for Tab and keeps the caret and focus', async () => {
    fakeTimers()
    const h = harness({}, TAB_ID, { cwd: CWD })
    scriptedDisk(h, 'alpha\nbeta')
    const view = await mountEditor(h)
    const area = areaOf(view)
    area.focus()
    area.setSelectionRange(3, 3)
    fireEvent.keyDown(area, { key: 'Tab' })
    expect(area.value).toBe('alp  ha\nbeta')
    expect(area.selectionStart).toBe(5)
    expect(document.activeElement).toBe(area)
    await tick(EDIT_DEBOUNCE_MS)
    expect(h.write).toHaveBeenCalledExactlyOnceWith(FILE, 'alp  ha\nbeta', 'v1', expect.any(AbortSignal))
  })

  it('holds saving through an input-method composition and ignores Tab while composing', async () => {
    fakeTimers()
    const h = harness({}, TAB_ID, { cwd: CWD })
    scriptedDisk(h, 'alpha\nbeta')
    const view = await mountEditor(h)
    const area = areaOf(view)
    fireEvent.compositionStart(area)
    fireEvent.keyDown(area, { key: 'Tab', isComposing: true })
    expect(area.value).toBe('alpha\nbeta')
    fireEvent.change(area, { target: { value: 'alpha\nbe\u0301ta' } })
    await tick(EDIT_DEBOUNCE_MS)
    expect(h.write).not.toHaveBeenCalled()
    fireEvent.compositionEnd(area)
    await tick(EDIT_DEBOUNCE_MS)
    expect(h.write).toHaveBeenCalledExactlyOnceWith(FILE, 'alpha\nbe\u0301ta', 'v1', expect.any(AbortSignal))
  })
})

describe('per-tab editor state', () => {
  it('keeps each tab\'s viewer choice, draft, and scroll position across a tab switch', async () => {
    fakeTimers()
    const h = harness({}, TAB_ID, { cwd: CWD })
    scriptedDisk(h, 'alpha\nbeta\ngamma')
    const props = propsFor(h)
    const info = props.useTabInfo()
    const first = render(<TextPreview {...props} />)
    await settle()
    fireEvent.click(first.container.querySelector('[data-document-viewer-menu]')!)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Plain text' }))
    await settle()
    fireEvent.change(areaOf(first), { target: { value: 'alpha\nbeta!\ngamma' } })
    await tick(EDIT_DEBOUNCE_MS)
    areaOf(first).scrollTop = 40
    fireEvent.scroll(areaOf(first))
    expect(editOf(h)?.text).toBe('alpha\nbeta!\ngamma')
    first.unmount()
    // The other tab opens the same file under its own default viewer.
    const second = render(<TextPreview {...props} useTabInfo={() => ({ ...info, tab: { ...info.tab, id: TAB2 } })} />)
    await settle()
    expect(second.container.querySelector(EDITOR)).toBeNull()
    expect(h.instance.getSnapshot().byTab[TAB2]?.edit).toBeUndefined()
    second.unmount()
    // Back to the first tab: its choice, its text, and its offset are waiting.
    const back = render(<TextPreview {...props} />)
    const area = areaOf(back)
    expect(area.value).toBe('alpha\nbeta!\ngamma')
    expect(back.container.querySelector('[data-document-viewer-menu]')?.textContent).toBe('Plain text')
    expect(area.scrollTop).toBe(40)
    expect(h.bytes).toHaveBeenCalledOnce()
  })
})

describe('the editor selection menu', () => {
  it('offers copy, cut, and add-to-conversation with exact line numbers', async () => {
    fakeTimers()
    const h = harness({}, TAB_ID, { cwd: CWD })
    scriptedDisk(h, 'alpha\nbeta\ngamma')
    const addToConversation = vi.fn<AddToConversation>(() => 'inserted')
    const view = await mountEditor(h, { addToConversation })
    const clipboard = vi.fn(async () => {})
    const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } })
    onTestFinished(() => {
      if (previous === undefined) Reflect.deleteProperty(navigator, 'clipboard')
      else Object.defineProperty(navigator, 'clipboard', previous)
    })
    const area = areaOf(view)
    area.setSelectionRange(6, 16)
    fireEvent.contextMenu(area, { clientX: 12, clientY: 34 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'menu.addSelection' }))
    expect(addToConversation).toHaveBeenCalledExactlyOnceWith({
      kind: 'fragment',
      text: '```markdown\n/host/project/work/notes.md:2-3\nbeta\ngamma\n```',
    })
    area.setSelectionRange(0, 5)
    fireEvent.contextMenu(area, { clientX: 1, clientY: 2 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'menu.copy' }))
    expect(clipboard).toHaveBeenCalledWith('alpha')
    area.setSelectionRange(6, 16)
    fireEvent.contextMenu(area, { clientX: 1, clientY: 2 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'menu.cut' }))
    expect(clipboard).toHaveBeenLastCalledWith('beta\ngamma')
    expect(area.value).toBe('alpha\n')
    await tick(EDIT_DEBOUNCE_MS)
    expect(h.write).toHaveBeenCalledExactlyOnceWith(FILE, 'alpha\n', 'v1', expect.any(AbortSignal))
  })

  it('leaves the platform menu alone without a selection', async () => {
    const h = harness({}, TAB_ID, { cwd: CWD })
    scriptedDisk(h, 'alpha\nbeta')
    const view = await mountEditor(h)
    fireEvent.contextMenu(areaOf(view), { clientX: 3, clientY: 4 })
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('disables adding to the conversation when the verb is absent', async () => {
    const h = harness({}, TAB_ID, { cwd: CWD })
    scriptedDisk(h, 'alpha\nbeta')
    const view = await mountEditor(h)
    const area = areaOf(view)
    area.setSelectionRange(0, 5)
    fireEvent.contextMenu(area, { clientX: 3, clientY: 4 })
    const item = screen.getByRole('menuitem', { name: 'menu.addSelection' })
    expect((item as HTMLButtonElement).disabled).toBe(true)
  })
})
