export type RuntimeVersionReadback = {
  status: 200 | 503;
  body: {
    ready: boolean;
    reason?: 'runtime_version_unavailable';
    runtime?: {
      git: { sha: string; dirty: boolean };
      pid: number;
      started_at: string;
    };
  };
};

export function readRuntimeVersion(
  env: NodeJS.ProcessEnv = process.env,
  pid: number = process.pid,
): RuntimeVersionReadback {
  const gitSha = env.BRAINBASE_RUNTIME_GIT_SHA || '';
  const startedAt = env.BRAINBASE_RUNTIME_STARTED_AT || '';
  if (!/^[a-f0-9]{40}$/.test(gitSha) || !Number.isFinite(Date.parse(startedAt))) {
    return {
      status: 503,
      body: { ready: false, reason: 'runtime_version_unavailable' },
    };
  }

  return {
    status: 200,
    body: {
      ready: true,
      runtime: {
        git: { sha: gitSha, dirty: env.BRAINBASE_RUNTIME_GIT_DIRTY !== 'false' },
        pid,
        started_at: startedAt,
      },
    },
  };
}
