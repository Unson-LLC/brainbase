import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');
const settingsPath = resolve(repositoryRoot, '.claude/settings.json');

function configuredHooks() {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    return Object.values(settings.hooks)
        .flat()
        .flatMap((entry) => entry.hooks ?? []);
}

function runHookTargets(hooks = configuredHooks()) {
    return hooks
        .map((hook) => hook.command?.match(/\.claude\/scripts\/run-hook\.sh\s+([^\s]+)/u)?.[1])
        .filter(Boolean);
}

describe('Claude hook settings', () => {
    it('run-hook.shで参照するhookファイルがすべて存在する', () => {
        const targets = runHookTargets();
        const unsafeTargets = targets.filter(
            (target) => isAbsolute(target) || target.split('/').includes('..')
        );
        const missingTargets = targets
            .filter((target) => !existsSync(resolve(repositoryRoot, target)));

        expect(unsafeTargets).toEqual([]);
        expect(missingTargets).toEqual([]);
    });

    it('SessionStartへ移設済みのreminderをUserPromptSubmitへ戻さない', () => {
        const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
        const commands = (settings.hooks.UserPromptSubmit ?? [])
            .flatMap((entry) => entry.hooks ?? [])
            .map((hook) => hook.command ?? '');

        expect(commands.join('\n')).not.toMatch(
            /ssot-self-assessment|merge-api-reminder|graph-ssot-reminder|capability-map-reminder/u
        );
        expect(commands.join('\n')).toContain('test-enforcer.ts');

        const sessionStartCommands = (settings.hooks.SessionStart ?? [])
            .flatMap((entry) => entry.hooks ?? [])
            .map((hook) => hook.command ?? '');
        expect(sessionStartCommands.join('\n')).toContain('inject-memory-preamble.ts');
    });
});
