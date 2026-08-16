import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import {
  matchesCallbackPrefix,
  openAuthWindow,
  type AuthWindowFactory,
  type AuthWindowHandle,
  type AuthWebContents,
} from '../src/auth-window.ts'

class FakeWebContents extends EventEmitter implements AuthWebContents {
  setWindowOpenHandler(): void {}
}

class FakeWindow extends EventEmitter implements AuthWindowHandle {
  destroyed = false
  webContents = new FakeWebContents()
  loadURL(): Promise<void> { return Promise.resolve() }
  close(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.emit('closed')
  }
  isDestroyed(): boolean { return this.destroyed }
}

describe('generic auth window', () => {
  it('returns canceled when the user closes the window, without throwing', async () => {
    const win = new FakeWindow()
    const factory: AuthWindowFactory = { create: () => win }
    const pending = openAuthWindow(
      { url: 'https://example.com/login', callbackUrlPrefix: 'https://example.com/cb' },
      factory,
    )
    win.close()
    await expect(pending).resolves.toEqual({ canceled: true })
  })

  it('returns the callback URL for any third-party prefix', async () => {
    const win = new FakeWindow()
    const pending = openAuthWindow(
      { url: 'https://idp.example/authorize', callbackUrlPrefix: 'https://app.example/oauth/cb' },
      { create: () => win },
    )
    win.webContents.emit('will-redirect', {}, 'https://app.example/oauth/cb?code=abc')
    await expect(pending).resolves.toEqual({ callbackUrl: 'https://app.example/oauth/cb?code=abc' })
  })

  it('times out as canceled', async () => {
    const win = new FakeWindow()
    await expect(openAuthWindow(
      { url: 'https://example.com/login', callbackUrlPrefix: 'https://example.com/cb', timeoutMs: 20 },
      { create: () => win },
    )).resolves.toEqual({ canceled: true })
  })

  it('closes allowed window.open children when the auth flow finishes', async () => {
    const win = new FakeWindow()
    const child = new FakeWindow()
    const pending = openAuthWindow(
      { url: 'https://idp.example/authorize', callbackUrlPrefix: 'https://app.example/oauth/cb' },
      { create: () => win },
    )
    win.webContents.emit('did-create-window', child)
    win.webContents.emit('will-redirect', {}, 'https://app.example/oauth/cb?code=1')
    await expect(pending).resolves.toEqual({ callbackUrl: 'https://app.example/oauth/cb?code=1' })
    expect(child.isDestroyed()).toBe(true)
  })

  it('prefix match is startsWith, not substring', () => {
    expect(matchesCallbackPrefix('https://example.com/cb?x=1', 'https://example.com/cb')).toBe(true)
    expect(matchesCallbackPrefix('https://evil.example/https://example.com/cb', 'https://example.com/cb')).toBe(false)
  })
})
