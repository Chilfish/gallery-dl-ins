import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['index.ts', 'sdk.ts', 'cli/index.ts'],
  format: 'esm',
  dts: true,
  clean: true,
  platform: 'node',
  target: 'esnext',
  exports: true,
  nodeProtocol: 'strip',
  deps: {
    onlyBundle: false,
  },
})
