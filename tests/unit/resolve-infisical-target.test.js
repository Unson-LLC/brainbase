import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadConfig,
  renderShellAssignments,
  resolveTarget,
} from '../../scripts/lib/resolve-infisical-target.mjs';

function writeJson(dir, name, data) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

describe('resolveInfisicalTarget', () => {
  it('expands org auth file references and deduplicates entries', () => {
    const config = {
      domain: 'https://infisical.example.test',
      orgAuthFiles: {
        unson: ['~/.brainbase/runtime-env/unson.env', '~/.brainbase/runtime-env/shared.env'],
      },
      targets: {
        app: {
          org: 'unson',
          projectId: 'project-id',
          env: 'prod',
          path: '/app',
          authFiles: ['~/.brainbase/runtime-env/app.env', '@org:unson', '~/.brainbase/runtime-env/app.env'],
          requiredKeys: ['APP_URL', 'APP_URL', 'APP_TOKEN'],
        },
      },
    };

    expect(resolveTarget('app', config)).toEqual({
      name: 'app',
      description: '',
      org: 'unson',
      domain: 'https://infisical.example.test',
      projectId: 'project-id',
      env: 'prod',
      path: '/app',
      authFiles: [
        '~/.brainbase/runtime-env/app.env',
        '~/.brainbase/runtime-env/unson.env',
        '~/.brainbase/runtime-env/shared.env',
      ],
      tokenFile: '',
      requiredKeys: ['APP_URL', 'APP_TOKEN'],
    });
  });

  it('merges local target overrides into the base allowlist', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'infisical-targets-'));
    const basePath = writeJson(dir, 'base.json', {
      domain: 'https://base.example.test',
      targets: {
        base: {
          projectId: 'base-id',
          env: 'prod',
          path: '/',
        },
      },
    });
    const localPath = writeJson(dir, 'local.json', {
      targets: {
        base: {
          projectId: 'override-id',
          env: 'dev',
        },
        local: {
          projectId: 'local-id',
          env: 'prod',
          path: '/local',
        },
      },
    });

    const config = loadConfig({ configPath: basePath, localConfigPath: localPath });

    expect(resolveTarget('base', config).projectId).toBe('override-id');
    expect(resolveTarget('base', config).env).toBe('dev');
    expect(resolveTarget('base', config).path).toBe('/');
    expect(resolveTarget('local', config).path).toBe('/local');
  });

  it('renders shell assignments without leaking array syntax into eval callers', () => {
    const rendered = renderShellAssignments({
      name: 'target',
      description: "owner's target",
      org: 'unson',
      domain: 'https://infisical.example.test',
      projectId: 'project-id',
      env: 'prod',
      path: '/',
      authFiles: ['~/a.env', '~/b.env'],
      tokenFile: '',
      requiredKeys: ['A', 'B'],
    });

    expect(rendered).toContain("INFISICAL_TARGET_DESCRIPTION='owner'\\''s target'");
    expect(rendered).toContain('INFISICAL_TARGET_AUTH_FILE_COUNT=2');
    expect(rendered).toContain("INFISICAL_TARGET_AUTH_FILE_2='~/b.env'");
    expect(rendered).toContain('INFISICAL_TARGET_REQUIRED_KEY_COUNT=2');
    expect(rendered).toContain("INFISICAL_TARGET_REQUIRED_KEY_2='B'");
  });

  it('fails loudly for incomplete targets', () => {
    expect(() => resolveTarget('broken', {
      targets: {
        broken: {
          projectId: 'project-id',
        },
      },
    })).toThrow(/missing: domain, env/);
  });
});
