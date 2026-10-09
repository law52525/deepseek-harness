/**
 * The plugin's registrations, and their removal when the plugin goes.
 *
 * The registry is real, because "registered" means what it says a type is; the
 * slot, locale, and Remote faces are recorders, because what matters here is
 * what was handed to them — one body seat under the type's id with its store
 * and face — and that every registration is gone after dispose, which is what
 * makes a reload safe.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ShortcutCommand } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PaneId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { dockPaneIds, findTabPane, getPane } from '@deepseek-ai/dsh-client-ui-dockkit'
import { createSidebarRightController } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/service.ts'
import { createSidebarRightStore } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/stores.ts'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { FILES_ID, FILES_KIND } from '../src/client/definition.tsx'
import { apply, inject } from '../src/client/index.ts'
import { apply as hostApply } from '../src/index.ts'
import { FilesBody } from '../src/client/FilesBody.tsx'
import { FilesTitle } from '../src/client/FilesTitle.tsx'
import { en, zh } from '../src/client/locales.ts'

interface Recorded {
  name: string
  key: string
  locale: string
  store: unknown
  inject: unknown
  component: unknown
}

async function boot(real = false) {
  const ctx = new Context()
  const tabs = new SidebarRightTabRegistry(ctx)
  const controller = createSidebarRightController(tabs, vi.fn())
  const registered: Recorded[] = []
  const slots = {
    inject: vi.fn((_name: string, register: () => () => void) => register()),
    register: vi.fn((options: Omit<Recorded, 'component'>, component: unknown) => {
      const entry: Recorded = { ...options, component }
      registered.push(entry)
      return () => { registered.splice(registered.indexOf(entry), 1) }
    }),
  }
  const dictionaries = new Map<string, unknown>()
  const locale = {
    // Copy is the dictionary's contract; the key stands in for the translation.
    bind: vi.fn(() => (key: string) => key),
    register: vi.fn((ns: string, dicts: unknown) => {
      dictionaries.set(ns, dicts)
      return () => { dictionaries.delete(ns) }
    }),
  }
  const workspaceFiles = { list: vi.fn() }
  const sidebar = {
    commandTarget: vi.fn(),
    dockedPageTarget: vi.fn((_kind: string, target: unknown) => target),
    openTabFromTarget: vi.fn(),
  }
  const commands: ShortcutCommand[] = []
  ctx.provide('shortcuts', { register: (command: ShortcutCommand) => {
    commands.push(command)
    return () => { commands.splice(commands.indexOf(command), 1) }
  } } as never)
  ctx.provide('sidebarRight', (real ? controller.controller : sidebar) as never)
  ctx.provide('sidebarRightTabs', tabs as never)
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  ctx.provide('remote', { workspaceFiles } as never)
  ctx.provide('remote.workspaceFiles', workspaceFiles as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { tabs, registered, dictionaries, fiber, sidebar, commands, ...controller }
}

describe('ui-sidebar-files apply', () => {
  it('opens files for the command target and refuses without a selected Session', async () => {
    const h = await boot()
    try {
      const command = h.commands[0]!
      const input = { region: 'page', modal: null, target: null } as const
      expect(command.resolve(input)).toEqual({ status: 'blocked', reason: 'shortcut.noSession' })
      const target = { sessionId: 'files-session' }
      h.sidebar.commandTarget.mockReturnValue(target)
      const result = command.resolve(input)
      if (result.status !== 'handled') throw new Error('Expected files command to be available')
      result.run()
      expect(h.sidebar.dockedPageTarget).toHaveBeenCalledWith('files', target)
      expect(h.sidebar.openTabFromTarget).toHaveBeenCalledWith('files', target)
    } finally { await h.fiber.dispose() }
    expect(h.commands).toEqual([])
  })
  it('AC-8: reveals the docked files page from the preview\'s pane instead of opening a second one', async () => {
    const SESSION = 's-files' as SessionId
    const h = await boot(true)
    try {
      // Stands in for the package that claims `file:` addresses.
      h.tabs.register({ id: 'test/text', kind: 'text', patterns: ['dsh-resource://file/**'], priority: 'fallback', title: () => 'preview' })
      const instance = createSidebarRightStore(() => ({ kind: 'guide', title: 'seed' })).create()
      const layout = () => instance.getSnapshot().bySession[SESSION]!.layout
      const focused: (PaneId | undefined)[] = []
      /** Republish the binding and sync the Tab domain, as the seat does after each commit. */
      const publish = (): void => {
        h.controller.tabDomain.sync(SESSION, layout())
        h.controller.bind({
          sessionId: SESSION, actions: instance.actions, surfaces: instance.getSnapshot().bySession,
          closeWithFocus: (_paneId, close) => { close() },
          openWithFocus: (open) => { focused.push(open()) },
          canSplitPane: () => true,
        })
      }
      /** Run the command with input focus outside the sidebar. */
      const command = (): void => {
        const result = h.commands[0]!.resolve({ region: 'page', modal: null, target: null })
        if (result.status !== 'handled') throw new Error('Expected files command to be available')
        result.run()
        publish()
      }
      const files = () => Object.values(layout().tabs).filter(tab => tab.kind === FILES_KIND)
      h.adopt(SESSION, instance)
      instance.actions.setExpanded(SESSION, true)
      publish()

      // No files page anywhere: the command opens one in the active docked pane.
      command()
      expect(files()).toHaveLength(1)
      const tree = files()[0]!.id
      const treePane = findTabPane(layout(), tree).id
      expect(getPane(layout(), treePane).tabs).toEqual([tree])

      // A row click: the preview takes the other pane, which becomes the active one.
      h.controller.tabDomain.occurrence(SESSION, { id: tree }).tabActions
        .openResource('dsh-resource://file/session/s-files/a.txt', { preferOtherPane: true })
      publish()
      const previewPane = dockPaneIds(layout()).find(id => id !== treePane)!
      const previews = getPane(layout(), previewPane).tabs
      expect(previews).toHaveLength(1)
      expect(layout().activePaneId).toBe(previewPane)

      command()
      expect(files().map(tab => tab.id)).toEqual([tree])
      expect(getPane(layout(), treePane).tabs).toEqual([tree])
      expect(getPane(layout(), treePane).activeTabId).toBe(tree)
      expect(getPane(layout(), previewPane).tabs).toEqual(previews)
      expect(layout().activePaneId).toBe(treePane)
      expect(focused.at(-1)).toBe(treePane)
    } finally { await h.fiber.dispose() }
  })

  it('keeps the host Loader entry inert', () => {
    expect(hostApply).not.toThrow()
  })

  it('registers the type, its dictionaries, and the body and title seats under the type\'s id', async () => {
    const { tabs, registered, dictionaries } = await boot()
    const definition = tabs.get(FILES_KIND)
    expect(definition?.id).toBe(FILES_ID)
    expect(definition?.priority).toBe('builtin')
    expect(definition?.title('sidebar://files')).toBe('type.label')
    expect(definition?.guide?.map(entry => [entry.order, entry.title(), entry.description?.()]))
      .toEqual([[10, 'guide.title', 'guide.description']])
    expect(dictionaries.get('sidebarFiles')).toEqual({ zh, en })
    // The seat key is the implementation's id, not the kind: an extension may
    // take the kind over, and the seat must still find this body.
    expect(registered.map(entry => [entry.name, entry.key, entry.locale, entry.component])).toEqual([
      ['sidebar.right.pane.tab', FILES_ID, 'sidebarFiles', FilesBody],
      ['sidebar.right.pane.tab.title', FILES_ID, undefined, FilesTitle],
    ])
    expect(registered[0]?.store).toBeDefined()
    expect(typeof registered[0]?.inject).toBe('function')
  })

  it('takes every registration back when the plugin is disposed', async () => {
    const { tabs, registered, dictionaries, fiber } = await boot()
    await fiber.dispose()
    expect(tabs.get(FILES_KIND)).toBeUndefined()
    expect(registered).toEqual([])
    expect(dictionaries.size).toBe(0)
  })
})
