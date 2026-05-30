/**
 * Vite config for Node.js / serverless target.
 *
 * Builds the ``with-create-sdk`` entry using SSR mode so that
 * Node.js builtins (fs, path) are not externalized.
 *
 * 预期：产物中应包含 axios 但不包含 fs/promises（storage 被 tree-shake）
 */

import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    ssr: true,
    lib: {
      entry: {
        'with-create-sdk': 'src/with-create-sdk.ts',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [],
    },
    minify: false,
    modulePreload: false,
    copyPublicDir: false,
  },
})
