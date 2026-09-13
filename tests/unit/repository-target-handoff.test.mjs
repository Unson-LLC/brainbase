import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRepositoryTargetHandoff } from '../../scripts/repository-target-handoff.mjs';

test('判断済みの変更先を引数と子プロセス環境へ同じ値で渡す', () => {
  const result = buildRepositoryTargetHandoff({ repository: 'example/private', cwd: '/work/project' });
  assert.deepEqual(result, {
    cwd: '/work/project',
    args: ['pr', 'create', '.', '--repo', 'example/private'],
    env: { VIBEPRO_EXPECTED_REPOSITORY: 'example/private' },
  });
});

test('変更先を環境やoriginから推測しない', () => {
  assert.throws(() => buildRepositoryTargetHandoff({ cwd: '/work/project' }), /変更先/);
});

test('URL・オプション・空白入りの変更先を拒否し入力値をエラーへ出さない', () => {
  for (const repository of ['https://token@github.com/example/private', '--repo', 'example/private other', 'example/private/extra', '', null]) {
    assert.throws(() => buildRepositoryTargetHandoff({ repository, cwd: '/work/project' }), {
      message: '判断済みの変更先を owner/name で指定してください。',
    });
  }
});

test('作業場所も明示を必須とする', () => {
  for (const cwd of [undefined, '.', 'relative/path', '']) {
    assert.throws(() => buildRepositoryTargetHandoff({ repository: 'example/private', cwd }), /絶対パス/);
  }
});
