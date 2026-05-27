import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // Bun-compatible settings
    pool: 'forks',
    // Test isolation best practices
    restoreMocks: true,
    clearMocks: true,
  },
})
