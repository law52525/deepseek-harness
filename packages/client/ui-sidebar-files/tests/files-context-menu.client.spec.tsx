// @vitest-environment jsdom
/** File-tree context menus: add a row to the current conversation, and create a file or folder from a name row. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import type { DirLevel } from '../src/client/store.ts'
import { zh } from '../src/client/locales.ts'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { mountBody, ROOT, SESSION } from './mount.client.tsx'

const LEVEL: DirLevel = {
  entries: [
    { name: 'README.md', type: 'file', size: 12 },
    { name: 'src', type: 'directory' },
    { name: 'pipe', type: 'other' },
    { name: 'a"b.md', type: 'file', size: 3 },
  ],
  truncated: false,
}

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

/** Mount a settled tree with the given entry level. */
async function tree(withConversation = true) {
  const mounted = mountBody(ROOT, undefined, withConversation)
  await act(() => mounted.script.watches.ready(ROOT))
  await act(() => mounted.script.settle({ ok: true, value: LEVEL }))
  return mounted
}

function row(view: ReturnType<typeof mountBody>['view'], path: string): HTMLElement {
  const button = view.container.querySelector<HTMLElement>(`[data-files-path="${path}"] > button`)
  if (button === null) throw new Error(`no row button for ${path}`)
  return button
}

describe('FilesBody row context menu', () => {
  it('adds a right-clicked file as a reference chip and closes the menu', async () => {
    const { view, addToConversation } = await tree()
    act(() => { fireEvent.contextMenu(row(view, `${ROOT}/README.md`), { clientX: 40, clientY: 60 }) })
    const item = screen.getByRole('menuitem', { name: zh['menu.addToConversation'] })
    fireEvent.click(item)
    expect(addToConversation).toHaveBeenCalledWith({
      kind: 'reference', path: `${ROOT}/README.md`, target: 'file', label: 'README.md',
    })
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('adds a right-clicked directory with a trailing-slash folder label', async () => {
    const { view, addToConversation } = await tree()
    act(() => { fireEvent.contextMenu(row(view, `${ROOT}/src`), { clientX: 40, clientY: 80 }) })
    fireEvent.click(screen.getByRole('menuitem', { name: zh['menu.addToConversation'] }))
    expect(addToConversation).toHaveBeenCalledWith({
      kind: 'reference', path: `${ROOT}/src`, target: 'directory', label: 'src/',
    })
  })

  it('offers no menu on an "other" row', async () => {
    const { view } = await tree()
    const other = view.container.querySelector(`[data-files-path="${ROOT}/pipe"]`)!
    act(() => { fireEvent.contextMenu(other, { clientX: 40, clientY: 100 }) })
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('closes on Escape', async () => {
    const { view } = await tree()
    act(() => { fireEvent.contextMenu(row(view, `${ROOT}/README.md`), { clientX: 40, clientY: 60 }) })
    expect(screen.getByRole('menuitem', { name: zh['menu.addToConversation'] })).toBeDefined()
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('closes on an outside press', async () => {
    const { view } = await tree()
    act(() => { fireEvent.contextMenu(row(view, `${ROOT}/README.md`), { clientX: 40, clientY: 60 }) })
    expect(screen.getByRole('menuitem', { name: zh['menu.addToConversation'] })).toBeDefined()
    act(() => { fireEvent.pointerDown(document.body) })
    expect(screen.queryByRole('menuitem')).toBeNull()
  })

  it('disables the item when no add-to-draft verb is available', async () => {
    const { view } = await tree(false)
    act(() => { fireEvent.contextMenu(row(view, `${ROOT}/README.md`), { clientX: 40, clientY: 60 }) })
    const item = screen.getByRole('menuitem', { name: zh['menu.addToConversation'] }) as HTMLButtonElement
    expect(item.disabled).toBe(true)
  })

  it('shows a visible notice when the verb refuses the row', async () => {
    // A name the reference grammar cannot represent (a double quote) makes the
    // verb return `conflict`; the entry must say so, not close on a silent no-op.
    const { view, addToConversation } = await tree()
    addToConversation!.mockReturnValue('conflict')
    const files = [...view.container.querySelectorAll<HTMLElement>('[data-files-entry="file"]')]
    const target = files.find(li => li.getAttribute('data-files-path') === `${ROOT}/a"b.md`)
    if (target === undefined) throw new Error('no double-quoted file row')
    act(() => { fireEvent.contextMenu(target.querySelector('button')!, { clientX: 40, clientY: 60 }) })
    vi.useFakeTimers()
    act(() => { fireEvent.click(screen.getByRole('menuitem', { name: zh['menu.addToConversation'] })) })
    expect(screen.queryByRole('menuitem')).toBeNull()
    expect(screen.getByRole('alert').textContent).toContain(zh['menu.addFailed'])
    // The banner leaves after its hold and fade, dismissing the notice.
    act(() => { vi.advanceTimersByTime(4_000) })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('FilesBody create menu', () => {
  const SRC = `${ROOT}/src`
  type Tree = Awaited<ReturnType<typeof tree>>

  const menuLabels = (): Array<string | null> => screen.queryAllByRole('menuitem').map(item => item.textContent)

  function body(view: Tree['view']): HTMLElement {
    return view.container.querySelector<HTMLElement>('[data-files-body]')!
  }

  /** Open a row's menu, or the body's when no path is given, and choose one item. */
  function choose(view: Tree['view'], path: string | undefined, label: string): void {
    act(() => { fireEvent.contextMenu(path === undefined ? body(view) : row(view, path), { clientX: 40, clientY: 80 }) })
    act(() => { fireEvent.click(screen.getByRole('menuitem', { name: label })) })
  }

  function nameInput(view: Tree['view']): HTMLInputElement {
    const input = view.container.querySelector<HTMLInputElement>('[data-files-draft] input')
    if (input === null) throw new Error('no name row is open')
    return input
  }

  const noNameRow = (view: Tree['view']): boolean => view.container.querySelector('[data-files-draft]') === null

  /** Type a name into the open row and press Enter. */
  function submit(view: Tree['view'], name: string): void {
    act(() => { fireEvent.change(nameInput(view), { target: { value: name } }) })
    act(() => { fireEvent.keyDown(nameInput(view), { key: 'Enter' }) })
  }

  const draftError = (view: Tree['view']): string | null | undefined =>
    view.container.querySelector('[data-files-draft-error]')?.textContent

  it('offers new file, new folder, then add on a folder row', async () => {
    const { view } = await tree()
    act(() => { fireEvent.contextMenu(row(view, SRC), { clientX: 40, clientY: 80 }) })
    expect(menuLabels()).toEqual([zh['menu.newFile'], zh['menu.newFolder'], zh['menu.addToConversation']])
  })

  it('still offers only add on a file row', async () => {
    const { view } = await tree()
    act(() => { fireEvent.contextMenu(row(view, `${ROOT}/README.md`), { clientX: 40, clientY: 60 }) })
    expect(menuLabels()).toEqual([zh['menu.addToConversation']])
  })

  it('offers the two creations on the body outside every row, and nothing on an "other" row', async () => {
    const { view } = await tree()
    const other = view.container.querySelector(`[data-files-path="${ROOT}/pipe"] > span`)!
    expect(fireEvent.contextMenu(other, { clientX: 40, clientY: 100 })).toBe(true)
    expect(menuLabels()).toEqual([])
    let defaultAllowed = true
    act(() => { defaultAllowed = fireEvent.contextMenu(body(view), { clientX: 40, clientY: 300 }) })
    expect(defaultAllowed).toBe(false)
    expect(menuLabels()).toEqual([zh['menu.newFile'], zh['menu.newFolder']])
  })

  it('shows one menu at a time when the press moves between the body and a row', async () => {
    const { view } = await tree()
    act(() => { fireEvent.contextMenu(body(view), { clientX: 40, clientY: 300 }) })
    act(() => { fireEvent.contextMenu(row(view, `${ROOT}/README.md`), { clientX: 40, clientY: 60 }) })
    expect(menuLabels()).toEqual([zh['menu.addToConversation']])
    act(() => { fireEvent.contextMenu(body(view), { clientX: 40, clientY: 300 }) })
    expect(menuLabels()).toEqual([zh['menu.newFile'], zh['menu.newFolder']])
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(menuLabels()).toEqual([])
  })

  it('expands a collapsed folder, focuses a name row at its top, and creates the typed file once', async () => {
    const { view, creation, controller, tabActions } = await tree()
    expect(row(view, SRC).getAttribute('aria-expanded')).toBe('false')
    choose(view, SRC, zh['menu.newFile'])
    expect(screen.queryByRole('menuitem')).toBeNull()
    expect(row(view, SRC).getAttribute('aria-expanded')).toBe('true')
    const level = view.container.querySelector(`[data-files-path="${SRC}"] > ul`)!
    expect(level.firstElementChild?.getAttribute('data-files-draft')).toBe('file')
    const input = nameInput(view)
    expect(level.contains(input)).toBe(true)
    expect(document.activeElement).toBe(input)
    expect(input.placeholder).toBe(zh['create.placeholder'])
    expect(input.getAttribute('aria-label')).toBe(zh['menu.newFile'])
    submit(view, 'a.md')
    expect(creation.create).toHaveBeenCalledExactlyOnceWith(SESSION, SRC, 'a.md', 'file', controller.signal)
    expect(nameInput(view).disabled).toBe(true)
    await act(() => creation.succeed())
    expect(noNameRow(view)).toBe(true)
    // The new file is listed, not opened: an empty preview has nothing to show.
    expect(tabActions.openResource).not.toHaveBeenCalled()
  })

  it('keeps an expanded folder open and puts the name row above its entries', async () => {
    const { view, script } = await tree()
    act(() => { fireEvent.click(row(view, SRC)) })
    await act(() => script.watches.ready(SRC))
    await act(() => script.settle({ ok: true, value: { entries: [{ name: 'index.ts', type: 'file', size: 1 }], truncated: false } }))
    choose(view, SRC, zh['menu.newFolder'])
    expect(row(view, SRC).getAttribute('aria-expanded')).toBe('true')
    const rows = [...view.container.querySelector(`[data-files-path="${SRC}"] > ul`)!.children]
    expect(rows.map(item => item.getAttribute('data-files-draft') ?? item.getAttribute('data-files-path'))).toEqual(['directory', `${SRC}/index.ts`])
    expect(nameInput(view).getAttribute('aria-label')).toBe(zh['menu.newFolder'])
  })

  it('creates in the tree root from the body menu', async () => {
    const { view, creation, controller } = await tree()
    choose(view, undefined, zh['menu.newFolder'])
    const rootLevel = body(view).querySelector(':scope > ul')!
    expect(rootLevel.firstElementChild?.getAttribute('data-files-draft')).toBe('directory')
    expect(document.activeElement).toBe(nameInput(view))
    submit(view, 'docs')
    expect(creation.create).toHaveBeenCalledExactlyOnceWith(SESSION, ROOT, 'docs', 'directory', controller.signal)
    await act(() => creation.succeed())
    expect(noNameRow(view)).toBe(true)
  })

  it('closes the name row on Escape without creating', async () => {
    const { view, creation } = await tree()
    choose(view, undefined, zh['menu.newFile'])
    act(() => { fireEvent.change(nameInput(view), { target: { value: 'half' } }) })
    act(() => { fireEvent.keyDown(nameInput(view), { key: 'Escape' }) })
    expect(noNameRow(view)).toBe(true)
    expect(creation.create).not.toHaveBeenCalled()
  })

  it('closes the name row when it loses focus without creating', async () => {
    const { view, creation } = await tree()
    choose(view, SRC, zh['menu.newFile'])
    act(() => { fireEvent.change(nameInput(view), { target: { value: 'half' } }) })
    act(() => { fireEvent.blur(nameInput(view)) })
    expect(noNameRow(view)).toBe(true)
    expect(creation.create).not.toHaveBeenCalled()
  })

  it('ignores other keys and an Enter that settles an IME composition', async () => {
    const { view, creation } = await tree()
    choose(view, undefined, zh['menu.newFile'])
    act(() => { fireEvent.change(nameInput(view), { target: { value: '笔记' } }) })
    act(() => { fireEvent.keyDown(nameInput(view), { key: 'Enter', isComposing: true }) })
    act(() => { fireEvent.keyDown(nameInput(view), { key: 'a' }) })
    expect(creation.create).not.toHaveBeenCalled()
    expect(nameInput(view).value).toBe('笔记')
  })

  it('stays open while a submission is in flight, whatever happens to focus', async () => {
    const { view, creation } = await tree()
    choose(view, undefined, zh['menu.newFile'])
    submit(view, 'a.md')
    act(() => { fireEvent.blur(nameInput(view)) })
    expect(nameInput(view).disabled).toBe(true)
    expect(creation.create).toHaveBeenCalledTimes(1)
    await act(() => creation.succeed())
    expect(noNameRow(view)).toBe(true)
  })

  it('says an unusable name is unusable without asking the Host', async () => {
    const { view, creation } = await tree()
    choose(view, undefined, zh['menu.newFile'])
    for (const name of ['x/y', '..', '']) {
      submit(view, name)
      expect(draftError(view)).toBe(zh['create.invalidName'])
      expect(nameInput(view).getAttribute('aria-invalid')).toBe('true')
    }
    expect(creation.create).not.toHaveBeenCalled()
    expect(nameInput(view).disabled).toBe(false)
  })

  it.each([
    ['an existing name', new RemoteError('workspace-file/already-exists', 'taken', { path: `${ROOT}/a.md` }), zh['create.exists']],
    ['a name the Host refuses', new RemoteError('workspace-file/invalid-name', 'bad', { name: 'a:b' }), zh['create.invalidName']],
    ['a parent that is gone', new RemoteError('workspace-file/not-found', 'gone', { path: ROOT }), zh['create.parentGone']],
    ['a parent that became a file', new RemoteError('workspace-file/not-directory', 'file', { path: ROOT, kind: 'file' }), zh['create.parentGone']],
    ['any other failure', new RemoteError('gateway/internal', 'disk on fire', {}), zh['create.failed'].replace('{message}', 'disk on fire')],
  ])('keeps the name row and explains %s, then accepts another name', async (_label, error, line) => {
    const { view, creation, controller } = await tree()
    choose(view, undefined, zh['menu.newFile'])
    submit(view, 'a.md')
    await act(() => creation.fail(error))
    expect(draftError(view)).toBe(line)
    expect(view.container.querySelector('[data-files-draft-error]')?.getAttribute('data-files-draft-error')).toBe(error.code)
    const input = nameInput(view)
    expect(input.disabled).toBe(false)
    expect(input.value).toBe('a.md')
    expect(document.activeElement).toBe(input)
    submit(view, 'b.md')
    expect(draftError(view)).toBeUndefined()
    expect(creation.create).toHaveBeenCalledTimes(2)
    expect(creation.create).toHaveBeenLastCalledWith(SESSION, ROOT, 'b.md', 'file', controller.signal)
    await act(() => creation.succeed())
    expect(noNameRow(view)).toBe(true)
  })

  it('shows the name row above a folder that could not be listed', async () => {
    const { view, script } = await tree()
    act(() => { fireEvent.click(row(view, SRC)) })
    await act(() => script.watches.ready(SRC))
    await act(() => script.settle({ ok: false, error: new RemoteError('workspace-file/not-found', 'gone', { path: SRC }) }))
    choose(view, SRC, zh['menu.newFile'])
    const rows = [...view.container.querySelector(`[data-files-path="${SRC}"] > ul`)!.children]
    expect(rows.map(item => item.getAttribute('data-files-draft') ?? item.getAttribute('data-files-row'))).toEqual(['file', 'failed'])
  })

  it('leaves the platform menu to the name row', async () => {
    const { view } = await tree()
    choose(view, undefined, zh['menu.newFile'])
    expect(fireEvent.contextMenu(nameInput(view), { clientX: 40, clientY: 40 })).toBe(true)
    expect(menuLabels()).toEqual([])
  })

  it('keeps add-to-conversation working from a folder row', async () => {
    const { view, addToConversation, creation } = await tree()
    choose(view, SRC, zh['menu.addToConversation'])
    expect(addToConversation).toHaveBeenCalledWith({ kind: 'reference', path: SRC, target: 'directory', label: 'src/' })
    expect(noNameRow(view)).toBe(true)
    expect(row(view, SRC).getAttribute('aria-expanded')).toBe('false')
    expect(creation.create).not.toHaveBeenCalled()
  })
})
