import path from 'node:path';

/** Build arguments only. This is neither a repository registry nor push authority. */
export function buildRepositoryTargetHandoff({ repository, cwd } = {}) {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('判断済みの変更先を owner/name で指定してください。');
  }
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || cwd.includes('\0')) {
    throw new Error('作業場所を絶対パスで指定してください。');
  }
  return {
    cwd,
    args: ['pr', 'create', '.', '--repo', repository],
    env: { VIBEPRO_EXPECTED_REPOSITORY: repository },
  };
}
