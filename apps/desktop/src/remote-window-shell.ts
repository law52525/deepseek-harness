import { randomUUID } from 'node:crypto'
/** Fixed IPC vocabulary for the owned Host child; no renderer or arbitrary RPC exposure. */
import { BrowserWindow, dialog, powerMonitor } from 'electron'
import { RemoteWindowController } from './remote-window.ts'

export function createRemoteWindowShell(getWindow: () => BrowserWindow | undefined) {
  let disposed = false
  let sendToHost: ((value: object) => void) | undefined
  const accounts = new Map<string, (epoch: string | undefined) => void>()
  const controller = new RemoteWindowController({
    getWindow,
    account: () => new Promise((resolve) => {
      if (!sendToHost) { resolve(undefined); return }
      const id = randomUUID(), timer = setTimeout(() => { accounts.delete(id); resolve(undefined) }, 1000)
      accounts.set(id, (epoch) => { clearTimeout(timer); accounts.delete(id); resolve(epoch) })
      sendToHost({ channel: 'remote-window-account', payload: { id, query: true } })
    }),
    confirm: async (window, seconds) => {
      const result = await dialog.showMessageBox(window, { type: 'warning', title: 'Work 窗口远程控制',
        message: '允许已配对手机查看并操作这个 Work 窗口？',
        detail: `手机可查看窗口内的会话历史及可见内容，并点击、滚动和输入，包括 Work 内的审批界面。有效 ${String(Math.floor(seconds / 60))} 分钟。原生审批仍需本人确认。只共享 Work 内容区，不控制其他应用。关闭远程状态窗口即可停止。`,
        buttons: ['取消', '允许本次窗口控制'], defaultId: 0, cancelId: 0 })
      return result.response === 1
    },
    indicator: (stop, until) => {
      const window = new BrowserWindow({ width: 380, height: 155, title: 'Work 远程控制已开启', resizable: false, minimizable: false, show: false,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', event => event.preventDefault())
      const content = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>body{font:16px system-ui;padding:12px}</style><b>手机正在控制 Work 窗口</b><p>关闭此状态窗口立即停止。</p><small>截止时间：${new Date(until).toLocaleTimeString()}</small>`
      void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(content)}`).then(() => { if (!window.isDestroyed()) window.showInactive() }).catch(stop)
      window.once('closed', stop)
      return () => { window.removeListener('closed', stop); if (!window.isDestroyed()) window.destroy() }
    },
  })
  const lock = (): void => { controller.setLocked(true) }
  const unlock = (): void => { controller.setLocked(false) }
  powerMonitor.on('lock-screen', lock); powerMonitor.on('suspend', lock)
  powerMonitor.on('unlock-screen', unlock); powerMonitor.on('resume', unlock)
  const timer = setInterval(() => controller.sweep(), 1000); timer.unref()
  return {
    dispose: () => { disposed = true; sendToHost = undefined; clearInterval(timer); controller.close(); for (const resolve of accounts.values()) resolve(undefined); accounts.clear(); powerMonitor.removeListener('lock-screen', lock); powerMonitor.removeListener('suspend', lock); powerMonitor.removeListener('unlock-screen', unlock); powerMonitor.removeListener('resume', unlock) },
    handle(message: unknown, reply: (value: object) => void): boolean {
      if (!message || typeof message !== 'object') return false
      const m = message as Record<string, unknown>
      if (disposed && (m.channel === 'remote-window' || m.channel === 'remote-window-account')) {
        const q = m.payload && typeof m.payload === 'object' ? m.payload as Record<string, unknown> : undefined
        if (m.channel === 'remote-window' && typeof q?.id === 'string') reply({ channel: 'remote-window', payload: { id: q.id, ok: false, code: 'DISPOSED' } })
        return true
      }
      if (m.channel === 'remote-window-account' && m.payload && typeof m.payload === 'object') {
        const value = m.payload as Record<string, unknown>
        if (value.changed === true) controller.close()
        else if (typeof value.id === 'string') accounts.get(value.id)?.(typeof value.epoch === 'string' ? value.epoch : undefined)
        return true
      }
      if (m.channel !== 'remote-window' || !m.payload || typeof m.payload !== 'object') return false
      const q = m.payload as Record<string, unknown>
      if (typeof q.id !== 'string' || q.id.length > 100) return false
      sendToHost = reply
      const id = q.id
      void controller.request(q).then(result => reply({ channel: 'remote-window', payload: { id, ok: true, result } }), error => reply({ channel: 'remote-window', payload: { id, ok: false, code: error instanceof Error ? error.message : 'FAILED' } }))
      return true
    },
  }
}
