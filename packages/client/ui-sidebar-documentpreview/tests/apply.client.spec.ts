/**
 * The plugin's registrations, and their removal when the plugin goes.
 *
 * The registry is real, because "registered" means what it says a type is; the
 * slot, locale, and Remote faces are recorders, because what matters here is
 * what was handed to them — one body seat under the type's kind with its store
 * and face — and that every registration is gone after dispose, which is what
 * makes a reload safe.
 */
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SidebarRightTabRegistry } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/tab-registry.ts'
import { createSidebarRightController } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/service.ts'
import { createSidebarRightStore } from '@deepseek-ai/dsh-client-ui-sidebar-right/src/client/stores.ts'
import { TEXTPREVIEW_ID, TEXTPREVIEW_KIND } from '../src/client/definition.ts'
import { apply, inject } from '../src/client/index.ts'
import { OfficeFontAction } from '../src/client/office/OfficeFontAction.tsx'
import { OfficeBody } from '../src/client/office/OfficeBody.tsx'
import { TextPreview } from '../src/client/TextPreview.tsx'
import { TextTitle } from '../src/client/TextTitle.tsx'
import { TextBody } from '../src/client/text/TextBody.tsx'
import { PLAIN_BODY_ID } from '../src/client/text/index.ts'
import { MarkdownBody } from '../src/client/markdown/MarkdownBody.tsx'
import { MARKDOWN_BODY_ID } from '../src/client/markdown/index.ts'
import { HtmlBody } from '../src/client/html/HtmlBody.tsx'
import { HTML_BODY_ID } from '../src/client/html/index.ts'
import { ImageBody } from '../src/client/image/ImageBody.tsx'
import { IMAGE_BODY_ID } from '../src/client/image/index.ts'
import { LazyPdfBody } from '../src/client/pdf/LazyPdfBody.tsx'
import { LazyExcelBody } from '../src/client/excel/LazyExcelBody.tsx'
import { PDF_BODY_ID } from '../src/client/pdf/index.ts'
import { CodeBody } from '../src/client/code/CodeBody.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { textFace } from '../src/client/face.ts'
import type { TextStore } from '../src/client/store.ts'
import { ABSOLUTE_PATH, ADDRESS, FILE, PATH, SESSION, TAB_ID, byteResult, createResources, page } from './fixtures.client.ts'

interface Recorded {
  name: string
  key: string
  locale?: string
  store?: unknown
  inject?: unknown
  component: unknown
}

/**
 * Load the plugin over recorder faces.
 * @param options - `sidebarRight: 'real'` provides the package's own controller,
 *   so a case driving an actual close path (AC-17's close others) reaches the
 *   handler the plugin registered rather than a recorder.
 */
async function boot(options: { sidebarRight?: 'real' } = {}) {
  const ctx = new Context()
  ctx.provide('resources', createResources())
  ctx.provide('configForms', { developerTools: { enabled: createSnapshotStore(true) } } as never)
  const tabs = new SidebarRightTabRegistry(ctx)
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
    bind: () => (key: string) => key,
    register: vi.fn((ns: string, dicts: unknown) => {
      dictionaries.set(ns, dicts)
      return () => { dictionaries.delete(ns) }
    }),
  }
  const read = vi.fn().mockResolvedValue(page(1, ['first'], true))
  const readBytes = vi.fn<ClientRemote['workspaceFiles']['readBytes']>(async () => byteResult())
  const writeText = vi.fn<ClientRemote['workspaceFiles']['writeText']>()
  const stat = vi.fn<ClientRemote['workspaceFiles']['stat']>()
  const closeHandlers = new Map<string, (sessionId: typeof SESSION, tab: { id: typeof TAB_ID; kind: string }) => void>()
  const sidebarRightRecorder = {
    registerCloseHandler: vi.fn((kind: string, handler: (sessionId: typeof SESSION, tab: { id: typeof TAB_ID; kind: string }) => void) => {
      closeHandlers.set(kind, handler)
      return () => { closeHandlers.delete(kind) }
    }),
  }
  const realSidebarRight = options.sidebarRight === 'real'
    ? createSidebarRightController(tabs, vi.fn<(address: string, signal: AbortSignal) => void>())
    : undefined
  ctx.provide('sidebarRightTabs', tabs as never)
  ctx.provide('sidebarRight', (realSidebarRight?.controller ?? sidebarRightRecorder) as never)
  ctx.provide('slots', slots as never)
  ctx.provide('locale', locale as never)
  ctx.provide('remote', { workspaceFiles: { read, readBytes, writeText, stat } } as never)
  ctx.provide('remote.workspaceFiles', { read, readBytes, writeText, stat } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  onTestFinished(async () => { await fiber.dispose() })
  await fiber.await()
  return { ctx, tabs, registered, dictionaries, fiber, read, readBytes, writeText, closeHandlers, realSidebarRight }
}

describe('ui-sidebar-documentpreview apply', () => {
  it('registers the type, its dictionaries, and the body and title seats under the type\'s id, the body with a store and a face', async () => {
    const { tabs, registered, dictionaries } = await boot()
    expect(tabs.get(TEXTPREVIEW_KIND)?.priority).toBe('fallback')
    expect(tabs.get(TEXTPREVIEW_KIND)?.id).toBe(TEXTPREVIEW_ID)
    expect(dictionaries.get('sidebarDocumentPreview')).toEqual({ zh, en })
    // The seat key is the implementation's id, not the kind: an extension may
    // take the kind over, and the seat must still find this body.
    expect(registered.map(entry => [entry.name, entry.key, entry.locale, entry.component])).toEqual([
      ['sidebar.right.pane.tab', TEXTPREVIEW_ID, 'sidebarDocumentPreview', TextPreview],
      ['sidebar.right.pane.tab.title', TEXTPREVIEW_ID, undefined, TextTitle],
      ['sidebar.right.tab.document', PLAIN_BODY_ID, undefined, TextBody],
      ['sidebar.right.tab.document', MARKDOWN_BODY_ID, 'documentMarkdown', MarkdownBody],
      ['sidebar.right.tab.document', HTML_BODY_ID, 'documentHtml', HtmlBody],
      ['sidebar.right.tab.document', IMAGE_BODY_ID, 'sidebarImage', ImageBody],
      ['sidebar.right.tab.document', PDF_BODY_ID, 'sidebarPdf', LazyPdfBody],
      ['sidebar.right.tab.document.action', '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/office', 'sidebarOffice', OfficeFontAction],
      ['sidebar.right.tab.document', '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/office', 'sidebarOffice', OfficeBody],
      ['sidebar.right.tab.document.office.pdf', '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/office', 'sidebarPdf', LazyPdfBody],
      ['sidebar.right.tab.document', '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/excel', 'sidebarExcel', LazyExcelBody],
      ['sidebar.right.tab.document', '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code', 'sidebarCodePreview', CodeBody],
    ])
    expect(registered[0]?.store).toBeDefined()
    expect(typeof registered[0]?.inject).toBe('function')
  })

  it('takes every registration back when the plugin is disposed', async () => {
    const { tabs, registered, dictionaries, fiber } = await boot()
    await fiber.dispose()
    expect(tabs.get(TEXTPREVIEW_KIND)).toBeUndefined()
    expect(registered).toEqual([])
    expect(dictionaries.size).toBe(0)
  })

  it('keeps specialized previews first and offers Code for shared highlighting suffixes', async () => {
    const { ctx } = await boot()
    const previews = ctx.get('documentPreviews')
    if (previews === undefined) throw new Error('documentPreviews was not provided')
    const sharedHighlighter = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code'
    const owners = new Map<string, string>()
    for (const definition of previews.getSnapshot()) {
      for (const extension of new Set([...definition.extensions, ...definition.binaryExtensions ?? []])) {
        const winner = previews.candidates(`file.${extension}`)[0]
        const earlier = owners.get(extension)
        if (earlier === undefined) {
          expect(winner?.id, `${definition.id} declares .${extension}`).toBe(definition.id)
        } else {
          expect(winner?.id, `.${extension} must stay with the earlier ${earlier}`).toBe(earlier)
          expect(definition.id, `later body ${definition.id} must not collide on .${extension}`).toBe(sharedHighlighter)
        }
        owners.set(extension, earlier ?? definition.id)
      }
    }
    const excel = '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/excel'
    expect(previews.candidates('table.csv').map(candidate => candidate.id)).toEqual([excel, sharedHighlighter])
    expect(previews.candidates('table.tsv')[0]?.id).toBe(excel)
  })

  it('injects paged and byte Remote reads independently of resource metadata', async () => {
    const { registered, read, readBytes } = await boot()
    const registration = registered.find(entry => entry.component === TextPreview)
    if (registration === undefined) throw new Error('missing preview registration')
    const instance = (registration.store as TextStore).create()
    const face = (registration.inject as ReturnType<typeof textFace>)(SESSION, instance.actions)
    const controller = new AbortController()
    onTestFinished(() => { controller.abort() })
    face.loadPage(TAB_ID, FILE, 1, controller.signal, 'v1')
    await read.mock.results[0]?.value
    expect(read).toHaveBeenCalledExactlyOnceWith(FILE.sessionId, FILE.path, { offset: 1 }, controller.signal)
    expect(instance.getSnapshot().byTab[TAB_ID]?.pages[1]?.text).toBe('first')
    face.loadAll(TAB_ID, FILE, controller.signal, 'v1')
    await vi.waitFor(() => { expect(instance.getSnapshot().byTab[TAB_ID]?.complete).toBeDefined() })
    expect(readBytes).toHaveBeenCalledExactlyOnceWith(FILE.sessionId, FILE.path, {}, expect.any(AbortSignal))
    expect(instance.getSnapshot().byTab[TAB_ID]?.complete?.data).toEqual(new Uint8Array([0, 1, 255]))
    readBytes.mockResolvedValueOnce({ ok: false, error: new RemoteError('workspace-file/not-found', 'File missing', { path: FILE.path }) })
    face.reloadAll(TAB_ID, FILE, controller.signal, 'v2')
    await expect.poll(() => instance.getSnapshot().byTab[TAB_ID]?.failure).toMatchObject({ code: 'workspace-file/not-found', message: 'File missing' })
    expect(instance.getSnapshot().byTab[TAB_ID]?.complete).toBeUndefined()
  })

  /**
   * One open editor whose complete read and draft are already recorded, ready
   * for a close. The read's bytes decode as the text, so the editor loads. The
   * tab and its lifetime default to the single-close case; a batch close hands
   * in the record and signal the real Sidebar store minted.
   */
  async function editing(
    registered: Recorded[],
    readBytes: Awaited<ReturnType<typeof boot>>['readBytes'],
    tabId: TabId = TAB_ID,
    lifetime?: AbortSignal,
  ) {
    const registration = registered.find(entry => entry.component === TextPreview)
    if (registration === undefined) throw new Error('missing preview registration')
    const instance = (registration.store as TextStore).create()
    const face = (registration.inject as ReturnType<typeof textFace>)(SESSION, instance.actions)
    const controller = new AbortController()
    readBytes.mockResolvedValueOnce(byteResult(new TextEncoder().encode('alpha')))
    face.openEditor(tabId, ADDRESS, FILE, lifetime ?? controller.signal, 'v1')
    await vi.waitFor(() => { expect(instance.getSnapshot().byTab[tabId]?.edit?.text).toBe('alpha') })
    face.editChanged(tabId, 'alpha!')
    return { instance, face, controller }
  }

  it('flushes a tab exited by the pane\'s "close others" over that tab\'s own lifetime (AC-17)', async () => {
    const { registered, readBytes, writeText, realSidebarRight } = await boot({ sidebarRight: 'real' })
    if (realSidebarRight === undefined) throw new Error('expected the real Sidebar controller')
    const store = createSidebarRightStore(() => ({ kind: 'guide', title: 'seed' })).create()
    const release = realSidebarRight.adopt(SESSION, store)
    onTestFinished(() => { release() })
    store.actions.setExpanded(SESSION, true)
    let notes: TabId | undefined
    store.actions.openContent(SESSION, { kind: TEXTPREVIEW_KIND, contentId: ADDRESS, title: 'notes.md' }, (id) => { notes = id })
    let asked: TabId | undefined
    store.actions.openContent(SESSION, { kind: TEXTPREVIEW_KIND, contentId: 'dsh-resource://file/session/s-1/work/other.md', title: 'other.md' }, (id) => { asked = id })
    if (notes === undefined || asked === undefined) throw new Error('expected both tabs to land')
    // The editor holds the lifetime the real store minted for this record, so
    // the batch close is what ends it.
    const tabSignal = realSidebarRight.controller.tabDomain.occurrence(SESSION, { id: notes }).signal
    const { instance } = await editing(registered, readBytes, notes, tabSignal)
    const pending = Promise.withResolvers<Awaited<ReturnType<ClientRemote['workspaceFiles']['writeText']>>>()
    writeText.mockReturnValueOnce(pending.promise)

    realSidebarRight.controller.closeOthersIn(SESSION, asked)

    expect(writeText).toHaveBeenCalledExactlyOnceWith(SESSION, PATH, 'alpha!', 'v1', expect.any(AbortSignal))
    // The batch close committed: the record left the surface, and its lifetime
    // aborted with it.
    expect(store.getSnapshot().bySession[SESSION]?.layout.tabs[notes]).toBeUndefined()
    expect(tabSignal.aborted).toBe(true)
    // The request rides its own signal, never the tab's: the tab ending does
    // not cancel it, and its result reaches no bucket of the destroyed editor.
    const writeSignal = writeText.mock.calls[0]?.[4]
    expect(writeSignal).toBeDefined()
    expect(writeSignal).not.toBe(tabSignal)
    expect(writeSignal?.aborted).toBe(false)
    expect(instance.getSnapshot().byTab[notes]).toBeUndefined()
    pending.resolve({ ok: true, value: { absolutePath: ABSOLUTE_PATH, version: 'v2' } })
    await pending.promise
    await Promise.resolve()
    expect(instance.getSnapshot().byTab[notes]).toBeUndefined()
  })

  it('flushes a closing tab\'s last input over the tab\'s own signal (AC-17)', async () => {
    const { registered, readBytes, writeText, closeHandlers } = await boot()
    const { instance, controller } = await editing(registered, readBytes)
    const pending = Promise.withResolvers<Awaited<ReturnType<ClientRemote['workspaceFiles']['writeText']>>>()
    writeText.mockReturnValueOnce(pending.promise)
    closeHandlers.get(TEXTPREVIEW_KIND)?.(SESSION, { id: TAB_ID, kind: TEXTPREVIEW_KIND })
    expect(writeText).toHaveBeenCalledExactlyOnceWith(SESSION, PATH, 'alpha!', 'v1', expect.any(AbortSignal))
    // The tab record ends while the write is in flight; the request's own
    // signal survives, the request still settles, and its result reaches no bucket.
    const writeSignal = writeText.mock.calls[0]?.[4]
    expect(writeSignal).toBeDefined()
    expect(writeSignal).not.toBe(controller.signal)
    controller.abort()
    expect(writeSignal?.aborted).toBe(false)
    expect(instance.getSnapshot().byTab[TAB_ID]).toBeUndefined()
    pending.resolve({ ok: true, value: { absolutePath: ABSOLUTE_PATH, version: 'v2' } })
    await vi.waitFor(() => { expect(writeText).toHaveBeenCalledOnce() })
    expect(instance.getSnapshot().byTab[TAB_ID]).toBeUndefined()
  })

  it('writes nothing when a tab closes with the conflict question standing (AC-18)', async () => {
    const { registered, readBytes, writeText, closeHandlers } = await boot()
    const { instance, face, controller } = await editing(registered, readBytes)
    face.conflictEdit(TAB_ID)
    closeHandlers.get(TEXTPREVIEW_KIND)?.(SESSION, { id: TAB_ID, kind: TEXTPREVIEW_KIND })
    expect(writeText).not.toHaveBeenCalled()
    controller.abort()
    expect(instance.getSnapshot().byTab[TAB_ID]).toBeUndefined()
  })
})
