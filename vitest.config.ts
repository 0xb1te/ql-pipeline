import { defineConfig } from 'vitest/config';

export default defineConfig({
  // pnpm's git-dependency store folders (e.g.
  // node_modules/.pnpm/@0xb1te+house-client@git+https+...#<sha>) contain
  // characters Vite's default realpath-following resolver mishandles on
  // Windows, producing a mangled absolute path ("Cannot find module
  // '/node_modules/...'", missing the drive letter). preserveSymlinks
  // makes Vite resolve through the node_modules junction it's given
  // instead of following it to the pnpm store first.
  resolve: {
    preserveSymlinks: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
    },
  },
});
