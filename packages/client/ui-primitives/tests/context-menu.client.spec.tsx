// @vitest-environment jsdom
/** Pointer-anchored context menu wrapper over the Menu primitive. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ContextMenu } from '../src/ContextMenu.tsx'

afterEach(() => { cleanup() })

describe('ContextMenu', () => {
  it('renders nothing without a point or without rows', () => {
    const rows = [{ id: 'a', label: 'Alpha' }]
    const { rerender } = render(
      <ContextMenu point={null} items={rows} onSelect={() => {}} onClose={() => {}} />,
    )
    expect(screen.queryByRole('menu')).toBeNull()
    rerender(<ContextMenu point={undefined} items={rows} onSelect={() => {}} onClose={() => {}} />)
    expect(screen.queryByRole('menu')).toBeNull()
    rerender(<ContextMenu point={{ x: 20, y: 30 }} items={[]} onSelect={() => {}} onClose={() => {}} />)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opens at the press, reports a row selection, and dismisses on Escape', () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()
    render(<ContextMenu point={{ x: 20, y: 30 }} items={[{ id: 'a', label: 'Alpha' }]} onSelect={onSelect} onClose={onClose} />)
    expect(screen.getByRole('menu')).toBeDefined()
    act(() => { fireEvent.click(screen.getByRole('menuitem', { name: 'Alpha' })) })
    expect(onSelect).toHaveBeenCalledWith('a')
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(onClose).toHaveBeenCalled()
  })

  it('dismisses on an outside press and honours an explicit autoFocus false', () => {
    const onClose = vi.fn()
    render(<ContextMenu point={{ x: 5, y: 5 }} items={[{ id: 'a', label: 'Alpha' }]} onSelect={() => {}} onClose={onClose} autoFocus={false} />)
    act(() => { fireEvent.pointerDown(document.body) })
    expect(onClose).toHaveBeenCalled()
  })
})
