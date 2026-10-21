/**
 * A menu opened at the pointer by a secondary press.
 *
 * The anchored {@link Menu} primitive already owns the list's keyboard walk,
 * Escape/outside dismissal, and post-selection focus return; a context menu
 * differs only in where it lands. This wrapper feeds the press's viewport rect
 * through `getAnchorRect` — the primitive's host-owned-anchor path — and a
 * hidden zero-size placeholder, so a caller keeps one `Menu` instance and owns
 * what each row does.
 *
 * The caller supplies its own rows (typically one or two) and closes the menu
 * after handling a selection; the pointer press itself is expected to have been
 * `preventDefault`ed so the platform menu does not also appear.
 */
import type { ReactNode } from 'react'
import { Menu } from './Menu.tsx'
import type { MenuItem } from './Menu.tsx'

/** Where a secondary press landed, in viewport coordinates. */
export interface ContextMenuPoint {
  readonly x: number
  readonly y: number
}

/** Props of the pointer-anchored menu. */
export interface ContextMenuProps {
  /** The press location, or null/absent while no menu is open. */
  readonly point: ContextMenuPoint | null | undefined
  /** The rows to offer; an empty list renders nothing. */
  readonly items: readonly MenuItem[]
  /** Row activation callback, by row id. */
  readonly onSelect: (id: string) => void
  /** Invoked on outside press, Escape, or a row that dismisses the menu. */
  readonly onClose: () => void
  /** Whether to focus the first row on open (default true, for keyboard reach). */
  readonly autoFocus?: boolean | undefined
}

/**
 * Render the menu at the last secondary press, or nothing.
 * @param props.point - the press location.
 * @param props.items - the rows.
 * @param props.onSelect - row activation.
 * @param props.onClose - dismissal.
 * @param props.autoFocus - focus the first row on open.
 * @returns the open menu, or null.
 */
export function ContextMenu({ point, items, onSelect, onClose, autoFocus = true }: ContextMenuProps): ReactNode {
  if (point === null || point === undefined || items.length === 0) return null
  return (
    <Menu
      open
      portal
      dense
      autoFocus={autoFocus}
      anchor={<span hidden data-context-menu-anchor />}
      getAnchorRect={() => new DOMRect(point.x, point.y, 0, 0)}
      items={items}
      onSelect={onSelect}
      onClose={onClose}
    />
  )
}
