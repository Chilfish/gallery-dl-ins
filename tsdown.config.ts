import { defineConfig } from 'tsdown'

export default defineConfig([
  // ── SDK (platform-agnostic: browser / Deno / Edge / Node.js) ──
  {
    entry: ['index.ts', 'node.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    platform: 'neutral',
    target: 'es2020',
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
    entry: { 'cli/index': 'cli/index.ts' },
    format: ['cjs'],
    dts: false,
    platform: 'node',
    target: 'es2020',
    banner: { js: '#!/usr/bin/env node' },
    deps: {
      onlyBundle: ['commander', 'axios'],
    },
  },
])
