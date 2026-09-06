// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { fetchGraphNames, renderPreamble } from '../../../scripts/generate-memory-preamble.mjs';

const available = { names: [], status: 'available' };
function render(kgResult, overrides = {}) {
  return renderPreamble({ persons: available, orgs: available, customers: available,
    caps: ['personal-kg'], today: '2026-09-06', kgResult, ...overrides });
}

describe('memory preamble rendering', () => {
  it('deduplicates normalized bodies before selecting six and preserves complete sentences', () => {
    const body = '判断の前提を確認する。'.repeat(15) + '不明の場合は確認する。';
    const result = render({ status: 'available', records: [
      { id: 'a', body }, { id: 'b', body: `  ${body}  ` }, { id: 'c', body: '別の判断軸。' },
    ] });
    expect(result.counts.kg).toBe(2);
    expect(result.text.split(body)).toHaveLength(2);
    expect(result.text).toContain('別の判断軸。');
    expect(result.text).not.toContain('/merge');
    expect(result.text).not.toContain('SSOTに未登録');
  });
  it('keeps failure unknown and valid empty distinct, and references oversized bodies', () => {
    const unknown = render({ status: 'unavailable', records: [] }, { persons: { names: [], status: 'failed' } });
    expect(unknown.counts.kg).toBeNull();
    expect(unknown.counts.persons).toBeNull();
    expect(unknown.text).toContain('people: 未確認');
    const empty = render({ status: 'confirmed_empty', records: [] });
    expect(empty.counts.kg).toBe(0);
    expect(empty.text).toContain('確認済み');
    const long = render({ status: 'available', records: [{ id: 'large', body: '長'.repeat(1300) }] });
    expect(long.text).toContain('candidate_id=large');
    expect(long.text).not.toContain('長'.repeat(110));
  });
  it('distinguishes failed/malformed Graph responses from an empty response', async () => {
    for (const response of [{ ok: false }, { ok: true, json: async () => ({}) }]) {
      expect((await fetchGraphNames('person', 'test', async () => response)).status).toBe('failed');
    }
    expect(await fetchGraphNames('person', 'test', async () => ({ ok: true, json: async () => ({ records: [] }) })))
      .toEqual(available);
    expect((await fetchGraphNames('person', 'test', async () => { throw new Error('offline'); })).status).toBe('failed');
  });
});

describe.each([
  ['Codex', 'bash', [path.resolve('scripts/codex-hooks/inject-memory-preamble.sh')]],
  ['Claude', process.execPath, ['--import', path.resolve('node_modules/tsx/dist/loader.mjs'), path.resolve('.claude/scripts/hooks/session-start/inject-memory-preamble.ts')]],
])('%s SessionStart', (_name, command, args) => {
  it('injects fresh content; skips expired, touched-old, malformed, empty and missing files', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'preamble-hook-'));
    const file = path.join(directory, 'preamble.txt');
    const run = () => JSON.parse(execFileSync(command, args, { cwd: directory, encoding: 'utf8',
      env: { ...process.env, BRAINBASE_MEMORY_PREAMBLE: file } }));
    const context = (result) => result.hookSpecificOutput?.additionalContext || result.systemMessage || '';
    try {
      expect(context(run())).toBe('');
      const today = new Date().toISOString().slice(0, 10);
      const fresh = `[Brainbase memory preamble — ${today}]\nCurrent marker`;
      fs.writeFileSync(file, fresh);
      expect(context(run())).toBe(fresh);
      const old = new Date(Date.now() - 4 * 86400000);
      fs.utimesSync(file, old, old);
      expect(context(run())).toBe('');
      fs.writeFileSync(file, '[Brainbase memory preamble — 2026-08-10]\nStale marker');
      fs.utimesSync(file, new Date(), new Date());
      expect(context(run())).toBe('');
      for (const invalid of ['', 'undated marker', '[Brainbase memory preamble — 2026-02-31]\nInvalid marker']) {
        fs.writeFileSync(file, invalid);
        expect(context(run())).toBe('');
      }
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });
});
