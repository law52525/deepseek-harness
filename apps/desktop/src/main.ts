/**
 * Electron main: spawn the desktop Host child, serve dsh-web-frontend dist
 * over `dsh://app`, answer Session-log export from that child, and forward
 * opaque RPC. HostIpcGateway stays in the child.
 */

import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, Menu, protocol, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { startDesktopAutoUpdate, noteBlockingOverlayArmed, onBeforeQuitForUpdate } from './auto-update.ts'
import { openHttpsExternal } from './open-external.ts'
import { openPathAndQuit } from './open-path.ts'
import {
  BlockingOverlayController,
  allowLifecycleRequest,
  overlayDataUrl,
  shouldBlockAppQuit,
  shouldBlockShortcut,
  shouldQuitWhenLastWindowClosed,
  shouldRespawnHostOnActivate,
  shouldAllowRendererNavigation,
  type BlockingOverlayWindow,
} from './blocking-overlay.ts'
import { fileFromDshUrl, isDesktopSessionExportPath, sessionExportFromDshUrl } from './dsh-protocol.ts'
import { hostErrorPage, hostStartingPage, summarizeDesktopFailure } from './error-page.ts'
import { resolveFrontendDist } from './frontend-dist.ts'
import { spawnDesktopHost, type DesktopHostChild } from './host-child.ts'
import { resolveBundledProfileTemplate } from './packaged-resources.ts'
import { ensureProfileFromTemplate } from './profile-bootstrap.ts'
import { responseFromSessionExport } from './session-export.ts'
import { openAuthWindow, type AuthWindowFactory, type OpenAuthWindowOptions } from './auth-window.ts'

protocol.registerSchemesAsPrivileged([
  { scheme: 'dsh', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])

function resolveShellIcon(): string | undefined {
  try {
    return fileURLToPath(new URL('../resources/icon.png', import.meta.url))
  } catch {
    return undefined
  }
}

const SHELL_ICON = resolveShellIcon()

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
}

let host: DesktopHostChild | undefined
let windowRef: BrowserWindow | undefined
let disposing = false
let protocolRegistered = false
let hostFailed = false

function appendDesktopLog(message: string): void {
  try {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    const clipped = summarizeDesktopFailure(message)
    appendFileSync(join(dir, 'desktop-main.log'), `${new Date().toISOString()} ${clipped}\n`)
  } catch {
    // Startup logging must never prevent a window from appearing.
  }
}

function installProcessFailureHandlers(): void {
  const report = (kind: string, error: unknown): void => {
    const detail = summarizeDesktopFailure(error)
    appendDesktopLog(`${kind} ${detail}`)
    console.error(`[desktop] ${kind}:`, error)
    if (windowRef !== undefined && !windowRef.isDestroyed()) enterHostFailure(detail)
  }
  process.on('uncaughtException', (error) => { report('uncaughtException', error) })
  process.on('unhandledRejection', (error) => { report('unhandledRejection', error) })
}

installProcessFailureHandlers()

function applyArmedChrome(win: BrowserWindow | undefined, armed: boolean): void {
  if (win === undefined || win.isDestroyed()) return
  win.setMinimizable(!armed)
  win.setMaximizable(!armed)
  win.setFullScreenable(!armed)
  if (armed) {
    if (win.isMinimized()) win.restore()
    if (win.isFullScreen()) win.setFullScreen(false)
    win.setMenu(null)
  } else {
    win.setMenu(Menu.getApplicationMenu())
  }
}

const blockingOverlay = new BlockingOverlayController(
  {
    create({ title, body }) {
      const parent = windowRef !== undefined && !windowRef.isDestroyed() ? windowRef : undefined
      const win = new BrowserWindow({
        ...parent === undefined ? {} : { parent },
        modal: parent !== undefined,
        show: true,
        closable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        alwaysOnTop: true,
        fullscreen: true,
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      })
      win.setMenu(null)
      win.webContents.on('before-input-event', (event, input) => {
        if (shouldBlockShortcut(input)) event.preventDefault()
      })
      win.on('leave-full-screen', () => {
        if (!win.isDestroyed()) win.setFullScreen(true)
      })
      void win.loadURL(overlayDataUrl(title, body))
      return win as unknown as BlockingOverlayWindow
    },
  },
  { setTimeout, clearTimeout },
  (armed) => {
    applyArmedChrome(windowRef, armed)
    if (armed) noteBlockingOverlayArmed(autoUpdater)
  },
)

function guardMainWindow(win: BrowserWindow): void {
  applyArmedChrome(win, blockingOverlay.armed)
  win.on('close', (event) => {
    if (!allowLifecycleRequest(blockingOverlay.armed)) event.preventDefault()
  })
  win.on('minimize', () => {
    if (!allowLifecycleRequest(blockingOverlay.armed) && !win.isDestroyed() && win.isMinimized()) {
      win.restore()
    }
  })
  win.on('enter-full-screen', () => {
    if (!allowLifecycleRequest(blockingOverlay.armed) && !win.isDestroyed()) win.setFullScreen(false)
  })
  win.webContents.on('before-input-event', (event, input) => {
    if (!allowLifecycleRequest(blockingOverlay.armed) && shouldBlockShortcut(input)) event.preventDefault()
  })
  win.webContents.on('will-navigate', (event) => {
    if (!shouldAllowRendererNavigation(blockingOverlay.armed, hostFailed)) event.preventDefault()
  })
}

function electronAuthFactory(): AuthWindowFactory {
  return {
    create({ width, height }) {
      return new BrowserWindow({
        width,
        height,
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          partition: `temp:auth-window-${crypto.randomUUID()}`,
        },
      })
    },
  }
}

function runOpenAuthWindow(raw: unknown): Promise<{ callbackUrl: string } | { canceled: true }> {
  if (raw === null || typeof raw !== 'object') return Promise.resolve({ canceled: true })
  const record = raw as Record<string, unknown>
  if (typeof record.url !== 'string' || record.url === '') return Promise.resolve({ canceled: true })
  if (typeof record.callbackUrlPrefix !== 'string' || record.callbackUrlPrefix === '') {
    return Promise.resolve({ canceled: true })
  }
  const options: OpenAuthWindowOptions = {
    url: record.url,
    callbackUrlPrefix: record.callbackUrlPrefix,
    ...typeof record.width === 'number' ? { width: record.width } : {},
    ...typeof record.height === 'number' ? { height: record.height } : {},
    ...typeof record.timeoutMs === 'number' ? { timeoutMs: record.timeoutMs } : {},
  }
  return openAuthWindow(options, electronAuthFactory())
}

/**
 * Load the error page into the current window after a Host crash.
 * @param detail - short reason.
 */
function showHostError(detail: string): void {
  const target = windowRef
  if (target === undefined || target.isDestroyed()) return
  void target.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(hostErrorPage(detail))}`).then(() => {
    if (!target.isDestroyed()) target.webContents.clearHistory()
  }).catch((error: unknown) => {
    appendDesktopLog(`showHostError failed ${summarizeDesktopFailure(error)}`)
  })
}

/** Disarm overlay/quit guards and freeze the window on a terminal Host-failure page. */
function enterHostFailure(detail: string): void {
  if (hostFailed) return
  hostFailed = true
  blockingOverlay.disarm('host-dead')
  showHostError(summarizeDesktopFailure(detail))
}

function registerProtocol(distRoot: string): void {
  if (protocolRegistered) return
  protocolRegistered = true
  protocol.handle('dsh', async (request) => {
    if (isDesktopSessionExportPath(request.url)) {
      return sessionExportProtocolResponse(request)
    }
    const file = fileFromDshUrl(request.url, distRoot)
    if (file === undefined) return new Response('not found', { status: 404 })
    try {
      const body = await readFile(file)
      return new Response(body, {
        headers: { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' },
      })
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

function rearmAfterFailedInstall(): void {
  const copy = blockingOverlay.failedInstallOverlay
  if (copy === undefined) return
  blockingOverlay.arm({
    id: crypto.randomUUID(),
    timeoutMs: 1,
    title: copy.title,
    body: copy.body,
    failedInstallTitle: copy.title,
    failedInstallBody: copy.body,
  })
}

function wireIpc(child: DesktopHostChild): void {
  ipcMain.removeAllListeners('dsh-rpc')
  ipcMain.removeHandler('dsh-boot-graph')
  ipcMain.removeHandler('dsh-read-plugin')
  ipcMain.removeHandler('dsh-open-auth-window')
  ipcMain.on('dsh-rpc', (_event, payload: unknown) => { child.postRpc(payload) })
  ipcMain.handle('dsh-boot-graph', () => child.bootGraph())
  ipcMain.handle('dsh-read-plugin', (_event, id: unknown) => {
    if (typeof id !== 'string' || id === '') throw new Error('desktop: plugin id required')
    return child.readPlugin(id)
  })
  ipcMain.handle('dsh-open-auth-window', (_event, options: unknown) => runOpenAuthWindow(options))
}

/**
 * Answer GET/HEAD `/api/session.export` from the Host child, not the frontend dist.
 * @param request - privileged `dsh:` request from the renderer.
 * @returns the Host download Response, or 405/503 when the method or child is wrong.
 */
async function sessionExportProtocolResponse(request: Request): Promise<Response> {
  const query = sessionExportFromDshUrl(request.url, request.method)
  if (query === undefined) return new Response('method not allowed', { status: 405 })
  if (host === undefined) return new Response('host unavailable', { status: 503 })
  try {
    return await responseFromSessionExport(await host.sessionExport(query))
  } catch (error: unknown) {
    return new Response(error instanceof Error ? error.message : String(error), { status: 500 })
  }
}

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    ...SHELL_ICON === undefined ? {} : { icon: SHELL_ICON },
    webPreferences: {
      preload: fileURLToPath(new URL('./preload.js', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  guardMainWindow(win)
  blockingOverlay.attachParent(win)
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(hostStartingPage())}`)
  return win
}

async function createWindow(): Promise<void> {
  windowRef = createMainWindow()
  const win = windowRef
  try {
    appendDesktopLog(
      `start electron=${process.versions.electron} execPath=${process.execPath} resourcesPath=${process.resourcesPath ?? ''}`,
    )
    if (app.isPackaged) {
      const templateRoot = resolveBundledProfileTemplate()
      if (templateRoot !== undefined) ensureProfileFromTemplate({ templateRoot })
    }
    const distRoot = resolveFrontendDist()
    registerProtocol(distRoot)
    if (host === undefined) {
      host = spawnDesktopHost({
        openAuthWindow: options => openAuthWindow(options, electronAuthFactory()),
        blockingOverlay,
        checkForUpdates: (feedUrl) => {
          void startDesktopAutoUpdate({
            isPackaged: app.isPackaged,
            updater: autoUpdater,
            appVersion: app.getVersion(),
            feedUrl,
            isArmed: () => blockingOverlay.armed,
            disarmForUpdateInstall: () => blockingOverlay.disarm('update-install'),
            rearmAfterFailedInstall,
          })
        },
        openPathAndQuit: path => openPathAndQuit(path, {
          platform: process.platform,
          spawn,
          openPath: target => shell.openPath(target),
          quit: () => {
            blockingOverlay.disarm('update-install')
            app.quit()
          },
        }),
        openExternal: url => openHttpsExternal(url, target => shell.openExternal(target)),
        onFatal: (detail) => { enterHostFailure(detail) },
        hostLogPath: join(app.getPath('userData'), 'logs', 'desktop-host.log'),
      })
    }
    const child = host
    await child.awaitReady()
    child.subscribeRpc((payload) => {
      if (!win.isDestroyed()) win.webContents.send('dsh-rpc', payload)
    })
    child.onExit(() => {
      if (!disposing) enterHostFailure(child.crash?.message ?? 'Host child exited')
    })
    wireIpc(child)
    win.webContents.session.on('will-download', (_event, item) => {
      const filename = item.getFilename()
      if (filename !== '') item.setSaveDialogOptions({ defaultPath: filename })
    })
    await win.loadURL('dsh://app/')
  } catch (error) {
    const detail = summarizeDesktopFailure(error)
    appendDesktopLog(`createWindow failed ${detail}`)
    enterHostFailure(detail)
  }
}

async function disposeHost(): Promise<void> {
  if (disposing) return
  disposing = true
  ipcMain.removeHandler('dsh-boot-graph')
  ipcMain.removeHandler('dsh-read-plugin')
  ipcMain.removeHandler('dsh-open-auth-window')
  ipcMain.removeAllListeners('dsh-rpc')
  await host?.dispose()
}

void app.whenReady().then(() => {
  if (!app.isPackaged && process.platform === 'darwin' && SHELL_ICON !== undefined) {
    app.dock?.setIcon(SHELL_ICON)
  }
  onBeforeQuitForUpdate(autoUpdater, () => {
    blockingOverlay.disarm('update-install')
  })
  void createWindow().catch((error: unknown) => {
    const detail = summarizeDesktopFailure(error)
    appendDesktopLog(`createWindow rejected ${detail}`)
    enterHostFailure(detail)
  })
  app.on('activate', () => {
    if (!shouldRespawnHostOnActivate(hostFailed)) return
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow().catch((error: unknown) => {
        const detail = summarizeDesktopFailure(error)
        appendDesktopLog(`createWindow rejected ${detail}`)
        enterHostFailure(detail)
      })
    }
  })
})

app.on('window-all-closed', () => {
  if (shouldQuitWhenLastWindowClosed(hostFailed, process.platform)) app.quit()
})

app.on('before-quit', (event) => {
  if (shouldBlockAppQuit(blockingOverlay.armed)) {
    event.preventDefault()
    return
  }
  if (disposing) return
  event.preventDefault()
  void disposeHost().finally(() => { app.quit() })
})
