import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('minimal device web surface', () => {
    it('is the only production HTML entrypoint and has no legacy UI bundle pipeline', () => {
        const publicDir = path.join(repoRoot, 'public');
        const htmlEntrypoints = fs.readdirSync(publicDir)
            .filter((name) => name.endsWith('.html'))
            .sort();
        const hasFiles = (directory) => fs.existsSync(directory)
            && fs.readdirSync(directory, { recursive: true }).some((entry) =>
                fs.statSync(path.join(directory, entry)).isFile()
            );

        expect(htmlEntrypoints).toEqual(['device.html']);
        expect(hasFiles(path.join(repoRoot, 'ui-islands'))).toBe(false);
        expect(fs.existsSync(path.join(repoRoot, 'scripts/build-ui-islands.mjs'))).toBe(false);
        expect(hasFiles(path.join(publicDir, 'dist'))).toBe(false);

        const start = fs.readFileSync(path.join(repoRoot, 'start.js'), 'utf8');
        const packageJson = fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8');
        expect(start).not.toContain('build-ui-islands');
        expect(packageJson).not.toContain('build:codex-appserver-transcript');
    });

    it('contains only verification, OAuth, consent, and terminal result steps', () => {
        const html = fs.readFileSync(path.join(repoRoot, 'public/device.html'), 'utf8');
        const stepIds = [...html.matchAll(/id="step-([^"]+)"/g)].map((match) => match[1]);

        expect(stepIds).toEqual(['input', 'slack', 'approve', 'success', 'error']);
        expect(html).toContain('/modules/device/device-auth-controller.js');
        expect(html).not.toMatch(/href="\/(?:admin|setup|workflows|sns-growth)/);
        expect(html).not.toMatch(/dashboard|settings|workspace|project list/i);
    });

    it('uses a bearer token and never sends caller-provided Slack identity', () => {
        const controller = fs.readFileSync(
            path.join(repoRoot, 'public/modules/device/device-auth-controller.js'),
            'utf8'
        );

        expect(controller).toContain("'Authorization': `Bearer ${this.authToken}`");
        expect(controller).not.toContain('slack_user_id');
        expect(controller).not.toContain('slack_workspace_id');
        expect(controller).not.toContain("addEventListener('message'");
    });
});
