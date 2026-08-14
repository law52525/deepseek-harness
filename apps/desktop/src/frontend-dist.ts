/**
 * Locate the built `dsh-web-frontend` dist directory.
 */

import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { resolveBundledFrontendDist } from './packaged-resources.ts'

/**
 * Resolve the directory that contains the Vite `index.html`.
 * @returns absolute dist directory path.
 */
export function resolveFrontendDist(): string {
  const bundled = resolveBundledFrontendDist()
  if (bundled !== undefined) return bundled
  const require = createRequire(import.meta.url)
  try {
    return dirname(require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html'))
  } catch {
    throw new Error('desktop: frontend dist not built; run pnpm run build from the repository root first')
  }
}
