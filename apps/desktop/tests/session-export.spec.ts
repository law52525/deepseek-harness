/** Session-export control replies become `dsh:` Responses; body paths stay under tmp. */

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertTempExportPath, responseFromSessionExport } from '../src/session-export.ts'

describe('desktop session export response', () => {
  it('returns HEAD-style empty bodies and GET ZIP bytes from a temp file', async () => {
    const head = await responseFromSessionExport({
      status: 404,
      headers: { 'content-type': 'text/plain' },
    })
    expect(head.status).toBe(404)
    expect(head.headers.get('content-type')).toBe('text/plain')
    expect(await head.text()).toBe('')

    const dir = mkdtempSync(join(tmpdir(), 'dsh-session-export-'))
    const bodyPath = join(dir, 'dsh-session-export-test.zip')
    writeFileSync(bodyPath, 'PK zip')
    const get = await responseFromSessionExport({
      status: 200,
      headers: { 'content-type': 'application/zip' },
      bodyPath,
    })
    expect(get.status).toBe(200)
    expect(Buffer.from(await get.arrayBuffer()).toString()).toBe('PK zip')
    await expect(responseFromSessionExport({
      status: 200,
      headers: {},
      bodyPath,
    })).rejects.toThrow()
  })

  it('rejects body paths outside the temp export prefix', () => {
    expect(() => assertTempExportPath(join(tmpdir(), 'other.zip')))
      .toThrow('outside the temp directory')
    expect(() => assertTempExportPath('/etc/passwd')).toThrow('outside the temp directory')
  })
})
