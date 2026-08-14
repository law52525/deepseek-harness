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
    expect(parseDesktopControl({ type: 'unknown' })).toBeUndefined()
    expect(parseDesktopControl(undefined)).toBeUndefined()
  })

  it('recognizes built-in theme preferences only', () => {
    expect(isDesktopThemePreference('system')).toBe(true)
    expect(isDesktopThemePreference('light')).toBe(true)
    expect(isDesktopThemePreference('dark')).toBe(true)
    expect(isDesktopThemePreference('sepia')).toBe(false)
  })
})
