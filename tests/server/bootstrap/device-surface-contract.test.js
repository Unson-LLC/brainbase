import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

describe('minimal device web surface', () => {
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
