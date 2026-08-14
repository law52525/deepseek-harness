/**
 * Electron main: spawn the desktop Host child, serve dsh-web-frontend dist
 * over `dsh://app`, and forward opaque RPC. HostIpcGateway stays in the child.
 */

import { readFile } from 'node:fs/promises'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, ipcMain, protocol } from 'electron'
import { autoUpdater } from 'electron-updater'
import { startDesktopAutoUpdate } from './auto-update.ts'
import { fileFromDshUrl } from './dsh-protocol.ts'
import { hostErrorPage } from './error-page.ts'
import { resolveFrontendDist } from './frontend-dist.ts'
import { spawnDesktopHost, type DesktopHostChild } from './host-child.ts'

protocol.registerSchemesAsPrivileged([
  { scheme: 'dsh', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])

const SHELL_ICON = fileURLToPath(new URL('../resources/icon.png', import.meta.url))

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

/**
 * Load the error page into the current window after a Host crash.
 * @param detail - short reason.
 */
function showHostError(detail: string): void {
  const target = windowRef
  if (target === undefined || target.isDestroyed()) return
  void target.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(hostErrorPage(detail))}`)
}

function registerProtocol(distRoot: string): void {
  if (protocolRegistered) return
  protocolRegistered = true
  protocol.handle('dsh', async (request) => {
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

function wireIpc(child: DesktopHostChild): void {
  ipcMain.removeAllListeners('dsh-rpc')
  ipcMain.removeHandler('dsh-boot-graph')
  ipcMain.removeHandler('dsh-read-plugin')
  ipcMain.on('dsh-rpc', (_event, payload: unknown) => { child.postRpc(payload) })
  ipcMain.handle('dsh-boot-graph', () => child.bootGraph())
  ipcMain.handle('dsh-read-plugin', (_event, id: unknown) => {
    if (typeof id !== 'string' || id === '') throw new Error('desktop: plugin id required')
    return child.readPlugin(id)
  })
}

async function createWindow(): Promise<void> {
  const distRoot = resolveFrontendDist()
  registerProtocol(distRoot)
  if (host === undefined) host = spawnDesktopHost()
  const child = host
  try {
    await child.awaitReady()
  } catch (error) {
    windowRef = new BrowserWindow({
      width: 1280,
      height: 800,
      icon: SHELL_ICON,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false },
    })
    showHostError(error instanceof Error ? error.message : String(error))
    return
  }

  windowRef = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: SHELL_ICON,
    webPreferences: {
      preload: fileURLToPath(new URL('./preload.js', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  const win = windowRef
  child.subscribeRpc((payload) => {
    if (!win.isDestroyed()) win.webContents.send('dsh-rpc', payload)
  })
  child.onExit(() => {
    if (!disposing) showHostError(child.crash?.message ?? 'Host child exited')
  })
  wireIpc(child)
  await win.loadURL('dsh://app/')
}

async function disposeHost(): Promise<void> {
  if (disposing) return
  disposing = true
  ipcMain.removeHandler('dsh-boot-graph')
  ipcMain.removeHandler('dsh-read-plugin')
  ipcMain.removeAllListeners('dsh-rpc')
  await host?.dispose()
}

void app.whenReady().then(() => {
  if (!app.isPackaged && process.platform === 'darwin') app.dock?.setIcon(SHELL_ICON)
  void createWindow()
  void startDesktopAutoUpdate({
    isPackaged: app.isPackaged,
    updater: autoUpdater,
    appVersion: app.getVersion(),
  })
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (disposing) return
  event.preventDefault()
  void disposeHost().finally(() => { app.quit() })
})
