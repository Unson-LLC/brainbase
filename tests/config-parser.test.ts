import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, afterEach } from 'vitest';
import { ConfigParser } from '../src/config-parser.js';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeParser(configContents: string) {
  const root = await mkdtemp(join(tmpdir(), 'brainbase-config-parser-'));
  tempDirectories.push(root);
  const configPath = join(root, 'config.yml');
  const slackDir = join(root, 'codex', 'common', 'meta', 'slack');
  const brainbaseRoot = join(root, 'brainbase');
  const projectsRoot = join(root, 'projects');
  await mkdir(slackDir, { recursive: true });
  await writeFile(configPath, configContents, 'utf8');
  return {
    parser: new ConfigParser({ configPath, slackDir, brainbaseRoot, projectsRoot }),
    configPath,
    root,
  };
}

describe('ConfigParser', () => {
  it('requires every filesystem path from the host and does not use workspace defaults', () => {
    expect(() => new ConfigParser()).toThrow('ConfigParser requires an explicit configPath path');
    expect(() => new ConfigParser({
      configPath: '/tmp/config.yml',
      slackDir: '/tmp/slack',
      brainbaseRoot: '/tmp/brainbase',
    } as never)).toThrow('ConfigParser requires an explicit projectsRoot path');
  });

  it('loads injected paths and preserves cache invalidation semantics', async () => {
    const { parser, configPath, root } = await makeParser([
      'projects:',
      '  - id: first',
      '    local:',
      '      path: "${PROJECTS_ROOT:-/ignored}/first"',
      '',
    ].join('\n'));

    expect(await parser.getProjects()).toEqual({
      root,
      projects: [{
        id: 'first',
        local: { path: join(root, 'projects', 'first') },
      }],
    });

    await writeFile(configPath, 'projects:\n  - id: second\n', 'utf8');
    expect((await parser.getProjects()).projects[0].id).toBe('first');

    parser.invalidateCache();
    expect((await parser.getProjects()).projects[0].id).toBe('second');
    expect(parser.getProjects).toBeDefined();
    expect(dirname(parser.brainbaseRoot)).toBe(root);
  });
});
