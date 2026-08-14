import { defineConfig } from 'tsdown'

/**
 * Electron main and preload are separate processes, so each is its own bundle.
 * `electron` stays external: the runtime loads it from the installed binary.
 * `electron-updater` and `@deepseek-ai/dsh-desktop-app/ipc-protocol` are always
 * bundled: electron-builder `files` omit `node_modules`, so a leftover package
 * import would throw `ERR_MODULE_NOT_FOUND` in the packaged app.
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
  deps: {
    neverBundle: ['electron'],
    alwaysBundle: [
      'electron-updater',
      '@deepseek-ai/dsh-desktop-app',
      '@deepseek-ai/dsh-desktop-app/ipc-protocol',
    ],
    onlyBundle: false,
  },
})
