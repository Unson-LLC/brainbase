import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
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
        for (const subpath of [
            './knowledge-capture-preview', './knowledge-promotion', './knowledge-event', './mesh',
            './honcho', './onboarding-runtime', './mcp-runtime'
        ]) {
            expect(manifest.exports[subpath]).toEqual({
                types: `./dist/${subpath.slice(2)}.d.ts`,
                import: `./dist/${subpath.slice(2)}.js`
            });
            const module = await importExport(manifest, subpath);
            expect(Object.keys(module).length).toBeGreaterThan(0);
        }
        const capture = await importExport(manifest, './knowledge-capture-preview');
        expect(typeof capture.validateCaptureProposal).toBe('function');
        expect(typeof capture.validatePreviewAnswer).toBe('function');
        const promotion = await importExport(manifest, './knowledge-promotion');
        expect(typeof promotion.normalizePromotionPayload).toBe('function');
        expect(typeof promotion.KnowledgePromotionService).toBe('function');
        const mesh = await importExport(manifest, './mesh');
        for (const name of [
            'createMeshEnvelope', 'normalizeMeshEnvelope', 'parseMeshEnvelope',
            'normalizeMeshNodeProfile', 'normalizeMeshQueryRequest', 'createMeshSendReceipt'
        ]) {
            expect(typeof mesh[name]).toBe('function');
        }
    }, 30_000);

    it('publishes run receipt and meeting automation as independent subpaths', async () => {
        const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));

        expect(manifest.exports['./run-receipt']).toEqual({
            types: './dist/run-receipt.d.ts',
            import: './dist/run-receipt.js'
        });
        expect(manifest.exports['./run-receipt-port']).toEqual({
            types: './dist/run-receipt-port.d.ts',
            import: './dist/run-receipt-port.js'
        });
        expect(manifest.exports['./routines']).toEqual({
            types: './dist/routines.d.ts',
            import: './dist/routines.js'
        });
        expect(manifest.exports['./automation-run']).toEqual({
            types: './dist/automation-run.d.ts',
            import: './dist/automation-run.js'
        });
        expect(manifest.exports['./meeting-automation']).toEqual({
            types: './dist/meeting-automation.d.ts',
            import: './dist/meeting-automation.js'
        });
        expect(manifest.exports['./meeting-automation-runtime']).toEqual({
            types: './dist/meeting-automation-runtime.d.ts',
            import: './dist/meeting-automation-runtime.js'
        });
        expect(manifest.exports['./meeting-minutes-context-receipt']).toEqual({
            types: './dist/meeting-minutes-context-receipt.d.ts',
            import: './dist/meeting-minutes-context-receipt.js'
        });
        expect(manifest.exports['./meeting-source-sync']).toEqual({
            types: './dist/meeting-source-sync.d.ts',
            import: './dist/meeting-source-sync.js'
        });
        expect(manifest.exports['./meeting-source-mcp-adapters']).toEqual({
            types: './dist/meeting-source-mcp-adapters.d.ts',
            import: './dist/meeting-source-mcp-adapters.js'
        });
        expect(manifest.exports['./meeting-source-sync-common-adapter']).toEqual({
            types: './dist/meeting-source-sync-common-adapter.d.ts',
            import: './dist/meeting-source-sync-common-adapter.js'
        });

        const runReceipt = await importExport(manifest, './run-receipt');
        expect(typeof runReceipt.normalizeRunReceipt).toBe('function');
        expect(typeof runReceipt.createRunReceiptIdentity).toBe('function');

        const runReceiptPort = await importExport(manifest, './run-receipt-port');
        expect(typeof runReceiptPort.assertRunReceiptPort).toBe('function');

        const routines = await importExport(manifest, './routines');
        expect(typeof routines.buildRoutines).toBe('function');
        expect(typeof routines.parseRoutineExpectations).toBe('function');
        expect(typeof routines.createRoutineRuntime).toBe('function');

        const automationRun = await importExport(manifest, './automation-run');
        expect(typeof automationRun.AutomationRunService).toBe('function');
        expect(typeof automationRun.createAutomationRunService).toBe('function');

        const meetingAutomation = await importExport(manifest, './meeting-automation');
        expect(typeof meetingAutomation.assertMeetingCandidatesInput).toBe('function');
        expect(typeof meetingAutomation.verifyMeetingReviewPackage).toBe('function');

        const meetingAutomationRuntime = await importExport(manifest, './meeting-automation-runtime');
        expect(typeof meetingAutomationRuntime.runMeetingAutomationRuntime).toBe('function');
        const contextReceipt = await importExport(manifest, './meeting-minutes-context-receipt');
        expect(typeof contextReceipt.createMeetingMinutesContextReceipt).toBe('function');
        expect(typeof contextReceipt.readMeetingMinutesContextReceipt).toBe('function');
        const sourceSync = await importExport(manifest, './meeting-source-sync');
        expect(typeof sourceSync.normalizeMeetingSourceArtifact).toBe('function');
        expect(typeof sourceSync.runMeetingSourceSync).toBe('function');
        const sourceAdapters = await importExport(manifest, './meeting-source-mcp-adapters');
        expect(typeof sourceAdapters.MeetingSourceMcpAdapter).toBe('function');
        expect(typeof sourceAdapters.createMeetingSourceMcpAdapter).toBe('function');
        const commonAdapter = await importExport(manifest, './meeting-source-sync-common-adapter');
        expect(typeof commonAdapter.createMeetingSourceSyncCommonAdapter).toBe('function');
    });

    it('keeps onboarding-runtime importable from an isolated package tree', async () => {
        const isolatedRoot = await mkdtemp(path.join(os.tmpdir(), 'brainbase-stage3b-onboarding-'));
        try {
            await cp(path.join(root, 'dist'), path.join(isolatedRoot, 'dist'), { recursive: true });
            await writeFile(path.join(isolatedRoot, 'package.json'), '{"type":"module"}\n');

            const onboarding = await import(
                pathToFileURL(path.join(isolatedRoot, 'dist/onboarding-runtime.js')).href,
            );
            expect(typeof onboarding.normalizeFirstValueRecord).toBe('function');
        } finally {
            await rm(isolatedRoot, { recursive: true, force: true });
        }
    }, 30_000);
});
