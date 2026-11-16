import { defineConfig } from 'vitest/config';

// CI runs on one self-hosted machine that several repositories share. Under that load,
// ordinary tests took up to 14s and setup hooks over 10s, so the Vitest defaults failed
// at random. Give CI more time; keep the defaults locally so a real hang shows quickly.
export function sharedRunnerTimeouts(env) {
  const onCi = env.CI !== undefined && env.CI !== '' && env.CI !== 'false';
  return onCi ? { testTimeout: 30_000, hookTimeout: 60_000 } : { testTimeout: 5_000, hookTimeout: 10_000 };
}

export default defineConfig({
  test: sharedRunnerTimeouts(process.env),
});
