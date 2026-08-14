/**
 * Renderer preload: expose a structured IpcPort and the desktop control face.
 * No general `ipcRenderer.send` of arbitrary channels from the page.
 */

import { contextBridge, ipcRenderer } from 'electron'
import type { IpcMessage, IpcPort } from '@deepseek-ai/dsh-host-apiproxy/client'

const port: IpcPort = {
  post(message: IpcMessage) {
    ipcRenderer.send('dsh-rpc', message)
  },
  subscribe(handler) {
    const listener = (_event: unknown, message: IpcMessage): void => { handler(message) }
    ipcRenderer.on('dsh-rpc', listener)
    return () => { ipcRenderer.removeListener('dsh-rpc', listener) }
  },
}

contextBridge.exposeInMainWorld('__DSH_IPC_PORT__', port)
contextBridge.exposeInMainWorld('__DSH_DESKTOP__', {
  bootGraph: () => ipcRenderer.invoke('dsh-boot-graph'),
  readPlugin: (id: string) => ipcRenderer.invoke('dsh-read-plugin', id),
})
