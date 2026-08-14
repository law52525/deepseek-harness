/** Custom protocol mapping stays inside the frontend dist directory. */

import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileFromDshUrl } from '../src/dsh-protocol.ts'
import { hostErrorPage } from '../src/error-page.ts'

describe('dsh protocol and error page', () => {
  it('maps dsh://app paths onto dist and rejects escapes', () => {
    const dist = join('/tmp', 'dsh-frontend-dist')
    expect(fileFromDshUrl('dsh://app/', dist)).toBe(join(dist, 'index.html'))
    expect(fileFromDshUrl('dsh://app/assets/index.js', dist)).toBe(join(dist, 'assets', 'index.js'))
    expect(fileFromDshUrl('dsh://app/%2e%2e%2fsecret', dist)).toBeUndefined()
    expect(fileFromDshUrl('dsh://other/index.html', dist)).toBeUndefined()
    expect(fileFromDshUrl('http://app/', dist)).toBeUndefined()
    expect(fileFromDshUrl('not a url', dist)).toBeUndefined()
  })

  it('escapes operator-facing crash text', () => {
    expect(hostErrorPage('<script>alert(1)</script>')).toContain('&lt;script&gt;')
    expect(hostErrorPage('Host process stopped')).toContain('Host process stopped')
  })
})
