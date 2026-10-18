import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

const root = process.cwd();

async function importExport(manifest: { exports: Record<string, { import: string }> }, subpath: string) {
    return import(pathToFileURL(path.join(root, manifest.exports[subpath].import)).href);
}

describe('Stage 3 common contract package exports', () => {
    it('publishes the stage 3b host-common contracts as independent subpaths', async () => {
        const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
        for (const subpath of ['./knowledge-event', './mesh', './honcho', './onboarding-runtime', './mcp-runtime']) {
            expect(manifest.exports[subpath]).toEqual({
                types: `./dist/${subpath.slice(2)}.d.ts`,
                import: `./dist/${subpath.slice(2)}.js`
            });
            const module = await importExport(manifest, subpath);
            expect(Object.keys(module).length).toBeGreaterThan(0);
        }
    }, 30_000);

    it('publishes run receipt and meeting automation as independent subpaths', async () => {
        const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

        expect(manifest.exports['./run-receipt']).toEqual({
            types: './dist/run-receipt.d.ts',
            import: './dist/run-receipt.js'
        });
        expect(manifest.exports['./meeting-automation']).toEqual({
            types: './dist/meeting-automation.d.ts',
            import: './dist/meeting-automation.js'
        });

        const runReceipt = await importExport(manifest, './run-receipt');
        expect(typeof runReceipt.normalizeRunReceipt).toBe('function');
        expect(typeof runReceipt.createRunReceiptIdentity).toBe('function');

        const meetingAutomation = await importExport(manifest, './meeting-automation');
        expect(typeof meetingAutomation.assertMeetingCandidatesInput).toBe('function');
        expect(typeof meetingAutomation.verifyMeetingReviewPackage).toBe('function');
    });
});
