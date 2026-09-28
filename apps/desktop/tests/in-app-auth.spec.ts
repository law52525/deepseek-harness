import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { DesktopInAppAuthConfig } from '../src/product-config.ts'

const electron = vi.hoisted(() => ({
  fromPartition: vi.fn(() => ({ id: 'partition' })),
}))
vi.mock('electron', () => ({
  BrowserWindow: class {
    readonly kind = 'browser-window'
  },
  session: { fromPartition: electron.fromPartition },
}))

const {
  authorizeUrlUsesInAppWindow,
  inAppAuthForwardUrl,
  inAppAuthWindowOptions,
  isInAppAuthCallback,
  openInAppAuthWindow,
} = await import('../src/in-app-auth.ts')

const CONFIG: DesktopInAppAuthConfig = {
  origins: ['https://sso.example.test'],
  callbackPrefix: 'https://sso.example.test/dingtalk-redirect',
  forwardPath: '/auth/callback',
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('in-app authorization matching', () => {
  it('opens allow-listed https origins in-app and leaves others to the system browser', () => {
    expect(authorizeUrlUsesInAppWindow('https://sso.example.test/login?x=1', CONFIG)).toBe(true)
    expect(authorizeUrlUsesInAppWindow('https://other.example.test/login', CONFIG)).toBe(false)
    expect(authorizeUrlUsesInAppWindow('http://sso.example.test/login', CONFIG)).toBe(false)
  })

  it('forwards only the original query string to the Host loopback path', () => {
    const callback = 'https://sso.example.test/dingtalk-redirect?code=abc&state=xyz'
    expect(isInAppAuthCallback(callback, CONFIG)).toBe(true)
    expect(isInAppAuthCallback('http://127.0.0.1:8080/sso/callback?sso_token=no', CONFIG)).toBe(false)
    expect(inAppAuthForwardUrl('http://localhost:19387/', CONFIG.forwardPath, callback))
      .toBe('http://127.0.0.1:19387/auth/callback?code=abc&state=xyz')
  })

  it('keeps the guest sandboxed, isolated, and without a preload', () => {
    const parent = {} as BrowserWindow
    const options = inAppAuthWindowOptions(parent, 'dsh-in-app-auth:attempt-1')
    expect(options.parent).toBe(parent)
    expect(options.modal).toBe(true)
    expect(options.webPreferences).toMatchObject({
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    })
    expect(options.webPreferences?.preload).toBeUndefined()
    expect(electron.fromPartition).toHaveBeenCalledWith('dsh-in-app-auth:attempt-1', { cache: false })
  })
})

describe('in-app authorization window', () => {
  class FakeWindow extends EventEmitter {
    destroyed = false
    readonly webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(),
      stop: vi.fn(),
    })
    loadURL = vi.fn(async () => undefined)
    close = vi.fn(() => {
      this.destroyed = true
      this.emit('closed')
    })
    isDestroyed = () => this.destroyed
  }

  it('forwards a matching redirect to Host and does not cancel the attempt', async () => {
    const window = new FakeWindow()
    const fetch = vi.fn(async () => ({ ok: true }))
    const onCancel = vi.fn()
    openInAppAuthWindow({
      parent: {} as BrowserWindow,
      authorizeUrl: 'https://sso.example.test/login',
      attemptId: 'attempt-1',
      hostUrl: 'http://127.0.0.1:19387/',
      config: CONFIG,
      fetch,
      onCancel,
      createWindow: () => window as unknown as BrowserWindow,
    })
    expect(window.webContents.setWindowOpenHandler.mock.calls[0]![0]!()).toEqual({ action: 'deny' })
    const event = { preventDefault: vi.fn() }
    window.webContents.emit('will-redirect', event, 'https://sso.example.test/dingtalk-redirect?code=c1&state=s1')
    expect(event.preventDefault).toHaveBeenCalledOnce()
    await vi.waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:19387/auth/callback?code=c1&state=s1',
        { method: 'GET' },
      )
      expect(window.close).toHaveBeenCalled()
    })
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('cancels the attempt when the user closes the window', () => {
    const window = new FakeWindow()
    const onCancel = vi.fn()
    openInAppAuthWindow({
      parent: {} as BrowserWindow,
      authorizeUrl: 'https://sso.example.test/login',
      attemptId: 'attempt-2',
      hostUrl: 'http://127.0.0.1:19387/',
      config: CONFIG,
      fetch: async () => undefined,
      onCancel,
      createWindow: () => window as unknown as BrowserWindow,
    })
    window.close()
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
