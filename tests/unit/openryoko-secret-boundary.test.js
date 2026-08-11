import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const temporaryPaths = [];

afterEach(() => {
    for (const path of temporaryPaths.splice(0)) {
        rmSync(path, { recursive: true, force: true });
    }
});

describe('OpenRyoko secret boundary', () => {
    it('安全なSlack環境分離を含むruntimeへ固定する', () => {
        const bootstrap = readFileSync(
            resolve(repositoryRoot, 'scripts/openryoko/bootstrap-instance.sh'),
            'utf8'
        );
        const configure = readFileSync(
            resolve(repositoryRoot, 'scripts/openryoko/configure-runtime.sh'),
            'utf8'
        );
        const environmentDropIn = readFileSync(
            resolve(repositoryRoot, 'scripts/openryoko/templates/environment.conf'),
            'utf8'
        );

        expect(bootstrap).toContain('ca34b7e3e3dea4b92fc8f419b0884d59bd27da5e');
        expect(configure).toContain('4e7582e503b55b3ebd09b84a16b36b70af090bb6');
        expect(configure).toContain('merge-base --is-ancestor');
        expect(configure).toContain(
            'validate_protected_file "$GATEWAY_ENVIRONMENT_FILE" "root:root"'
        );
        expect(environmentDropIn).not.toContain('OPENRYOKO_ENV_FILE');
    });

    it('Claude wrapperがOAuthだけを渡してSlack資格情報を除去する', () => {
        const root = mkdtempSync(join(tmpdir(), 'openryoko-secret-boundary-'));
        temporaryPaths.push(root);
        const environmentFile = join(root, 'claude-environment');
        const fakeClaude = join(root, 'fake-claude');
        const wrapper = join(root, 'claude-wrapper');

        writeFileSync(environmentFile, [
            'CLAUDE_CODE_OAUTH_TOKEN=oauth-canary',
            'OPENRYOKO_SLACK_APP_TOKEN=file-app-canary',
            'OPENRYOKO_SLACK_BOT_TOKEN=file-bot-canary',
            'OPENRYOKO_SLACK_SIGNING_SECRET=file-signing-canary',
            ''
        ].join('\n'), { mode: 0o600 });
        writeFileSync(fakeClaude, [
            '#!/usr/bin/env bash',
            'printf "%s|%s|%s|%s\\n" "${CLAUDE_CODE_OAUTH_TOKEN-}" "${OPENRYOKO_SLACK_APP_TOKEN-}" "${OPENRYOKO_SLACK_BOT_TOKEN-}" "${OPENRYOKO_SLACK_SIGNING_SECRET-}"',
            ''
        ].join('\n'));
        chmodSync(fakeClaude, 0o750);

        const template = readFileSync(
            resolve(repositoryRoot, 'scripts/openryoko/templates/claude-wrapper.sh'),
            'utf8'
        );
        writeFileSync(
            wrapper,
            template
                .replace('@ENVIRONMENT_FILE@', environmentFile)
                .replace('@CLAUDE_BINARY@', fakeClaude)
        );
        chmodSync(wrapper, 0o750);

        const result = spawnSync(wrapper, [], {
            encoding: 'utf8',
            env: {
                ...process.env,
                OPENRYOKO_SLACK_APP_TOKEN: 'parent-app-canary',
                OPENRYOKO_SLACK_BOT_TOKEN: 'parent-bot-canary',
                OPENRYOKO_SLACK_SIGNING_SECRET: 'parent-signing-canary'
            }
        });

        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe('oauth-canary|||');
    });
});
