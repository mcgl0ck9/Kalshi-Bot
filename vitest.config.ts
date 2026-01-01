import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Test file patterns
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],

    // Exclude node_modules
    exclude: ['node_modules/**'],

    // Environment
    environment: 'node',

    // Globals (describe, it, expect without imports)
    globals: true,

    // Timeout for async tests (whale conviction can be slow)
    testTimeout: 120000,

    // Coverage configuration
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/index.ts',
        'src/types/**',
      ],
    },

    // TypeScript support
    typecheck: {
      enabled: false, // Use tsc for type checking
    },
  },
});
