/** Process-IPC envelope parse: RPC payloads stay opaque; control documents are typed. */

import { describe, expect, it } from 'vitest'
import {
  isDesktopThemePreference,
  parseDesktopControl,
  parseDesktopEnvelope,
} from '../src/ipc-protocol.ts'

describe('desktop IPC protocol', () => {
  it('forwards rpc payloads without inspecting them', () => {
    const payload = { type: 'unary-request', body: '{"raw":true}' }
    expect(parseDesktopEnvelope({ channel: 'rpc', payload })).toEqual({ channel: 'rpc', payload })
    expect(parseDesktopEnvelope({ channel: 'rpc', payload: 'not-an-object' })).toEqual({
      channel: 'rpc',
      payload: 'not-an-object',
    })
  })

  it('accepts every control document and rejects malformed ones', () => {
    expect(parseDesktopEnvelope({ channel: 'control', payload: { type: 'host-ready' } }))
      .toEqual({ channel: 'control', payload: { type: 'host-ready' } })
    expect(parseDesktopControl({ type: 'boot-graph-request', id: '1' }))
      .toEqual({ type: 'boot-graph-request', id: '1' })
    expect(parseDesktopControl({
      type: 'boot-graph-response',
      id: '1',
      graph: { rev: 'r', entries: [] },
      themePreference: 'dark',
    })).toMatchObject({ type: 'boot-graph-response', themePreference: 'dark' })
    expect(parseDesktopControl({ type: 'plugin-bytes-request', id: '1', pluginId: '@p/x' }))
      .toEqual({ type: 'plugin-bytes-request', id: '1', pluginId: '@p/x' })
    expect(parseDesktopControl({ type: 'plugin-bytes-response', id: '1', bytes: 'code' }))
      .toEqual({ type: 'plugin-bytes-response', id: '1', bytes: 'code' })
    expect(parseDesktopControl({ type: 'plugin-bytes-failure', id: '1', message: 'missing' }))
      .toEqual({ type: 'plugin-bytes-failure', id: '1', message: 'missing' })
    expect(parseDesktopControl({
      type: 'session-export-request',
      id: '1',
      method: 'GET',
      sessionId: 'session-root',
      includeDescendants: true,
    })).toEqual({
      type: 'session-export-request',
      id: '1',
      method: 'GET',
      sessionId: 'session-root',
      includeDescendants: true,
    })
    expect(parseDesktopControl({
      type: 'session-export-request',
      id: '1',
      method: 'HEAD',
      sessionId: '',
      includeDescendants: false,
    })).toEqual({
      type: 'session-export-request',
      id: '1',
      method: 'HEAD',
      sessionId: '',
      includeDescendants: false,
    })
    expect(parseDesktopControl({
      type: 'session-export-response',
      id: '1',
      status: 200,
      headers: null,
    })).toBeUndefined()
    expect(parseDesktopControl({
      type: 'session-export-response',
      id: '1',
      status: 200,
      headers: { 'content-type': 'application/zip' },
      bodyPath: '/tmp/dsh-session-export-1.zip',
    })).toMatchObject({ type: 'session-export-response', status: 200, bodyPath: '/tmp/dsh-session-export-1.zip' })
    expect(parseDesktopControl({
      type: 'session-export-response',
      id: '1',
      status: 404,
      headers: {},
    })).toEqual({ type: 'session-export-response', id: '1', status: 404, headers: {} })
    expect(parseDesktopControl({ type: 'session-export-failure', id: '1', message: 'boom' }))
      .toEqual({ type: 'session-export-failure', id: '1', message: 'boom' })

    expect(parseDesktopEnvelope(null)).toBeUndefined()
    expect(parseDesktopEnvelope('rpc')).toBeUndefined()
    expect(parseDesktopEnvelope({ channel: 'other' })).toBeUndefined()
    expect(parseDesktopEnvelope({ channel: 'control', payload: null })).toBeUndefined()
    expect(parseDesktopControl({ type: 'boot-graph-request', id: '' })).toBeUndefined()
    expect(parseDesktopControl({ type: 'boot-graph-response', id: '1', graph: null, themePreference: 'dark' }))
      .toBeUndefined()
    expect(parseDesktopControl({ type: 'boot-graph-response', id: '1', graph: {}, themePreference: 'dark' }))
      .toBeUndefined()
    expect(parseDesktopControl({
      type: 'boot-graph-response',
      id: '1',
      graph: { rev: 'r', entries: [] },
      themePreference: 'sepia',
    })).toBeUndefined()
    expect(parseDesktopControl({ type: 'plugin-bytes-request', id: '1', pluginId: '' })).toBeUndefined()
    expect(parseDesktopControl({ type: 'plugin-bytes-response', id: '1' })).toBeUndefined()
    expect(parseDesktopControl({ type: 'plugin-bytes-failure', id: '1' })).toBeUndefined()
    expect(parseDesktopControl({
      type: 'session-export-request',
      id: '1',
      method: 'POST',
      sessionId: 's',
      includeDescendants: true,
    })).toBeUndefined()
    expect(parseDesktopControl({
      type: 'session-export-request',
      id: '',
      method: 'GET',
      sessionId: 's',
      includeDescendants: true,
    })).toBeUndefined()
    expect(parseDesktopControl({
      type: 'session-export-request',
      id: '1',
      method: 'GET',
      sessionId: 1,
      includeDescendants: true,
    })).toBeUndefined()
    expect(parseDesktopControl({
      type: 'session-export-response',
      id: '1',
      status: '200',
      headers: {},
    })).toBeUndefined()
    expect(parseDesktopControl({
      type: 'session-export-response',
      id: '1',
      status: 200,
      headers: { n: 1 },
    })).toBeUndefined()
    expect(parseDesktopControl({
      type: 'session-export-response',
      id: '1',
      status: 200,
      headers: [],
    })).toBeUndefined()
    expect(parseDesktopControl({
      type: 'session-export-response',
      id: '1',
      status: 200,
      headers: {},
      bodyPath: 1,
    })).toBeUndefined()
    expect(parseDesktopControl({ type: 'session-export-failure', id: '1' })).toBeUndefined()
    expect(parseDesktopControl({ type: 'unknown' })).toBeUndefined()
    expect(parseDesktopControl(undefined)).toBeUndefined()
  })

  it('parses generic open-auth-window shell documents', () => {
    expect(parseDesktopEnvelope({
      channel: 'shell',
      payload: { type: 'open-auth-window', id: '1', url: 'https://example.com/login', callbackUrlPrefix: 'https://example.com/cb' },
    })).toEqual({
      channel: 'shell',
      payload: { type: 'open-auth-window', id: '1', url: 'https://example.com/login', callbackUrlPrefix: 'https://example.com/cb' },
    })
    expect(parseDesktopEnvelope({
      channel: 'shell',
      payload: { type: 'open-auth-window-result', id: '1', canceled: true },
    })).toMatchObject({ channel: 'shell', payload: { type: 'open-auth-window-result', canceled: true } })
    expect(parseDesktopEnvelope({
      channel: 'shell',
      payload: { type: 'open-auth-window', id: '1', url: '', callbackUrlPrefix: 'https://x' },
    })).toBeUndefined()
    expect(parseDesktopEnvelope({
      channel: 'shell',
      payload: { type: 'arm-blocking-overlay', id: 'g1', timeoutMs: 10_000, title: 'Update', body: 'Please update' },
    })).toEqual({
      channel: 'shell',
      payload: { type: 'arm-blocking-overlay', id: 'g1', timeoutMs: 10_000, title: 'Update', body: 'Please update' },
    })
    expect(parseDesktopEnvelope({
      channel: 'shell',
      payload: {
        type: 'arm-blocking-overlay',
        id: 'g1',
        timeoutMs: 10_000,
        title: 'Update',
        body: 'Please update',
        failedInstallTitle: 'install failed',
        failedInstallBody: 'reinstall',
      },
    })).toEqual({
      channel: 'shell',
      payload: {
        type: 'arm-blocking-overlay',
        id: 'g1',
        timeoutMs: 10_000,
        title: 'Update',
        body: 'Please update',
        failedInstallTitle: 'install failed',
        failedInstallBody: 'reinstall',
      },
    })
    expect(parseDesktopEnvelope({
      channel: 'shell',
      payload: { type: 'overlay-rendered', id: 'g1' },
    })).toMatchObject({ channel: 'shell', payload: { type: 'overlay-rendered', id: 'g1' } })
    expect(parseDesktopEnvelope({
      channel: 'shell',
      payload: { type: 'check-for-updates', id: 'g1', feedUrl: 'https://example.invalid/v2' },
    })).toMatchObject({ channel: 'shell', payload: { type: 'check-for-updates', feedUrl: 'https://example.invalid/v2' } })
    expect(parseDesktopEnvelope({
      channel: 'shell',
      payload: { type: 'arm-blocking-overlay', id: 'g1', timeoutMs: 10_000 },
    })).toBeUndefined()
    expect(parseDesktopEnvelope({
      channel: 'shell',
      payload: { type: 'blocking-overlay-fatal', id: 'g1', detail: 'unable to arm overlay' },
    })).toMatchObject({ channel: 'shell', payload: { type: 'blocking-overlay-fatal', detail: 'unable to arm overlay' } })
    expect(parseDesktopEnvelope({
      channel: 'shell',
      payload: { type: 'open-path-and-quit', id: '1', path: '/tmp/Setup.exe' },
    })).toEqual({
      channel: 'shell',
      payload: { type: 'open-path-and-quit', id: '1', path: '/tmp/Setup.exe' },
    })
    expect(parseDesktopEnvelope({
      channel: 'shell',
      payload: { type: 'open-path-result', id: '1', ok: false, detail: 'failed to open' },
    })).toEqual({
      channel: 'shell',
      payload: { type: 'open-path-result', id: '1', ok: false, detail: 'failed to open' },
    })
    expect(parseDesktopEnvelope({
      channel: 'shell',
      payload: { type: 'open-external', id: '1', url: 'https://example.com/' },
    })).toEqual({
      channel: 'shell',
      payload: { type: 'open-external', id: '1', url: 'https://example.com/' },
    })
    expect(parseDesktopEnvelope({
      channel: 'shell',
      payload: { type: 'open-external-result', id: '1', ok: false, detail: 'only https:' },
    })).toMatchObject({ channel: 'shell', payload: { ok: false, detail: 'only https:' } })
    expect(parseDesktopEnvelope({
      channel: 'shell',
      payload: { type: 'open-path-and-quit', id: '1', path: '' },
    })).toBeUndefined()
  })

  it('recognizes built-in theme preferences only', () => {
    expect(isDesktopThemePreference('system')).toBe(true)
    expect(isDesktopThemePreference('light')).toBe(true)
    expect(isDesktopThemePreference('dark')).toBe(true)
    expect(isDesktopThemePreference('sepia')).toBe(false)
  })
})
