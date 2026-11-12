import { defineConfig } from 'vitest/config';

// Several CI jobs share the EVO-X2 runner. Disk-backed graph and HTTP tests
// need a bounded wall-clock allowance when those jobs contend for I/O.
// Keep local feedback fast and retain finite test and cleanup deadlines.
export default defineConfig({
  test: {
    ...(process.env.CI ? { testTimeout: 30_000, hookTimeout: 60_000 } : {}),
  },
});
