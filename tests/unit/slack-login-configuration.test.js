// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('Slack login configuration', () => {
    it('keeps setup defaults on identity-only Slack login scopes', () => {
        const setup = fs.readFileSync(path.join(repoRoot, 'scripts/setup.sh'), 'utf8');

        expect(setup).toContain('SLACK_AUTH_SCOPES=""');
        expect(setup).toContain('SLACK_AUTH_USER_SCOPES="identity.basic"');
        expect(setup).not.toContain('SLACK_AUTH_USER_SCOPES="chat:write,files:write"');
    });

    it('documents the same identity-only login defaults', () => {
        const envExample = fs.readFileSync(path.join(repoRoot, '.env.example'), 'utf8');

        expect(envExample).toContain('# SLACK_AUTH_SCOPES=');
        expect(envExample).toContain('# SLACK_AUTH_USER_SCOPES=identity.basic');
        expect(envExample).not.toContain('# SLACK_AUTH_USER_SCOPES=chat:write,files:write');
    });
});
