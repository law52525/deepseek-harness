/**
 * What `ctx.sidebarRight` promises other plugins.
 *
 * The service is root-scoped and the surface is per session, so every command
 * depends on a binding the mounted seat publishes; the interesting cases are all
 * about that seam. Opening is asserted against a real store instance, because
 * "already open" and "in that tab's place" mean whatever the planner means by
 * them and nothing else, and against the Tab domain, because an open is not
 * complete until the tab knows how it was navigated to.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { LayoutState, PaneId, TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { activeDockPaneId, dockPaneIds, findTabPane, getPane } from '@deepseek-ai/dsh-client-ui-dockkit'
import { createSidebarRightController } from '../src/client/service.ts'
import { SidebarRightTabRegistry } from '../src/client/tab-registry.ts'
import { createSidebarRightStore } from '../src/client/stores.ts'
import { guideDefinition } from '../src/client/tabs/guide/definition.ts'

// The params map is empty in this package; a test-only scheme lets specs hand
// parameters through the typed `open`/`navigate` faces.
declare module '../src/client/contract/params.ts' {
  interface SidebarRightResourceParamsMap {
    test: { line?: number; x?: number }
  }
}

const SESSION = 's-test' as SessionId

/** Key-echoing translate: this file asserts behaviour, not copy. */
const t = ((key: string) => key) as Parameters<typeof guideDefinition>[0]

/** A controller over a real registry and a real store, bound as a mounted seat would be. */
function harness() {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  tabs.register(guideDefinition(t))
  // A type claiming `file:` addresses, standing in for whatever package owns
  // them: this service's contract is that SOME registered type claims, not that
  // a particular one does.
  tabs.register({
    id: 'test/text',
    kind: 'text',
    patterns: ['dsh-resource://file/**'],
    priority: 'fallback',
    title: address => address.slice(address.lastIndexOf('/') + 1),
  })
  const pin = vi.fn<(address: string, signal: AbortSignal) => void>()
  const { controller, adopt } = createSidebarRightController(tabs, pin)
  const instance = createSidebarRightStore(() => ({ kind: 'guide', title: 'seed' })).create()
  const layout = (): LayoutState => {
    const surface = instance.getSnapshot().bySession[SESSION]
    if (surface === undefined) throw new Error('expected a surface')
    return surface.layout
  }
  /** Republish the way the seat does after each commit, and sync the domain the way it does too. */
  /** The room rule's verdict the seat would report; a spec flips it to model a narrow pane. */
  const room = { allowed: true }
  const publish = (): (() => void) => {
    const surface = instance.getSnapshot().bySession[SESSION]
    if (surface !== undefined) controller.tabDomain.sync(SESSION, surface.layout)
    return controller.bind({
      sessionId: SESSION, actions: instance.actions, surfaces: instance.getSnapshot().bySession,
      closeWithFocus: (_paneId, close) => { close() },
      openWithFocus: (open) => { open() },
      canSplitPane: () => room.allowed,
    })
  }
  const titles = (): string[] => {
    const surface = instance.getSnapshot().bySession[SESSION]
    return surface === undefined ? [] : Object.values(surface.layout.tabs).map(tab => tab.title)
  }
  const tabOf = (title: string): TabId => {
    const found = Object.values(layout().tabs).find(tab => tab.title === title)
    if (found === undefined) throw new Error(`expected a tab titled ${title}`)
    return found.id
  }
  const entries = (): number => instance.getSnapshot().bySession[SESSION]?.history.entries.length ?? 0
  // A surface starts empty; expanding seeds the default guide ('seed').
  const expand = (): void => { instance.actions.setExpanded(SESSION, true) }
  return { controller, adopt, tabs, instance, pin, publish, titles, tabOf, layout, entries, room, expand }
}

describe('SidebarRightController — opening', () => {
  it('keeps independently opened instances distinct when they return to the same pane', () => {
    const h = harness()
    h.tabs.register({ id: 'test/terminal', kind: 'terminal', multiple: true, title: () => 'terminal' })
    const release = h.publish()
    try {
      h.controller.openTab('terminal')
      h.controller.openTab('terminal')
      const terminals = Object.values(h.layout().tabs).filter(tab => tab.kind === 'terminal')
      expect(terminals).toHaveLength(2)
      expect(terminals[0]!.contentId).not.toBe(terminals[1]!.contentId)
      const pane = findTabPane(h.layout(), terminals[0]!.id).id
      h.instance.actions.floatTab(SESSION, terminals[0]!.id)
      const floating = findTabPane(h.layout(), terminals[0]!.id).id
      h.instance.actions.unfloatPane(SESSION, floating)
      expect(getPane(h.layout(), pane).tabs).toContain(terminals[0]!.id)
      expect(getPane(h.layout(), pane).tabs).toContain(terminals[1]!.id)
    } finally { release() }
  })

  it('refuses every write while no seat is mounted', () => {
    const { controller } = harness()
    expect(() => { controller.openResource('dsh-resource://file/session/s-test/a.txt') }).toThrow('no session surface is mounted')
    expect(() => { controller.openTab('guide') }).toThrow('no session surface is mounted')
    expect(() => { controller.close('tab1' as TabId) }).toThrow('no session surface is mounted')
    expect(() => { controller.toggleExpanded() }).toThrow('no session surface is mounted')
    expect(() => { controller.focus('tab1' as TabId) }).toThrow('no session surface is mounted')
    expect(() => { controller.split() }).toThrow('no session surface is mounted')
    expect(() => { controller.float('tab1' as TabId) }).toThrow('no session surface is mounted')
    expect(() => { controller.dock('pane1' as PaneId) }).toThrow('no session surface is mounted')
  })

  it('publishes the mounted session only on real transitions of the seat binding', () => {
    const h = harness()
    const seen: (string | undefined)[] = []
    const unsubscribe = h.controller.mounted.subscribe(() => { seen.push(h.controller.mounted.getSnapshot()) })
    try {
      expect(h.controller.mounted.getSnapshot()).toBeUndefined()
      const first = h.publish()
      expect(h.controller.mounted.getSnapshot()).toBe(SESSION)
      // The seat republishes on every store commit; the same session is silent.
      const second = h.publish()
      expect(seen).toEqual([SESSION])
      // A stale release — the first seat's, after a newer one took over — changes nothing.
      first()
      expect(h.controller.mounted.getSnapshot()).toBe(SESSION)
      second()
      expect(h.controller.mounted.getSnapshot()).toBeUndefined()
      expect(seen).toEqual([SESSION, undefined])
    } finally { unsubscribe() }
  })

  it('refuses an address no registered type claims, before touching the surface', () => {
    const { controller, publish, titles } = harness()
    publish()
    expect(() => { controller.openResource('https://example.com') }).toThrow('no registered tab type claims')
    expect(titles()).toEqual([])
  })

  it('opens claimed content and reveals the column in one history entry', () => {
    const { controller, publish, layout, titles, entries } = harness()
    publish()
    controller.openResource('dsh-resource://file/session/s-test/notes/readme.txt')
    expect(layout().expanded).toBe(true)
    expect(titles()).toContain('readme.txt')
    // One intent, one entry: stepping back removes the tab and re-collapses.
    expect(entries()).toBe(1)
    publish()
    controller._undo()
    expect(layout().expanded).toBe(false)
    expect(titles()).not.toContain('readme.txt')
  })

  it('focuses the tab already showing the same (kind, contentId) instead of opening a second one', () => {
    const { controller, publish, titles, layout, tabOf } = harness()
    publish()
    controller.openResource('dsh-resource://file/session/s-test/notes/readme.txt')
    publish()
    controller.openTab('guide')
    publish()
    controller.openResource('dsh-resource://file/session/s-test/notes/readme.txt')
    expect(titles().filter(title => title === 'readme.txt')).toHaveLength(1)
    expect(getPane(layout(), layout().activePaneId).activeTabId).toBe(tabOf('readme.txt'))
  })

  it('opens another tab for the same address when told not to reveal, and when another kind is named', () => {
    const { controller, tabs, publish, titles } = harness()
    tabs.register({ id: 'test/hex', kind: 'hex', patterns: [], title: () => 'hex view' })
    publish()
    controller.openResource('dsh-resource://file/session/s-test/notes/readme.txt')
    publish()
    controller.openResource('dsh-resource://file/session/s-test/notes/readme.txt', { revealIfOpened: false })
    publish()
    controller.openResource('dsh-resource://file/session/s-test/notes/readme.txt', { kind: 'hex' })
    expect(titles().filter(title => title === 'readme.txt')).toHaveLength(2)
    expect(titles()).toContain('hex view')
  })

  it('lands a new tab in the pane the caller names', () => {
    const { controller, instance, publish, layout, tabOf, expand } = harness()
    expand()
    publish()
    instance.actions.splitPane(SESSION)
    publish()
    const [left, right] = Object.values(layout().nodes).filter(node => node.kind === 'pane').map(node => node.id)
    if (left === undefined || right === undefined) throw new Error('expected two panes')
    controller.openResource('dsh-resource://file/session/s-test/a.txt', { paneId: left })
    expect(findTabPane(layout(), tabOf('a.txt')).id).toBe(left)
  })

  it('opens new content alone in a preferred pane and falls back to the current pane at the limit', () => {
    const { controller, publish, layout, tabOf, entries, expand } = harness()
    expand()
    publish()
    const before = entries()
    controller.openResource('dsh-resource://file/session/s-test/a.txt', { preferNewPane: true })
    const a = tabOf('a.txt')
    const pane = findTabPane(layout(), a)
    expect(dockPaneIds(layout())).toHaveLength(2)
    expect(pane.tabs).toEqual([a])
    expect(entries()).toBe(before + 1)

    publish()
    controller.openResource('dsh-resource://file/session/s-test/b.txt', { preferNewPane: true })
    expect(dockPaneIds(layout())).toHaveLength(2)
    expect(findTabPane(layout(), tabOf('b.txt')).id).toBe(pane.id)
  })

  it('falls back when the pane is too narrow and reveals existing content without splitting', () => {
    const { controller, publish, layout, tabOf, room, expand } = harness()
    expand()
    publish()
    room.allowed = false
    controller.openResource('dsh-resource://file/session/s-test/a.txt', { preferNewPane: true })
    expect(dockPaneIds(layout())).toHaveLength(1)
    publish()

    room.allowed = true
    controller.openResource('dsh-resource://file/session/s-test/a.txt', { preferNewPane: true })
    expect(dockPaneIds(layout())).toHaveLength(1)
    expect(getPane(layout(), layout().activePaneId).activeTabId).toBe(tabOf('a.txt'))
  })

  it('takes the replaced tab\'s pane and slot, closes it, and records one entry', () => {
    const { controller, publish, layout, tabOf, entries } = harness()
    publish()
    controller.openResource('dsh-resource://file/session/s-test/a.txt')
    publish()
    controller.openResource('dsh-resource://file/session/s-test/b.txt')
    publish()
    const a = tabOf('a.txt')
    const before = entries()
    controller.openResource('dsh-resource://file/session/s-test/c.txt', { replaceTab: a })
    const pane = findTabPane(layout(), tabOf('c.txt'))
    // a took slot 0 of the lazily-seeded (still empty) surface; c took a's slot.
    expect(pane.tabs.indexOf(tabOf('c.txt'))).toBe(0)
    expect(layout().tabs[a]).toBeUndefined()
    expect(entries()).toBe(before + 1)
    publish()
    controller._undo()
    expect(layout().tabs[a]).toBeDefined()
    expect(Object.values(layout().tabs).map(tab => tab.title)).not.toContain('c.txt')
  })

  it('still closes the replaced tab when the address is already open elsewhere', () => {
    const { controller, publish, layout, tabOf, titles } = harness()
    publish()
    controller.openResource('dsh-resource://file/session/s-test/a.txt')
    publish()
    controller.openResource('dsh-resource://file/session/s-test/b.txt')
    publish()
    const spare = tabOf('b.txt')
    controller.openResource('dsh-resource://file/session/s-test/a.txt', { replaceTab: spare })
    expect(layout().tabs[spare]).toBeUndefined()
    expect(titles().filter(title => title === 'a.txt')).toHaveLength(1)
    expect(getPane(layout(), layout().activePaneId).activeTabId).toBe(tabOf('a.txt'))
  })

  it('refuses to copy the guide, and records nothing for the attempt', () => {
    const { controller, instance, publish, layout, tabOf, entries, expand } = harness()
    instance.actions.open(SESSION)
    expand()
    publish()
    controller.openResource('dsh-resource://file/session/s-test/a.txt')
    publish()
    const before = entries()
    instance.actions.duplicateTab(SESSION, tabOf('seed'))
    expect(Object.values(layout().tabs).filter(tab => tab.contentId === 'sidebar://guide')).toHaveLength(1)
    expect(entries()).toBe(before)
    // Any other tab still copies beside itself.
    instance.actions.duplicateTab(SESSION, tabOf('a.txt'))
    expect(Object.values(layout().tabs).filter(tab => tab.title === 'a.txt')).toHaveLength(2)
  })

  it('focuses the existing guide in the target pane', () => {
    const { controller, instance, publish, layout, tabOf, expand } = harness()
    instance.actions.open(SESSION)
    expand()
    publish()
    controller.openResource('dsh-resource://file/session/s-test/a.txt')
    publish()
    controller.openTab('guide')
    expect(Object.values(layout().tabs).filter(tab => tab.contentId === 'sidebar://guide')).toHaveLength(1)
    expect(getPane(layout(), layout().activePaneId).activeTabId).toBe(tabOf('seed'))
  })

  it('keeps the guide to one per pane: opening it into a pane that holds one settles on that one', () => {
    const { controller, instance, publish, layout, tabOf, expand } = harness()
    instance.actions.open(SESSION)
    expand()
    publish()
    controller.openResource('dsh-resource://file/session/s-test/a.txt')
    publish()
    const root = getPane(layout(), layout().rootId).id
    let settled: TabId | undefined
    instance.actions.openContent(SESSION, {
      kind: 'guide', contentId: 'sidebar://guide', title: 'seed', paneId: root, revealIfOpened: false,
    }, (tabId) => { settled = tabId })
    expect(settled).toBe(tabOf('seed'))
    expect(Object.values(layout().tabs).filter(tab => tab.contentId === 'sidebar://guide')).toHaveLength(1)
    // A pane without one gets its own.
    instance.actions.closeTab(SESSION, tabOf('seed'))
    instance.actions.openContent(SESSION, {
      kind: 'guide', contentId: 'sidebar://guide', title: 'seed', paneId: root, revealIfOpened: false,
    }, () => {})
    expect(Object.values(layout().tabs).filter(tab => tab.contentId === 'sidebar://guide')).toHaveLength(1)
  })

  it('merges a guide placed, dropped, or docked into a pane that already holds one', () => {
    const { instance, publish, layout, expand } = harness()
    instance.actions.open(SESSION)
    expand()
    publish()
    const guides = (): TabId[] => Object.values(layout().tabs).filter(tab => tab.contentId === 'sidebar://guide').map(tab => tab.id)
    // Place: the split's guide dragged into the first pane's strip.
    instance.actions.splitPane(SESSION)
    let [left, right] = dockPaneIds(layout())
    if (left === undefined || right === undefined) throw new Error('expected two panes')
    const [own] = getPane(layout(), left).tabs
    const arrivingByPlace = getPane(layout(), right).tabs[0]
    if (own === undefined || arrivingByPlace === undefined) throw new Error('expected seeded guides')
    instance.actions.placeTab(SESSION, arrivingByPlace, left, 0)
    expect(guides()).toEqual([own])
    expect(dockPaneIds(layout())).toHaveLength(1)
    expect(getPane(layout(), left).activeTabId).toBe(own)
    // Drop on the centre: the same merge. An edge drop makes a new pane and keeps both.
    instance.actions.splitPane(SESSION)
    ;[left, right] = dockPaneIds(layout())
    if (left === undefined || right === undefined) throw new Error('expected two panes')
    const arrivingByDrop = getPane(layout(), right).tabs[0]
    if (arrivingByDrop === undefined) throw new Error('expected the seeded guide')
    instance.actions.dropTab(SESSION, arrivingByDrop, left, 'right')
    expect(guides()).toHaveLength(2)
    instance.actions.dropTab(SESSION, arrivingByDrop, left, 'center')
    expect(guides()).toEqual([own])
    // Dock: a floating guide returning to a pane that reseeded its own.
    instance.actions.floatTab(SESSION, own)
    expect(layout().floats).toHaveLength(1)
    const reseeded = guides().find(id => id !== own)
    if (reseeded === undefined) throw new Error('expected the root to reseed a guide')
    const [float] = layout().floats
    if (float === undefined) throw new Error('expected the float')
    instance.actions.unfloatPane(SESSION, float)
    expect(layout().floats).toHaveLength(0)
    expect(guides()).toEqual([reseeded])
  })

  it('records the navigation in the Tab domain: params delivered, revision counting every open', () => {
    const { controller, publish, tabOf } = harness()
    publish()
    controller.openResource('dsh-resource://file/session/s-test/a.txt', { params: { line: 3 } })
    const occurrence = controller.tabDomain.occurrence(SESSION, { id: tabOf('a.txt') })
    expect(occurrence.navigation.getSnapshot()).toEqual({ address: 'dsh-resource://file/session/s-test/a.txt', params: { line: 3 }, revision: 1 })
    publish()
    controller.openResource('dsh-resource://file/session/s-test/a.txt')
    expect(occurrence.navigation.getSnapshot()).toEqual({ address: 'dsh-resource://file/session/s-test/a.txt', params: undefined, revision: 2 })
  })

  it('closes a tab of the mounted session', () => {
    const { controller, publish, tabOf, titles } = harness()
    publish()
    controller.openResource('dsh-resource://file/session/s-test/a.txt')
    publish()
    controller.close(tabOf('a.txt'))
    expect(titles()).not.toContain('a.txt')
  })

  it('records the presentation switch, so it steps back with everything else', () => {
    const { controller, instance, publish, layout } = harness()
    publish()
    instance.actions.setMode(SESSION, 'fullscreen')
    expect(layout().mode).toBe('fullscreen')
    publish()
    controller._undo()
    expect(layout().mode).toBe('push')
    controller._redo()
    expect(layout().mode).toBe('fullscreen')
  })
})

describe('SidebarRightController — the two opens', () => {
  it('refuses an address outside dsh-resource:// on the same path as an unclaimed one', () => {
    const { controller, instance, publish, entries } = harness()
    instance.actions.open(SESSION)
    publish()
    const before = entries()
    expect(() => { controller.openResource('sidebar://guide') }).toThrow('no registered tab type claims')
    expect(() => { controller.openResource('https://example.com/a.txt') }).toThrow('no registered tab type claims')
    expect(() => { controller.openResource('dsh-resource://unknown/x') }).toThrow('no registered tab type claims')
    expect(entries()).toBe(before)
  })

  it('opens a page by kind at the address the package records it under, and refuses an unregistered kind', () => {
    const { controller, instance, publish, layout, entries } = harness()
    instance.actions.open(SESSION)
    publish()
    controller.openResource('dsh-resource://file/session/s-test/a.txt')
    publish()
    // No pane holds the page yet: opening it by kind opens its tab.
    controller.openTab('guide')
    publish()
    expect(Object.values(layout().tabs).filter(tab => tab.contentId === 'sidebar://guide')).toHaveLength(1)
    expect(controller.active()?.kind).toBe('guide')
    const before = entries()
    expect(() => { controller.openTab('nope') }).toThrow('no tab type is registered as "nope"')
    expect(entries()).toBe(before)
  })

  it('replaceTab opens in the named tab\'s place and closes it, as one entry', () => {
    const { controller, instance, publish, layout, tabOf, entries, expand } = harness()
    instance.actions.open(SESSION)
    expand()
    publish()
    controller.openResource('dsh-resource://file/session/s-test/a.txt')
    publish()
    const before = entries()
    controller.openTab('guide', { replaceTab: tabOf('a.txt') })
    expect(Object.values(layout().tabs).map(tab => tab.title)).toEqual(['seed'])
    expect(entries()).toBe(before + 1)
  })
})

describe('SidebarRightController — layout operations', () => {
  it('focuses an existing tab and its pane, and leaves a missing tab alone', () => {
    const { controller, publish, layout, tabOf, entries, expand } = harness()
    expand()
    publish()
    controller.openResource('dsh-resource://file/session/s-test/a.txt')
    publish()
    expect(getPane(layout(), layout().activePaneId).activeTabId).toBe(tabOf('a.txt'))
    const before = entries()
    controller.focus(tabOf('seed'))
    expect(getPane(layout(), layout().activePaneId).activeTabId).toBe(tabOf('seed'))
    expect(entries()).toBe(before + 1)
    controller.focus('tab-nowhere' as TabId)
    expect(entries()).toBe(before + 1)
  })

  it('splits nothing before the seat has materialized the surface', () => {
    const { controller, publish } = harness()
    publish()
    expect(controller.split()).toBeUndefined()
  })

  it('splits the active docked pane and names the new one, or nothing when the budget or the room rule says no', () => {
    const { controller, instance, publish, layout, entries, room, expand } = harness()
    instance.actions.open(SESSION)
    expand()
    publish()
    const created = controller.split()
    expect(created).toBeDefined()
    expect(dockPaneIds(layout())).toHaveLength(2)
    expect(dockPaneIds(layout())).toContain(created)
    publish()
    // The room rule blocks: nothing is split and nothing is recorded.
    room.allowed = false
    const before = entries()
    expect(controller.split()).toBeUndefined()
    expect(entries()).toBe(before)
    room.allowed = true
    // A floating pane cannot be split.
    const seed = Object.values(layout().tabs).find(tab => tab.title === 'seed')
    if (seed === undefined) throw new Error('expected the seeded guide')
    controller.float(seed.id)
    publish()
    const [float] = layout().floats
    expect(controller.split(float)).toBeUndefined()
    // The budget: split to two panes, then no more.
    while (dockPaneIds(layout()).length < 2) {
      expect(controller.split(dockPaneIds(layout()).at(-1))).toBeDefined()
      publish()
    }
    expect(controller.split()).toBeUndefined()
  })

  it('floats a docked tab, and leaves a floating or missing tab alone', () => {
    const { controller, publish, layout, tabOf, entries } = harness()
    publish()
    controller.openResource('dsh-resource://file/session/s-test/a.txt')
    publish()
    controller.float(tabOf('a.txt'), { x: 10, y: 20, width: 300, height: 200 })
    expect(layout().floats).toHaveLength(1)
    expect(findTabPane(layout(), tabOf('a.txt')).rect).toEqual({ x: 10, y: 20, width: 300, height: 200 })
    publish()
    const before = entries()
    controller.float(tabOf('a.txt'))
    controller.float('tab-nowhere' as TabId)
    expect(entries()).toBe(before)
    expect(layout().floats).toHaveLength(1)
  })

  it('docks a floating panel back into the active docked pane, and leaves a docked or missing pane alone', () => {
    const { controller, publish, layout, tabOf, entries } = harness()
    publish()
    controller.openResource('dsh-resource://file/session/s-test/a.txt')
    publish()
    controller.float(tabOf('a.txt'))
    publish()
    const [float] = layout().floats
    if (float === undefined) throw new Error('expected a float')
    controller.dock(float)
    expect(layout().floats).toHaveLength(0)
    expect(findTabPane(layout(), tabOf('a.txt')).host).toBe('dock')
    publish()
    const before = entries()
    controller.dock(getPane(layout(), layout().rootId).id)
    controller.dock('pane-nowhere' as PaneId)
    expect(entries()).toBe(before)
  })
})

describe('SidebarRightController — a tab\'s own actions', () => {
  const OTHER = 's-other' as SessionId
  const A_TXT = 'dsh-resource://file/session/s-test/a.txt'
  const B_TXT = 'dsh-resource://file/session/s-test/b.txt'

  it('opens into an adopted store before that store has created its session surface', () => {
    const { controller, adopt, instance, titles } = harness()
    const releaseOwn = adopt(SESSION, instance)
    const other = createSidebarRightStore(() => ({ kind: 'guide', title: 'seed' })).create(OTHER)
    const releaseBinding = controller.bind({
      sessionId: OTHER,
      actions: other.actions,
      surfaces: other.getSnapshot().bySession,
      closeWithFocus: (_paneId, close) => { close() },
      openWithFocus: (open) => { open() }, canSplitPane: () => true,
    })
    controller.openResourceIn(SESSION, A_TXT)
    expect(titles()).toContain('a.txt')
    releaseBinding()
    releaseOwn()
  })

  it('land in the session the tab is in through its own adopted store, after another session\'s seat took over', () => {
    const { controller, adopt, instance, publish, layout, expand } = harness()
    const releaseOwn = adopt(SESSION, instance)
    expand()
    publish()
    controller.openResource(A_TXT)
    const own = Object.values(layout().tabs).find(tab => tab.title === 'a.txt')
    const guide = Object.values(layout().tabs).find(tab => tab.kind === 'guide')
    if (own === undefined || guide === undefined) throw new Error('expected the opened tab and the seeded guide')
    const fromOwn = controller.tabDomain.occurrence(SESSION, own).tabActions
    const guideOccurrence = controller.tabDomain.occurrence(SESSION, guide)
    // The user switches sessions: the other seat binds with the other session's
    // own instance, whose store knows nothing of this session.
    const other = createSidebarRightStore(() => ({ kind: 'guide', title: 'seed' })).create(OTHER)
    const releaseOther = adopt(OTHER, other)
    other.actions.open(OTHER)
    other.actions.setExpanded(OTHER, true)
    const otherSurface = other.getSnapshot().bySession[OTHER]
    if (otherSurface === undefined) throw new Error('expected the other surface')
    controller.bind({
      sessionId: OTHER, actions: other.actions, surfaces: other.getSnapshot().bySession,
      closeWithFocus: (_paneId, close) => { close() },
      openWithFocus: (open) => { open() },
      canSplitPane: () => true,
    })
    fromOwn.openResource(B_TXT)
    fromOwn.openTab('guide', { revealIfOpened: false })
    expect(Object.values(layout().tabs).map(tab => tab.title)).toContain('b.txt')
    expect(other.getSnapshot().bySession[OTHER]).toBe(otherSurface)
    // Tab ids repeat across sessions: the seeded guides share one. Closing this
    // session's closes this session's, aborts its occurrence at once although
    // no seat draws the session, and the other keeps its own.
    expect(otherSurface.layout.tabs[guide.id]).toBeDefined()
    guideOccurrence.tabActions.close()
    expect(layout().tabs[guide.id]).toBeUndefined()
    expect(guideOccurrence.signal.aborted).toBe(true)
    expect(other.getSnapshot().bySession[OTHER]).toBe(otherSurface)
    expect(controller.active()?.kind).toBe('guide')
    releaseOther()
    releaseOwn()
  })

  it('do nothing for a session whose store is not adopted, and again once its adoption is released', () => {
    const { controller, adopt, instance, publish, layout, titles } = harness()
    publish()
    controller.openResource(A_TXT)
    publish()
    const own = Object.values(layout().tabs).find(tab => tab.title === 'a.txt')
    if (own === undefined) throw new Error('expected the opened tab')
    const { tabActions } = controller.tabDomain.occurrence(SESSION, own)
    const before = instance.getSnapshot().bySession
    tabActions.openResource(B_TXT)
    tabActions.openTab('guide')
    tabActions.close()
    expect(instance.getSnapshot().bySession).toBe(before)
    // Adopted, they land; released, they stop again.
    const release = adopt(SESSION, instance)
    tabActions.openResource(B_TXT)
    expect(titles()).toContain('b.txt')
    release()
    tabActions.close()
    expect(titles()).toContain('a.txt')
  })

  it('adoption syncs the Tab domain on each commit of that store: the seeded guide is pinned, a closed tab aborted', () => {
    const { controller, adopt, instance, pin } = harness()
    const first = adopt(SESSION, instance)
    // An empty adopted surface has no resources to pin; another Session's
    // commits do not populate it.
    instance.actions.open(OTHER)
    expect(pin).not.toHaveBeenCalled()
    instance.actions.setExpanded(SESSION, true)
    expect(pin).toHaveBeenCalledWith('sidebar://guide', expect.any(AbortSignal))
    instance.actions.openContent(SESSION, { kind: 'text', contentId: A_TXT, title: 'a' }, () => {})
    const surface = instance.getSnapshot().bySession[SESSION]
    const tab = Object.values(surface?.layout.tabs ?? {}).find(record => record.contentId === A_TXT)
    if (tab === undefined) throw new Error('expected the opened tab')
    const occurrence = controller.tabDomain.occurrence(SESSION, tab)
    expect(pin).toHaveBeenCalledWith(A_TXT, occurrence.signal)
    instance.actions.closeTab(SESSION, tab.id)
    expect(occurrence.signal.aborted).toBe(true)
    // A release ends the syncing; a stale release leaves a newer adoption standing.
    first()
    const second = adopt(SESSION, instance)
    first()
    instance.actions.openContent(SESSION, { kind: 'text', contentId: B_TXT, title: 'b' }, () => {})
    const again = Object.values(instance.getSnapshot().bySession[SESSION]?.layout.tabs ?? {}).find(record => record.contentId === B_TXT)
    if (again === undefined) throw new Error('expected the second tab')
    const held = controller.tabDomain.occurrence(SESSION, again)
    expect(pin).toHaveBeenCalledWith(B_TXT, held.signal)
    // Adopting another instance for the session ends the earlier adoption's
    // subscription with its routing: the old store's commits sync nothing, the
    // new store's commits reconcile the session against its own layout.
    const replacement = createSidebarRightStore(() => ({ kind: 'guide', title: 'seed' })).create()
    const third = adopt(SESSION, replacement)
    const pins = pin.mock.calls.length
    instance.actions.openContent(SESSION, { kind: 'text', contentId: 'dsh-resource://file/session/s-test/c.txt', title: 'c' }, () => {})
    expect(pin.mock.calls.length).toBe(pins)
    expect(held.signal.aborted).toBe(false)
    replacement.actions.open(SESSION)
    expect(held.signal.aborted).toBe(true)
    second()
    third()
  })
})

describe('SidebarRightController — the readable slice', () => {
  it('answers for the no-session case rather than throwing', () => {
    const { controller } = harness()
    expect(controller.isExpanded()).toBe(false)
    expect(controller.active()).toBeUndefined()
  })

  it('reports the last committed surface', () => {
    const { controller, publish, layout } = harness()
    publish()
    controller.toggleExpanded()
    publish()
    expect(controller.isExpanded()).toBe(true)
    controller.openResource('dsh-resource://file/session/s-test/a.txt')
    publish()
    expect(Object.values(layout().tabs).filter(tab => tab.contentId === 'dsh-resource://file/session/s-test/a.txt')).toHaveLength(1)
    expect(controller.active()?.contentId).toBe('dsh-resource://file/session/s-test/a.txt')
  })
})

describe('SidebarRightController — binding lifetime', () => {
  it('acts on the newest binding when a seat republishes', () => {
    const { controller, publish, layout } = harness()
    publish()
    controller.toggleExpanded()
    publish()
    expect(controller.isExpanded()).toBe(true)
    expect(layout().expanded).toBe(true)
  })

  it('goes back to refusing writes once the seat releases', () => {
    const { controller, publish } = harness()
    const release = publish()
    release()
    expect(() => { controller.toggleExpanded() }).toThrow('no session surface is mounted')
    expect(controller.isExpanded()).toBe(false)
  })

  it('a stale release does not clear a newer binding', () => {
    const { controller, publish } = harness()
    const stale = publish()
    publish()
    stale()
    expect(() => { controller.toggleExpanded() }).not.toThrow()
  })
})

describe('explicit tab resource cleanup', () => {
  it.each(['close', 'replace'] as const)('immediately removes the tab after a synchronous cleanup handler during %s', (operation) => {
    const h = harness()
    const release = h.adopt(SESSION, h.instance)
    const unbind = h.publish()
    h.controller.openResource('dsh-resource://file/session/s-test/terminal')
    const tabId = h.tabOf('terminal')
    const original = h.layout().tabs[tabId]
    const handler = vi.fn(() => { expect(h.layout().tabs[tabId]).toBe(original) })
    const unregister = h.controller.registerCloseHandler('text', handler)
    try {
      const before = h.entries()
      if (operation === 'close') h.controller.close(tabId)
      else h.controller.openTab('guide', { replaceTab: tabId, revealIfOpened: false })
      expect(handler).toHaveBeenCalledExactlyOnceWith(SESSION, original)
      expect(h.layout().tabs[tabId]).toBeUndefined()
      expect(h.entries()).toBe(before + 1)
      h.controller.closeIn(SESSION, tabId)
      expect(handler).toHaveBeenCalledOnce()
    } finally {
      unregister()
      unbind()
      release()
    }
  })

  it('does not invoke cleanup on collapse or when revealing the same tab', () => {
    const h = harness()
    h.adopt(SESSION, h.instance)
    h.publish()
    const address = 'dsh-resource://file/session/s-test/terminal'
    h.controller.openResource(address)
    h.publish()
    const tabId = h.tabOf('terminal')
    const handler = vi.fn()
    h.controller.registerCloseHandler('text', handler)
    h.controller.toggleExpanded()
    h.controller.openResource(address, { replaceTab: tabId })
    expect(handler).not.toHaveBeenCalled()
    expect(h.layout().tabs[tabId]).toBeDefined()
  })

  it.each(['close', 'replace'] as const)('preserves a tab when its synchronous %s handler throws', (operation) => {
    const h = harness()
    h.adopt(SESSION, h.instance)
    h.publish()
    h.controller.openResource('dsh-resource://file/session/s-test/terminal')
    const tabId = h.tabOf('terminal')
    const release = h.controller.registerCloseHandler('text', () => { throw new Error('cannot retain cleanup') })
    const perform = () => {
      if (operation === 'close') h.controller.closeIn(SESSION, tabId)
      else h.controller.openTab('guide', { replaceTab: tabId, revealIfOpened: false })
    }
    expect(perform).toThrow('cannot retain cleanup')
    expect(h.layout().tabs[tabId]).toBeDefined()
    release()
    perform()
    expect(h.layout().tabs[tabId]).toBeUndefined()
  })
})

describe('SidebarRightController — close others (P-16)', () => {
  /** Adopt the seat's store, expand, and open a/b/c aside the seeded guide; returns the surface's pane. */
  function withPane(h: ReturnType<typeof harness>): PaneId {
    h.adopt(SESSION, h.instance)
    h.expand()
    h.publish()
    for (const name of ['a.txt', 'b.txt', 'c.txt']) {
      h.controller.openResource(`dsh-resource://file/session/s-test/${name}`)
      h.publish()
    }
    return h.layout().activePaneId
  }

  it('closes the pane\'s other tabs, keeping the asked tab focused in its pane, as one entry', () => {
    const h = harness()
    const pane = withPane(h)
    const asked = h.tabOf('b.txt')
    // The seeded guide plus three opens, b not the last one opened.
    expect(getPane(h.layout(), pane).tabs).toHaveLength(4)
    expect(getPane(h.layout(), pane).activeTabId).not.toBe(asked)
    const before = h.entries()

    h.controller.closeOthersIn(SESSION, asked)

    expect(getPane(h.layout(), pane).tabs).toEqual([asked])
    expect(getPane(h.layout(), pane).activeTabId).toBe(asked)
    expect(h.layout().activePaneId).toBe(pane)
    expect(h.layout().expanded).toBe(true)
    expect(h.entries()).toBe(before + 1)
  })

  it('leaves another pane and a floating panel untouched', () => {
    const h = harness()
    h.adopt(SESSION, h.instance)
    h.expand()
    h.publish()
    h.controller.openResource('dsh-resource://file/session/s-test/a.txt')
    h.publish()
    h.instance.actions.splitPane(SESSION)
    h.publish()
    const [left, right] = dockPaneIds(h.layout())
    if (left === undefined || right === undefined) throw new Error('expected two panes')
    h.controller.openResource('dsh-resource://file/session/s-test/b.txt')
    h.publish()
    h.instance.actions.floatTab(SESSION, h.tabOf('a.txt'))
    h.publish()
    const leftBefore = getPane(h.layout(), left)
    const floatsBefore = h.layout().floats
    expect(floatsBefore).toHaveLength(1)
    const asked = h.tabOf('b.txt')
    expect(getPane(h.layout(), right).tabs.length).toBeGreaterThan(1)

    h.controller.closeOthersIn(SESSION, asked)

    expect(getPane(h.layout(), right).tabs).toEqual([asked])
    expect(getPane(h.layout(), right).activeTabId).toBe(asked)
    expect(h.layout().activePaneId).toBe(right)
    expect(getPane(h.layout(), left)).toEqual(leftBefore)
    expect(h.layout().floats).toEqual(floatsBefore)
    expect(findTabPane(h.layout(), h.tabOf('a.txt')).host).toBe('float')
  })

  it('runs each removed tab\'s close handler exactly once with its own record, never the asked tab\'s', () => {
    const h = harness()
    const pane = withPane(h)
    const asked = h.tabOf('b.txt')
    const a = h.tabOf('a.txt')
    const c = h.tabOf('c.txt')
    const seed = getPane(h.layout(), pane).tabs.find(id => h.layout().tabs[id]?.kind === 'guide')
    if (seed === undefined) throw new Error('expected the seeded guide')
    const records = { ...h.layout().tabs }
    const text = vi.fn()
    const guide = vi.fn()
    const releaseText = h.controller.registerCloseHandler('text', text)
    const releaseGuide = h.controller.registerCloseHandler('guide', guide)
    try {
      h.controller.closeOthersIn(SESSION, asked)
    } finally {
      releaseText()
      releaseGuide()
    }
    expect(guide).toHaveBeenCalledExactlyOnceWith(SESSION, records[seed])
    // Pane order: the guide, a, the asked b, c — the handler sees a and c, never b.
    expect(text.mock.calls).toEqual([[SESSION, records[a]], [SESSION, records[c]]])
    expect(getPane(h.layout(), pane).tabs).toEqual([asked])
  })

  it('does nothing without an adopted surface, without the tab, or with nothing else closable', () => {
    const h = harness()
    // Never adopted: no store to act on.
    expect(() => { h.controller.closeOthersIn(SESSION, 'tab-1' as TabId) }).not.toThrow()
    // Adopted but never written: no surface for the session yet.
    const idle = createSidebarRightStore(() => ({ kind: 'guide', title: 'seed' })).create()
    const release = h.adopt(SESSION, idle)
    try {
      expect(() => { h.controller.closeOthersIn(SESSION, 'tab-1' as TabId) }).not.toThrow()
    } finally {
      release()
    }
    // A surface whose layout holds no such tab, then a sole guide with no other tab.
    h.adopt(SESSION, h.instance)
    h.expand()
    h.publish()
    const before = h.entries()
    expect(() => { h.controller.closeOthersIn(SESSION, 'tab-1' as TabId) }).not.toThrow()
    const seed = Object.values(h.layout().tabs)[0]
    if (seed === undefined) throw new Error('expected the seeded guide')
    h.controller.closeOthersIn(SESSION, seed.id)
    expect(h.layout().tabs[seed.id]).toBeDefined()
    expect(h.entries()).toBe(before)
  })
})

describe('SidebarRightController — a file tree row\'s open (P-15)', () => {
  /** The address a row click produces. */
  const file = (path: string): string => `dsh-resource://file/session/s-test/${path}`

  /**
   * A mounted surface whose root pane holds only the 文件 page, with its
   * occurrence wired the way the seat wires every tab — the domain's own
   * `openResource`, which is exactly what a row's click calls.
   */
  function withTree(): { h: ReturnType<typeof harness>; tree: TabId } {
    const h = harness()
    // Stands in for ui-sidebar-files' own page kind.
    h.tabs.register({ id: 'test/files', kind: 'files', title: () => 'files' })
    h.adopt(SESSION, h.instance)
    h.expand()
    h.publish()
    // The guide gives way to the file page, as the `workspace.files` command has it.
    h.controller.openTab('files', { replaceTab: h.tabOf('seed') })
    h.publish()
    return { h, tree: h.tabOf('files') }
  }

  /** What a row click does: the tree tab's own action, asking for the other pane. */
  const click = (h: ReturnType<typeof harness>, tree: TabId, path: string): void => {
    h.controller.tabDomain.occurrence(SESSION, { id: tree }).tabActions.openResource(file(path), { preferOtherPane: true })
    h.publish()
  }

  /** The tree's pane still holds exactly `tabs`, with the tree tab active. */
  const expectTreePane = (h: ReturnType<typeof harness>, tree: TabId, tabs: readonly TabId[] = [tree]): void => {
    const pane = findTabPane(h.layout(), tree)
    expect(pane.tabs).toEqual(tabs)
    expect(pane.activeTabId).toBe(tree)
  }

  /** The docked pane that is not the tree's. */
  const otherPane = (h: ReturnType<typeof harness>, tree: TabId): ReturnType<typeof getPane> => {
    const treePane = findTabPane(h.layout(), tree).id
    const other = dockPaneIds(h.layout()).find(id => id !== treePane)
    if (other === undefined) throw new Error('expected a second docked pane')
    return getPane(h.layout(), other)
  }

  it('AC-1: with the tree\'s pane alone, splits and seats the preview alone in the new pane', () => {
    const { h, tree } = withTree()
    expect(dockPaneIds(h.layout())).toHaveLength(1)
    const before = h.entries()
    click(h, tree, 'a.txt')
    expect(dockPaneIds(h.layout())).toHaveLength(2)
    const preview = otherPane(h, tree)
    expect(preview.tabs).toEqual([h.tabOf('a.txt')])
    expect(preview.activeTabId).toBe(h.tabOf('a.txt'))
    // The new pane sits to the right of the tree's, and the open is one history entry.
    expect(dockPaneIds(h.layout())).toEqual([findTabPane(h.layout(), tree).id, preview.id])
    expect(h.entries()).toBe(before + 1)
    expectTreePane(h, tree)
  })

  it('AC-2: three files in a row become three tabs of the other pane, in click order, the last one active', () => {
    const { h, tree } = withTree()
    const opened: TabId[] = []
    for (const path of ['a.txt', 'b.txt', 'c.txt']) {
      click(h, tree, path)
      opened.push(h.tabOf(path))
      expect(dockPaneIds(h.layout())).toHaveLength(2)
      const preview = otherPane(h, tree)
      expect(preview.tabs).toEqual(opened)
      expect(preview.activeTabId).toBe(opened.at(-1))
      expectTreePane(h, tree)
    }
    expect(new Set(opened).size).toBe(3)
  })

  it('AC-3: clicking a file already open in the other pane activates that tab instead of opening a second', () => {
    const { h, tree } = withTree()
    click(h, tree, 'a.txt')
    click(h, tree, 'b.txt')
    const tabs = otherPane(h, tree).tabs
    expect(otherPane(h, tree).activeTabId).toBe(h.tabOf('b.txt'))
    click(h, tree, 'a.txt')
    expect(Object.values(h.layout().tabs).filter(tab => tab.title === 'a.txt')).toHaveLength(1)
    expect(otherPane(h, tree).tabs).toEqual(tabs)
    expect(otherPane(h, tree).activeTabId).toBe(h.tabOf('a.txt'))
    expect(dockPaneIds(h.layout())).toHaveLength(2)
    expectTreePane(h, tree)
  })

  it('AC-4: a preview left in the tree\'s own pane is not reused when the open splits', () => {
    const { h, tree } = withTree()
    // The layout an earlier build left behind: the preview beside the tree tab.
    h.controller.tabDomain.occurrence(SESSION, { id: tree }).tabActions.openResource(file('a.txt'))
    h.publish()
    const stale = h.tabOf('a.txt')
    h.instance.actions.focusTab(SESSION, tree)
    h.publish()
    expectTreePane(h, tree, [tree, stale])

    click(h, tree, 'a.txt')
    expect(dockPaneIds(h.layout())).toHaveLength(2)
    const preview = otherPane(h, tree)
    expect(preview.tabs).toHaveLength(1)
    expect(preview.tabs[0]).not.toBe(stale)
    expect(h.layout().tabs[preview.tabs[0] as TabId]?.contentId).toBe(file('a.txt'))
    expect(preview.activeTabId).toBe(preview.tabs[0])
    expectTreePane(h, tree, [tree, stale])
  })

  it('AC-4: a preview left in the tree\'s own pane is not reused when another pane exists', () => {
    const { h, tree } = withTree()
    h.controller.tabDomain.occurrence(SESSION, { id: tree }).tabActions.openResource(file('a.txt'))
    h.publish()
    const stale = h.tabOf('a.txt')
    h.instance.actions.focusTab(SESSION, tree)
    h.publish()
    click(h, tree, 'b.txt')
    const tabs = otherPane(h, tree).tabs

    click(h, tree, 'a.txt')
    expect(dockPaneIds(h.layout())).toHaveLength(2)
    const preview = otherPane(h, tree)
    expect(preview.tabs).toHaveLength(2)
    expect(preview.tabs[0]).toBe(tabs[0])
    expect(preview.tabs[1]).not.toBe(stale)
    expect(h.layout().tabs[preview.tabs[1] as TabId]?.contentId).toBe(file('a.txt'))
    expect(preview.activeTabId).toBe(preview.tabs[1])
    expectTreePane(h, tree, [tree, stale])
  })

  it('AC-5: with no room to split and no other pane, the preview is a tab beside the tree and is reused there', () => {
    const { h, tree } = withTree()
    h.room.allowed = false
    click(h, tree, 'a.txt')
    expect(dockPaneIds(h.layout())).toHaveLength(1)
    const a = h.tabOf('a.txt')
    const pane = findTabPane(h.layout(), tree)
    expect(pane.tabs).toEqual([tree, a])
    expect(pane.activeTabId).toBe(a)

    h.instance.actions.focusTab(SESSION, tree)
    h.publish()
    click(h, tree, 'a.txt')
    expect(findTabPane(h.layout(), tree).tabs).toEqual([tree, a])
    expect(findTabPane(h.layout(), tree).activeTabId).toBe(a)
    expect(dockPaneIds(h.layout())).toHaveLength(1)
  })

  it('AC-5: a floating tree opens as it does without the option, never into a split', () => {
    const floated = (preferOtherPane: boolean): { panes: number; host: string; tabs: number } => {
      const { h, tree } = withTree()
      // A second docked tab keeps the dock populated once the tree floats.
      h.controller.openResource(file('kept.txt'))
      h.publish()
      h.controller.float(tree)
      h.publish()
      expect(findTabPane(h.layout(), tree).host).toBe('float')
      const actions = h.controller.tabDomain.occurrence(SESSION, { id: tree }).tabActions
      actions.openResource(file('a.txt'), preferOtherPane ? { preferOtherPane: true } : {})
      h.publish()
      return {
        panes: dockPaneIds(h.layout()).length,
        host: findTabPane(h.layout(), h.tabOf('a.txt')).host,
        tabs: Object.keys(h.layout().tabs).length,
      }
    }
    expect(floated(true)).toEqual(floated(false))
    expect(floated(true).panes).toBe(1)
  })

  it('does not split for a session whose seat is not the mounted one', () => {
    const { h, tree } = withTree()
    const release = h.controller.bind({
      sessionId: 's-other' as SessionId, actions: h.instance.actions, surfaces: {},
      closeWithFocus: (_paneId, close) => { close() },
      openWithFocus: (open) => { open() },
      canSplitPane: () => true,
    })
    h.controller.tabDomain.occurrence(SESSION, { id: tree }).tabActions.openResource(file('a.txt'), { preferOtherPane: true })
    release()
    expect(dockPaneIds(h.layout())).toHaveLength(1)
    expect(findTabPane(h.layout(), tree).tabs).toEqual([tree, h.tabOf('a.txt')])
  })

  it('keeps duplicates in the other pane when the caller forbids the reveal', () => {
    const { h, tree } = withTree()
    click(h, tree, 'a.txt')
    h.controller.tabDomain.occurrence(SESSION, { id: tree }).tabActions
      .openResource(file('a.txt'), { preferOtherPane: true, revealIfOpened: false })
    h.publish()
    expect(otherPane(h, tree).tabs).toHaveLength(2)
    expectTreePane(h, tree)
  })

  it('replaceTab wins over preferOtherPane: the open takes the tree tab\'s place', () => {
    const { h, tree } = withTree()
    click(h, tree, 'a.txt')
    const preview = otherPane(h, tree)
    const treePane = findTabPane(h.layout(), tree).id
    h.controller.tabDomain.occurrence(SESSION, { id: tree }).tabActions
      .openResource(file('b.txt'), { preferOtherPane: true, replaceTab: true })
    h.publish()
    expect(h.layout().tabs[tree]).toBeUndefined()
    expect(getPane(h.layout(), treePane).tabs).toEqual([h.tabOf('b.txt')])
    expect(getPane(h.layout(), preview.id).tabs).toEqual(preview.tabs)
  })

  it('a service-level open with the option leaves the active pane for the other one', () => {
    const { h, tree } = withTree()
    click(h, tree, 'a.txt')
    h.instance.actions.focusPane(SESSION, findTabPane(h.layout(), tree).id)
    h.publish()
    h.controller.openResource(file('b.txt'), { preferOtherPane: true })
    h.publish()
    expect(otherPane(h, tree).tabs).toEqual([h.tabOf('a.txt'), h.tabOf('b.txt')])
    expectTreePane(h, tree)
  })

  it('focuses a page the origin pane already holds instead of splitting for it', () => {
    const { h, tree } = withTree()
    h.controller.openTab('files', { preferOtherPane: true })
    h.publish()
    expect(dockPaneIds(h.layout())).toHaveLength(1)
    expectTreePane(h, tree)
  })

  it('opens a second page of the kind in the other pane when one exists', () => {
    const { h, tree } = withTree()
    click(h, tree, 'a.txt')
    h.controller.tabDomain.occurrence(SESSION, { id: tree }).tabActions.openTab('files', { preferOtherPane: true })
    h.publish()
    const preview = otherPane(h, tree)
    expect(preview.tabs.map(id => h.layout().tabs[id]?.kind)).toEqual(['text', 'files'])
    expect(Object.values(h.layout().tabs).filter(tab => tab.kind === 'files')).toHaveLength(2)
    expectTreePane(h, tree)
  })

  it('a floating pane named as the target is treated as it is without the option', () => {
    const named = (preferOtherPane: boolean): { panes: number; active: PaneId; tabs: number; refusal: string } => {
      const { h, tree } = withTree()
      h.controller.openResource(file('kept.txt'))
      h.publish()
      h.controller.float(tree)
      h.publish()
      const floating = findTabPane(h.layout(), tree)
      expect(floating.host).toBe('float')
      h.instance.actions.focusPane(SESSION, activeDockPaneId(h.layout()))
      h.publish()
      const placement = { paneId: floating.id, ...preferOtherPane ? { preferOtherPane: true } : {} }
      // The page the floating pane holds is focused there.
      h.controller.openTab('files', placement)
      h.publish()
      expect(findTabPane(h.layout(), tree).id).toBe(floating.id)
      // A floating pane takes no second tab: the layout refuses the open either way.
      let refusal = ''
      try { h.controller.openResource(file('a.txt'), placement) } catch (error) { refusal = String(error) }
      return { panes: dockPaneIds(h.layout()).length, active: h.layout().activePaneId, tabs: Object.keys(h.layout().tabs).length, refusal }
    }
    expect(named(true)).toEqual(named(false))
    expect(named(true)).toMatchObject({ panes: 1, tabs: 2, refusal: 'Error: layout: openTab requires a docked pane' })
  })

  it('replaceTab naming a floating tab wins over preferOtherPane: the open stays in the active docked pane', () => {
    const replaced = (preferOtherPane: boolean): { landed: boolean; other: (string | undefined)[]; gone: boolean } => {
      const { h, tree } = withTree()
      click(h, tree, 'a.txt')
      click(h, tree, 'b.txt')
      h.controller.float(h.tabOf('b.txt'))
      h.publish()
      const floating = h.tabOf('b.txt')
      h.instance.actions.focusPane(SESSION, findTabPane(h.layout(), tree).id)
      h.publish()
      const active = activeDockPaneId(h.layout())
      expect(active).toBe(findTabPane(h.layout(), tree).id)
      h.controller.openResource(file('c.txt'), { replaceTab: floating, ...preferOtherPane ? { preferOtherPane: true } : {} })
      h.publish()
      return {
        landed: findTabPane(h.layout(), h.tabOf('c.txt')).id === active,
        other: otherPane(h, tree).tabs.map(id => h.layout().tabs[id]?.title),
        gone: h.layout().tabs[floating] === undefined,
      }
    }
    expect(replaced(true)).toEqual({ landed: true, other: ['a.txt'], gone: true })
    expect(replaced(true)).toEqual(replaced(false))
  })

  /** What the `workspace.files` command runs once it resolved with focus outside the sidebar. */
  const filesCommand = (h: ReturnType<typeof harness>): void => {
    const captured = h.controller.commandTarget(null)
    if (captured === undefined) throw new Error('expected a command target')
    h.controller.openTabFromTarget('files', h.controller.dockedPageTarget('files', captured))
    h.publish()
  }

  it('AC-8: after a row click, the files command reveals the tree in its own pane and adds no second files page', () => {
    const { h, tree } = withTree()
    click(h, tree, 'a.txt')
    const preview = otherPane(h, tree)
    expect(h.layout().activePaneId).toBe(preview.id)
    filesCommand(h)
    expect(Object.values(h.layout().tabs).filter(tab => tab.kind === 'files')).toHaveLength(1)
    expect(h.layout().activePaneId).toBe(findTabPane(h.layout(), tree).id)
    expectTreePane(h, tree)
    expect(otherPane(h, tree).tabs).toEqual(preview.tabs)
    expect(otherPane(h, tree).activeTabId).toBe(h.tabOf('a.txt'))
  })

  it('dockedPageTarget leaves a target alone when its own pane holds the page or no docked pane does', () => {
    const unmounted = { sessionId: SESSION, paneId: 'pane1' as PaneId, host: 'dock' as const,
      tabId: undefined, occurrence: undefined, navigationRevision: undefined }
    expect(harness().controller.dockedPageTarget('files', unmounted)).toBe(unmounted)

    const { h, tree } = withTree()
    const own = h.controller.commandTarget(null)
    if (own === undefined) throw new Error('expected a command target')
    expect(own.tabId).toBe(tree)
    expect(h.controller.dockedPageTarget('files', own)).toBe(own)
    expect(h.controller.dockedPageTarget('text', own)).toBe(own)

    // Two panes each holding the page: the captured pane keeps the command.
    click(h, tree, 'a.txt')
    h.controller.openTab('files', { paneId: otherPane(h, tree).id })
    h.publish()
    const second = h.controller.commandTarget(null)
    if (second === undefined) throw new Error('expected a command target')
    expect(second.paneId).toBe(otherPane(h, tree).id)
    expect(h.controller.dockedPageTarget('files', second)).toBe(second)
  })

  it('dockedPageTarget captures the page held by the other docked pane', () => {
    const { h, tree } = withTree()
    click(h, tree, 'a.txt')
    const captured = h.controller.commandTarget(null)
    if (captured === undefined) throw new Error('expected a command target')
    const target = h.controller.dockedPageTarget('files', captured)
    expect(target).toMatchObject({ sessionId: SESSION, paneId: findTabPane(h.layout(), tree).id, host: 'dock', tabId: tree })
    expect(target.occurrence).toBe(h.controller.tabDomain.occurrence(SESSION, { id: tree }))
    expect(h.controller.isTargetCurrent(target)).toBe(true)
  })
})

describe('SidebarRightController — a service-level open\'s reveal scope (P-12)', () => {
  const ADDRESS = 'dsh-resource://file/session/s-test/a.txt'

  /**
   * A service-level caller names no pane — `ctx.sidebarRight.openResource` from
   * another plugin, an address that opens at most one tab per pane. With a copy
   * parked in a pane that is not active, the reveal must stay out of that pane:
   * the open lands beside the caller in the active pane instead.
   */
  it('lands a fresh copy in the active pane instead of revealing one parked in another pane', () => {
    const h = harness()
    h.expand()
    h.publish()
    // Open the resource, then park its tab in a second pane and go back to the first.
    h.controller.openResource(ADDRESS)
    h.publish()
    h.instance.actions.splitPane(SESSION)
    h.publish()
    const [left, right] = dockPaneIds(h.layout())
    if (left === undefined || right === undefined) throw new Error('expected two panes')
    h.instance.actions.placeTab(SESSION, h.tabOf('a.txt'), right, 0)
    h.publish()
    const parked = h.tabOf('a.txt')
    h.instance.actions.focusPane(SESSION, left)
    h.publish()
    expect(h.layout().activePaneId).toBe(left)
    expect(findTabPane(h.layout(), parked).id).toBe(right)
    const rightBefore = getPane(h.layout(), right)
    const copiesBefore = Object.values(h.layout().tabs).filter(tab => tab.contentId === ADDRESS).length

    // No paneId: the target is the active pane, which holds no copy of the address.
    h.controller.openResource(ADDRESS)
    h.publish()

    // A second tab beside the caller, in the active pane, focused.
    const copies = Object.values(h.layout().tabs).filter(tab => tab.contentId === ADDRESS)
    expect(copies).toHaveLength(copiesBefore + 1)
    const active = getPane(h.layout(), h.layout().activePaneId)
    expect(active.id).toBe(left)
    expect(active.tabs).toContain(copies.find(tab => tab.id !== parked)?.id)
    expect(active.activeTabId).toBe(copies.find(tab => tab.id !== parked)?.id)
    // The parked copy is neither focused nor moved: its pane is left exactly as it was.
    expect(findTabPane(h.layout(), parked).id).toBe(right)
    expect(getPane(h.layout(), right)).toEqual(rightBefore)
  })
})

describe('SidebarRightController — replacement cleanup prediction (P-12)', () => {
  const ADDRESS = 'dsh-resource://file/session/s-test/a.txt'

  /**
   * Two panes each hold a copy of one address, so a surface-wide lookup reaches
   * the left copy while the open's own pane holds the right one. `replaceTab`
   * names the right copy: the store reveals that pane-local copy, so the
   * service must not read the left copy as the tab the open lands on and run the
   * right copy's cleanup under it.
   */
  it('does not clean up a replaced copy the open reveals in its own pane', () => {
    const h = harness()
    h.adopt(SESSION, h.instance)
    h.publish()
    // The left pane gets a copy, then a split opens a pane to its right.
    h.controller.openResource(ADDRESS)
    h.publish()
    h.instance.actions.splitPane(SESSION)
    h.publish()
    const [left, right] = dockPaneIds(h.layout())
    if (left === undefined || right === undefined) throw new Error('expected two panes')
    // The right pane opens its own copy, so one contentId now sits in two panes.
    h.controller.openResource(ADDRESS)
    h.publish()
    const copyIn = (paneId: PaneId): TabId => {
      const found = getPane(h.layout(), paneId).tabs.find(id => h.layout().tabs[id]?.contentId === ADDRESS)
      if (found === undefined) throw new Error('expected a copy in this pane')
      return found
    }
    const leftCopy = copyIn(left)
    const rightCopy = copyIn(right)
    expect(leftCopy).not.toBe(rightCopy)
    const handler = vi.fn()
    const release = h.controller.registerCloseHandler('text', handler)
    try {
      // Replacing the right copy with its own address: the store reveals that
      // copy in place, so no cleanup may run and the copy must survive.
      h.controller.openResource(ADDRESS, { replaceTab: rightCopy })
      h.publish()
      expect(handler).not.toHaveBeenCalled()
      expect(h.layout().tabs[rightCopy]).toBeDefined()
      expect(findTabPane(h.layout(), rightCopy).id).toBe(right)
      expect(findTabPane(h.layout(), leftCopy).id).toBe(left)
      expect(getPane(h.layout(), right).activeTabId).toBe(rightCopy)
      expect(h.layout().activePaneId).toBe(right)
    } finally {
      release()
    }
  })
})

it('releases close handlers without a stale disposer removing a replacement', () => {
  const h = harness()
  h.adopt(SESSION, h.instance)
  h.publish()
  const first = vi.fn(() => {})
  const second = vi.fn(() => {})
  const release = h.controller.registerCloseHandler('text', first)
  expect(() => h.controller.registerCloseHandler('text', second)).toThrow('already registered')
  release()
  const releaseSecond = h.controller.registerCloseHandler('text', second)
  release()
  h.controller.openResource('dsh-resource://file/session/s-test/one')
  h.publish()
  h.controller.closeIn(SESSION, h.tabOf('one'))
  expect(first).not.toHaveBeenCalled()
  expect(second).toHaveBeenCalledOnce()
  releaseSecond()
  h.controller.openResource('dsh-resource://file/session/s-test/two')
  h.publish()
  const tabId = h.tabOf('two')
  h.controller.openTab('guide', { replaceTab: tabId, revealIfOpened: false })
  expect(h.layout().tabs[tabId]).toBeUndefined()
  expect(second).toHaveBeenCalledOnce()
})
