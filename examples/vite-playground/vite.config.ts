import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    lib: {
      // Only build the browser-safe entry here
      entry: {
        'sdk-only': 'src/sdk-only.ts',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [],
    },
    minify: false,
    modulePreload: false,
  },
})
