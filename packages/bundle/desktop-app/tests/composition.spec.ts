/**
 * Shipped desktop-app patch composition: the client roster and api-gateway
 * without a webserver or listen-port expression.
 */

import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'

const REPO_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
const BASE_PATCH = join(REPO_ROOT, 'packages/bundle/base/cordis.patch.yml')
const DESKTOP_PATCH = join(REPO_ROOT, 'packages/bundle/desktop-app/cordis.patch.yml')

/** Row names from one composed tree. */
function names(rows: { name?: string }[]): string[] {
  return rows.flatMap(row => row.name === undefined ? [] : [row.name])
}

describe('desktop-app patch composition', () => {
  it('includes the client roster and api-gateway and omits HTTP transport', () => {
    const rows = composeEntries([
      loadOverlayPatches('dsh-test', BASE_PATCH),
      loadOverlayPatches('dsh-test', DESKTOP_PATCH),
    ])
    const composed = names(rows)
    expect(composed).toContain('@deepseek-ai/dsh-host-apiproxy')
    expect(composed).toContain('@deepseek-ai/dsh-client-modules')
    expect(composed).toContain('@deepseek-ai/dsh-client-connection')
    expect(composed).toContain('@deepseek-ai/dsh-api-remotes')
    expect(composed).toContain('@deepseek-ai/dsh-desktop-app')
    expect(composed).toContain('@deepseek-ai/dsh-desktop-app/startup')
    expect(composed).toContain('@deepseek-ai/dsh-desktop-app/ipc-host')
    expect(composed).toContain('@deepseek-ai/dsh-host-directory-picker-native')
    expect(composed).toContain('@deepseek-ai/dsh-client-ui-directory-picker-native')
    expect(composed).not.toContain('@deepseek-ai/dsh-host-webserver')
    expect(composed).not.toContain('@deepseek-ai/dsh-host-directory-picker-auto')
    expect(composed).not.toContain('@deepseek-ai/dsh-client-hmr')
    expect(JSON.stringify(rows)).not.toMatch(/webStartup|\.port ??/)
  })
})
