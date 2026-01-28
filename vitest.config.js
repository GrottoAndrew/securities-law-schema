import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.{test,spec}.{js,ts}'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{js,ts}', 'scripts/**/*.{js,ts}'],
      exclude: ['node_modules', 'tests'],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
