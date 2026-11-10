import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { checkPrBody } from '../scripts/check-pr-brainbase-line.mjs';

it('validates complete Brainbase lines and CLI env input, with only the two bot exemptions', () => {
  const valid = [
    'Brainbase: ba598daa', 'Brainbase: RQ-125',
    'Brainbase: 550e8400-e29b-41d4-a716-446655440000',
    'brainbase:ba598daa', '  BRAINBASE :  RQ-125  ',
    'intro\r\nBrainbase: RQ-125\r\nend',
    'Brainbase: none (docs only)', 'Brainbase: None (release)',
    'Brainbase: none  (x)',
    'Brainbase: none (  理由  )', 'Brainbase: abc',
    `Brainbase: ${'a'.repeat(64)}`, 'Brainbase: A.b_c-9',
    'Brainbase: TODO\nBrainbase: RQ-125',
    '$(id)\n`id`\n"; exit 0 #\nBrainbase: RQ-125',
  ];
  const invalid = [
    '', null, undefined, 'no task', 'Brainbase:', 'Brainbase: <task id>',
    'Brainbase: <RQ-125>', 'Brainbase: TBD', 'Brainbase: todo',
    'Brainbase: xXx', 'Brainbase: n/a', 'Brainbase: -', 'Brainbase: ?',
    'Brainbase: none', 'Brainbase: NONE', 'Brainbase: none ()',
    'Brainbase: none (   )', 'Brainbase: none (\t)',
    'Brainbase: none (<reason>)', 'Brainbase: none (<理由>)',
    'Brainbase: none (TBD)', 'Brainbase: none ( TODO )',
    'Brainbase: none (xxx)', 'Brainbase: none (N/A)', 'Brainbase: none (-)',
    'Brainbase: none ( <reason> )',
    'Brainbase: none (a) extra (b)', 'Brainbase: none (a) b)',
    'see Brainbase: ba598daa', 'Brainbase: ab',
    `Brainbase: ${'a'.repeat(65)}`, 'Brainbase: _abc',
    'Brainbase: RQ-125 extra', 'Brainbase: RQ-125 # comment',
    'Brainbase: none (docs) extra', 'Brainbase:\nRQ-125',
    'Brainbase: $(id)', 'Brainbase: `id`', 'Brainbase: "; exit 0 #',
  ];
  for (const body of valid) expect(checkPrBody(body, 'human').ok, body).toBe(true);
  for (const body of invalid) expect(checkPrBody(body, 'human').ok, body).toBe(false);
  for (const author of ['dependabot[bot]', 'github-actions[bot]']) {
    expect(checkPrBody(null, author)).toEqual({ ok: true, message: expect.stringMatching(/bot exemption/) });
  }
  expect(checkPrBody('', 'other[bot]').ok).toBe(false);

  for (const [body, author, status] of [
    [valid.at(-1), 'human', 0], [invalid.at(-1), 'human', 1],
    ['', 'human', 1], ['', 'dependabot[bot]', 0], ['', 'github-actions[bot]', 0],
  ]) {
    const result = spawnSync(process.execPath, ['scripts/check-pr-brainbase-line.mjs'], {
      env: { ...process.env, PR_BODY: body, PR_AUTHOR: author }, encoding: 'utf8',
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(status);
    if (status === 1) expect(result.stderr).toMatch(/Brainbase: RQ-125.*Brainbase: none \(docs only\)/);
    if (author.endsWith('[bot]')) expect(result.stdout).toMatch(/bot exemption/);
  }
});
