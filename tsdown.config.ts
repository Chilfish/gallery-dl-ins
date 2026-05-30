import { defineConfig } from 'tsdown'

export default defineConfig([
  // ── SDK (platform-agnostic: browser / Deno / Edge / Node.js) ──
  {
    entry: ['src/index.ts', 'src/node.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    platform: 'neutral',
    target: 'es2022',
    outExtension({ format }) {
      return {
        dts: format === 'cjs' ? '.d.cts' : '.d.mts',
        js: format === 'cjs' ? '.cjs' : '.mjs',
      }
    },
    deps: {
      skipNodeModulesBundle: true,
    },
    exports: true,
  },

  // ── CLI (Node.js, self-contained for npx) ──
  {
    entry: { 'dl-ins': 'src/cli/index.ts' },
    format: ['esm'],
    dts: false,
    platform: 'node',
    target: 'es2022',
    deps: {
      onlyBundle: ['commander', 'axios'],
    },
  },
])
