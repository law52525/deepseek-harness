import { defineConfig } from 'tsdown'

/**
 * Electron main and preload are separate processes, so each is its own bundle.
 * `electron` stays external: the runtime loads it from the installed binary.
 */
export default defineConfig({
  entry: ['lib/types/main.js', 'lib/types/preload.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
  external: ['electron'],
})
