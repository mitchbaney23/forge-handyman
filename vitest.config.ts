import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Stage 13 test config. Node environment (the units under test are pure
// data-layer code — mappers, migration helpers, paginated query loops, repo
// contracts — none touch the DOM). The `@` alias mirrors tsconfig.json's
// `@/*` → repo root so test imports resolve identically to app code.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
})
