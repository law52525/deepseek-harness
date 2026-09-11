/** Custom protocol mapping stays inside the frontend dist directory. */

import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileFromDshUrl, isDesktopSessionExportPath, sessionExportFromDshUrl } from '../src/dsh-protocol.ts'
import { hostErrorPage, summarizeDesktopFailure } from '../src/error-page.ts'

describe('dsh protocol and error page', () => {
  it('maps dsh://app paths onto dist and rejects escapes', () => {
    const dist = join('/tmp', 'dsh-frontend-dist')
    expect(fileFromDshUrl('dsh://app/', dist)).toBe(join(dist, 'index.html'))
    expect(fileFromDshUrl('dsh://app/assets/index.js', dist)).toBe(join(dist, 'assets', 'index.js'))
    expect(fileFromDshUrl('dsh://app/api/session.export', dist)).toBe(join(dist, 'api/session.export'))
    expect(fileFromDshUrl('dsh://app/%2e%2e%2fsecret', dist)).toBeUndefined()
    expect(fileFromDshUrl('dsh://other/index.html', dist)).toBeUndefined()
    expect(fileFromDshUrl('http://app/', dist)).toBeUndefined()
    expect(fileFromDshUrl('not a url', dist)).toBeUndefined()
  })

  it('recognizes Session-export URLs without treating them as dist files', () => {
    expect(isDesktopSessionExportPath('dsh://app/api/session.export?sessionId=s')).toBe(true)
    expect(isDesktopSessionExportPath('dsh://app/api/session.export')).toBe(true)
    expect(isDesktopSessionExportPath('dsh://app/assets/index.js')).toBe(false)
    expect(isDesktopSessionExportPath('not a url')).toBe(false)
    expect(sessionExportFromDshUrl(
      'dsh://app/api/session.export?sessionId=s1&includeDescendants=true',
      'HEAD',
    )).toEqual({ method: 'HEAD', sessionId: 's1', includeDescendants: true })
    expect(sessionExportFromDshUrl(
      'dsh://app/api/session.export?sessionId=s1&includeDescendants=false',
      'GET',
    )).toEqual({ method: 'GET', sessionId: 's1', includeDescendants: false })
    expect(sessionExportFromDshUrl('dsh://app/api/session.export', 'GET'))
      .toEqual({ method: 'GET', sessionId: '', includeDescendants: false })
    expect(sessionExportFromDshUrl('dsh://app/api/session.export?sessionId=s', 'POST')).toBeUndefined()
    expect(sessionExportFromDshUrl('dsh://app/assets/index.js', 'GET')).toBeUndefined()
    expect(sessionExportFromDshUrl('not a url', 'GET')).toBeUndefined()
  })

  it('escapes operator-facing crash text', () => {
    expect(hostErrorPage('<script>alert(1)</script>')).toContain('&lt;script&gt;')
    expect(hostErrorPage('Host process stopped')).toContain('Host process stopped')
  })

  it('does not nest a failed data: error page into another data: URL', () => {
    const nested = `Error: ERR_FAILED (-2) loading 'data:text/html;charset=utf-8,${'A'.repeat(8000)}'`
    const summarized = summarizeDesktopFailure(nested)
    expect(summarized).not.toMatch(/data:text\/html;charset=utf-8,A{20}/)
    expect(summarized.length).toBeLessThan(2000)
    const page = hostErrorPage(nested)
    expect(page.length).toBeLessThan(4000)
    expect(encodeURIComponent(page).length).toBeLessThan(8000)
  })
})
