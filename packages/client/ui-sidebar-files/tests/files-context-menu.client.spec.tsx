// @vitest-environment jsdom
/** File-tree row context menu: add a file or folder to the current conversation. */
import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import type { DirLevel } from '../src/client/store.ts'
import { zh } from '../src/client/locales.ts'
import { mountBody, ROOT } from './mount.client.tsx'

const LEVEL: DirLevel = {
  entries: [
    { name: 'README.md', type: 'file', size: 12 },
    { name: 'src', type: 'directory' },
    { name: 'pipe', type: 'other' },
  ],
  truncated: false,
}

afterEach(() => { cleanup() })

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
})
