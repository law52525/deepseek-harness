// @vitest-environment jsdom
/** File-tree row context menu: add a file or folder to the current conversation. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import type { DirLevel } from '../src/client/store.ts'
import { zh } from '../src/client/locales.ts'
import { mountBody, ROOT } from './mount.client.tsx'

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
