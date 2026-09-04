// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../../..');
const retiredCliScripts = [
    'scripts/build-sns-generation-context.js',
    'scripts/generate-sns-ohayo-brief.js',
    'scripts/generate-personal-kg-sns-weekly-pack.js',
    'scripts/import-sns-review-pack-to-ledger.js',
    'scripts/run-sns-scheduled-posts.js',
    'scripts/process-sns-feedback-to-learning.js',
    'scripts/poll-sns-feedback-metrics.js',
    'scripts/project-oyasumi-sns-ready.js',
    'scripts/seed-personal-kg-sns-foundation.js'
];
const retiredLaunchdTemplates = [
    'config/com.brainbase.sns-scheduled-publisher.plist',
    'config/com.brainbase.sns-feedback-metrics-poller.plist'
];

describe('retired SNS CLI entry points', () => {
    it.each(retiredCliScripts)('%s fails before performing an SNS operation', (script) => {
        for (const flags of [[], ['--dry-run', '--json'], ['--confirm-public-post']]) {
            const result = spawnSync(process.execPath, [path.join(root, script), ...flags], {
                cwd: root,
                encoding: 'utf8',
                timeout: 10000,
                env: {
                    NODE_ENV: 'test',
                    FORCE_COLOR: '0',
                    BRAINBASE_SNS_SERVICE_TOKEN: 'bbsvc_should_not_be_used',
                    DATABASE_URL: 'postgres://should-not-be-read'
                }
            });

            expect(result.error).toBeUndefined();
            expect(result.status).toBe(1);
            expect(result.stdout).toBe('');
            expect(result.stderr).toContain('SNS_CLI_RETIRED');
            expect(result.stderr).toContain('SNS操作は実行していません');
        }
    });

    it('removes SNS npm commands and launchd templates from active distribution', () => {
        const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        expect(Object.keys(packageJson.scripts ?? {}).filter((name) => /sns/i.test(name))).toEqual([]);

        for (const template of retiredLaunchdTemplates) {
            expect(fs.existsSync(path.join(root, template))).toBe(false);
        }
    });
});
