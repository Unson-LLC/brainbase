import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { initializePersonalOs, loadPersonalOs, mutatePersonalOs } from '../src/ssot.js';

const TEST_TMP_ROOT = process.env.BRAINBASE_TEST_FIXTURE_ROOT ?? tmpdir();
const dirs: string[] = [];

async function dataDir(): Promise<string> {
  const dir = await mkdtemp(join(TEST_TMP_ROOT, 'brainbase-lock-queue-'));
  dirs.push(dir);
  await initializePersonalOs(dir);
  return dir;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function addSeed(text: string) {
  return (current: Awaited<ReturnType<typeof loadPersonalOs>>) => ({
    ...current,
    personalKg: [...current.personalKg, { id: `kg-${text}`, type: 'work' as const, text, source: 'test' }]
  });
}

afterEach(async () => {
  delete process.env.BRAINBASE_SSOT_LOCK_TIMEOUT_MS;
  delete process.env.BRAINBASE_SSOT_LOCK_RETRY_MS;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('canonical SSOT lock inside one process', () => {
  it('hands the lock to the next caller in this process without waiting for a retry interval', async () => {
    const dir = await dataDir();
    // A retry interval longer than the test time limit: any caller that had to poll
    // the directory lock would make this test time out.
    process.env.BRAINBASE_SSOT_LOCK_RETRY_MS = '600000';

    const texts = Array.from({ length: 12 }, (_, index) => `parallel-${index}`);
    await Promise.all(texts.map((text) => mutatePersonalOs(dir, addSeed(text))));

    const saved = (await loadPersonalOs(dir)).personalKg.map((entry) => entry.text);
    expect(saved).toEqual(texts);
  });

  it('runs callers in arrival order and never overlaps two holders', async () => {
    const dir = await dataDir();
    const events: string[] = [];
    let holders = 0;
    const run = (name: string) => mutatePersonalOs(dir, async (current) => {
      holders += 1;
      expect(holders).toBe(1);
      events.push(`start ${name}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push(`end ${name}`);
      holders -= 1;
      return addSeed(name)(current);
    });

    await Promise.all(['a', 'b', 'c'].map(run));

    expect(events).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c']);
  });

  it('times out a waiting caller with the same error, and the caller after it still waits for the holder', async () => {
    const dir = await dataDir();
    const release = deferred();
    const holding = deferred();
    const holder = mutatePersonalOs(dir, async (current) => {
      holding.resolve();
      await release.promise;
      return addSeed('holder')(current);
    });
    await holding.promise;

    process.env.BRAINBASE_SSOT_LOCK_TIMEOUT_MS = '40';
    const timedOut = mutatePersonalOs(dir, addSeed('timed-out'));
    process.env.BRAINBASE_SSOT_LOCK_TIMEOUT_MS = '5000';
    let laterStartedBeforeHolderEnded = false;
    let holderEnded = false;
    const later = mutatePersonalOs(dir, (current) => {
      laterStartedBeforeHolderEnded = !holderEnded;
      return addSeed('later')(current);
    });

    await expect(timedOut).rejects.toThrow(/Timed out waiting for canonical SSOT lock/);
    await new Promise((resolve) => setTimeout(resolve, 20));
    holderEnded = true;
    release.resolve();
    await holder;
    await later;

    expect(laterStartedBeforeHolderEnded).toBe(false);
    expect((await loadPersonalOs(dir)).personalKg.map((entry) => entry.text)).toEqual(['holder', 'later']);
  });

  it('still fails a nested call for the same directory after the lock time limit instead of hanging', async () => {
    const dir = await dataDir();
    process.env.BRAINBASE_SSOT_LOCK_TIMEOUT_MS = '40';

    await expect(mutatePersonalOs(dir, async (current) => {
      await loadPersonalOs(dir);
      return current;
    })).rejects.toThrow(/Timed out waiting for canonical SSOT lock/);
    await expect(loadPersonalOs(dir)).resolves.toMatchObject({ personalKg: [] });
  });
});
