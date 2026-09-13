import test from 'node:test';
import assert from 'node:assert/strict';
import * as contract from '../../.claude/scripts/hooks/lib/vibepro-runtime-contract.mjs';

const cwd = process.cwd();
const repository = 'example/private';
const matched = { schema_version: 'repository-target-v1', repository, status: 'matched' };
const identity = {
  package: { exact_version: contract.EXPECTED_VIBEPRO_VERSION },
  source_kind: 'npm_package', release_manifest: { status: 'valid' },
  source_git: { commit: contract.EXPECTED_VIBEPRO_SOURCE_COMMIT, dirty: false, origin_main_relation: 'published' },
  integrity: { status: 'trusted' }, identity_digest: 'a'.repeat(64),
};

test('PR入口は版と照合機能を確認してから変更先を渡して実行する', () => {
  const calls = [];
  contract.createWithCanonicalRuntime(cwd, repository, (_command, args, options) => {
    calls.push({ args, options });
    return { status: 0, stdout: JSON.stringify(args[0] === 'runtime' ? identity : args[0] === 'guard' ? matched : { created: true }) };
  });
  assert.deepEqual(calls.map(call => call.args[0]), ['runtime', 'guard', 'pr']);
  assert.deepEqual(calls[2].args, ['pr', 'create', '.', '--repo', repository, '--json']);
  assert.equal(calls[2].options.env.VIBEPRO_EXPECTED_REPOSITORY, repository);
});

test('旧CLIが照合に未対応ならPR実行へ進まない', () => {
  const calls = [];
  assert.throws(() => contract.createWithCanonicalRuntime(cwd, repository, (_command, args) => {
    calls.push(args[0]);
    return { status: 0, stdout: JSON.stringify(args[0] === 'runtime' ? identity : {}) };
  }), /照合/);
  assert.deepEqual(calls, ['runtime', 'guard']);
});

test('送信先照合を正規CLIへ渡し、明示した変更先を引き継ぐ', () => {
  let call;
  const result = contract.checkPushTarget(cwd, repository, 'git@github.com:example/private.git', (...args) => {
    call = args;
    return { status: 0, stdout: JSON.stringify(matched) };
  });
  assert.deepEqual(result, matched);
  assert.deepEqual(call[1], ['guard', 'target', '.', '--push-url', 'git@github.com:example/private.git', '--json']);
  assert.equal(call[2].env.VIBEPRO_EXPECTED_REPOSITORY, repository);
  assert.equal(call[2].shell, undefined);
});

test('旧CLIの成功・空出力・違う変更先は照合成功と扱わない', () => {
  for (const stdout of ['', '{}', JSON.stringify({ ...matched, repository: 'example/public' })]) {
    assert.throws(() => contract.checkPushTarget(cwd, repository, 'some-url', () => ({ status: 0, stdout })));
  }
});

test('未指定は子プロセスを起動せず停止する', () => {
  const runner = () => { assert.fail('子プロセスが呼ばれた'); };
  assert.throws(() => contract.checkPushTarget(cwd, undefined, 'some-url', runner), /変更先/);
  assert.throws(() => contract.checkPushTarget(cwd, repository, undefined, runner), /送信先/);
});

test('CLIの失敗に含まれる生のURL等を再出力しない', () => {
  assert.throws(() => contract.checkPushTarget(cwd, repository, 'some-url', () => ({ status: 1, stderr: 'secret-token' })), {
    message: '送信先を照合できません。対応するVibeProと変更先の指定を確認してください。',
  });
});
