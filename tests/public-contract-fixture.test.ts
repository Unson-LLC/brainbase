import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toolDefinitions } from '../src/server.js';

interface PublicContract {
  schemaVersion: string;
  package: { name: string; main: string; types: string; bin: Record<string, string> };
  mcpTools: Array<{ name: string; requiredInput: string[] }>;
  cliCommands: string[];
}

const root = process.cwd();
const fixturePath = join(root, 'contracts', 'brainbase-public-contract.v1.json');

function contract(): PublicContract {
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as PublicContract;
}

describe('OSS public contract fixture', () => {
  it('contains no organization endpoint or personal absolute path', () => {
    const source = readFileSync(fixturePath, 'utf8');
    expect(source).not.toMatch(/bb\.unson\.jp|lightsail|infisical/iu);
    expect(source).not.toMatch(/(?:\/Users\/|\/home\/|[A-Z]:\\Users\\)/u);
  });

  it('matches the package manifest and is published', () => {
    const fixture = contract();
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as PublicContract['package'] & { files: string[] };
    expect(fixture.schemaVersion).toBe('1.0.0');
    expect(fixture.package).toEqual({ name: manifest.name, main: manifest.main, types: manifest.types, bin: manifest.bin });
    expect(manifest.files).toContain('contracts');
  });

  it('matches every MCP tool name and required input field', () => {
    const actual = toolDefinitions.map((tool) => ({
      name: tool.name,
      requiredInput: [...('required' in tool.inputSchema && Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required : [])].sort()
    }));
    expect(contract().mcpTools).toEqual(actual);
    expect(actual).toHaveLength(15);
  });

  it('matches every routed CLI command', () => {
    const source = readFileSync(join(root, 'src', 'cli.ts'), 'utf8');
    const actual = [...source.matchAll(/case '([^']+)'/gu)].map((match) => match[1]);
    expect(contract().cliCommands).toEqual(actual);
    expect(actual).toHaveLength(23);
  });

  it('is included in the npm tarball', () => {
    const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8' })) as Array<{ files: Array<{ path: string }> }>;
    expect(packed[0]?.files.map((file) => file.path)).toContain('contracts/brainbase-public-contract.v1.json');
  }, 30_000);
});
