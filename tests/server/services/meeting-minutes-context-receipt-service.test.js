import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
    JsonFileMeetingMinutesContextReceiptRepository,
    MeetingMinutesContextReceiptService
} from '../../../server/services/meeting-minutes/context-receipt-service.js';

const request = {
    run_id: 'Ev123',
    project_code: 'mana',
    transcript_sha256: 'a'.repeat(64)
};

function actor(projectCodes = ['mana']) {
    return { type: 'service', authType: 'service_token', projectCodes };
}

describe('MeetingMinutesContextReceiptService', () => {
    it('resolves bounded Graph and Canonical Task context into a persistent receipt', async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), 'minutes-context-'));
        const infoSSOTService = {
            getContext: vi.fn().mockResolvedValue({
                entities: {
                    project: [{ id: 'project:mana', name: 'mana' }],
                    person: Array.from({ length: 90 }, (_, index) => ({ id: `person:${index}`, name: `Person ${index}` })),
                    decision: [{ id: 'decision:1', name: 'Cloudflareを正本とする' }],
                    document: Array.from({ length: 5 }, (_, index) => ({
                        id: `document:${index}`,
                        name: `Minutes ${index}`,
                        status: 'approved',
                        updated_at: `2026-08-${String(10 + index).padStart(2, '0')}T00:00:00.000Z`,
                        source_ref: `github:minutes-${index}`
                    }))
                },
                edges: [{ from: 'project:mana', to: 'decision:1', type: 'HAS_DECISION' }],
                meta: { timestamp: '2026-08-15T00:00:00.000Z' }
            })
        };
        const canonicalTaskService = {
            listTasks: vi.fn().mockResolvedValue({
                items: Array.from({ length: 55 }, (_, index) => ({
                    id: `ct1.${index}`,
                    title: `Task ${index}`,
                    status: index === 54 ? 'completed' : 'pending',
                    project_codes: ['mana']
                })),
                read_status: 'complete'
            })
        };
        const repository = new JsonFileMeetingMinutesContextReceiptRepository({
            filePath: path.join(dir, 'receipts.json')
        });
        const service = new MeetingMinutesContextReceiptService({
            infoSSOTService,
            canonicalTaskService,
            repository,
            clock: () => new Date('2026-08-15T01:02:03.000Z')
        });

        const receipt = await service.create(request, actor());

        expect(receipt.status).toBe('resolved');
        expect(receipt.identity).toEqual(request);
        expect(receipt.context.entities).toHaveLength(80);
        expect(receipt.context.open_tasks).toHaveLength(50);
        expect(receipt.context.approved_minutes_refs).toHaveLength(3);
        expect(receipt.context.decisions).toEqual([
            expect.objectContaining({ id: 'decision:1', name: 'Cloudflareを正本とする' })
        ]);
        expect(receipt.checksum).toMatch(/^[a-f0-9]{64}$/);
        expect(Buffer.byteLength(JSON.stringify(receipt), 'utf8')).toBeLessThanOrEqual(128 * 1024);
        expect(infoSSOTService.getContext).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({ includeEdges: false })
        );
        expect(canonicalTaskService.listTasks).toHaveBeenCalledWith(
            expect.objectContaining({ project_code: 'mana' }),
            expect.objectContaining({
                principal: { type: 'service', id: 'meeting-minutes-context-receipt' },
                authSource: 'service-internal',
                auditPrincipal: { type: 'service', id: 'meeting-minutes-context-receipt' },
                auditAuthSource: 'service_token',
                access: expect.objectContaining({
                    projectCodes: ['mana'],
                    clearance: ['internal']
                })
            })
        );
        expect(await service.get(receipt.receipt_id, request, actor())).toEqual(receipt);
        expect(JSON.parse(await readFile(path.join(dir, 'receipts.json'), 'utf8')).receipts).toHaveLength(1);
    });

    it('does not turn a partial source failure into confirmed_empty', async () => {
        const service = new MeetingMinutesContextReceiptService({
            infoSSOTService: { getContext: vi.fn().mockResolvedValue({ entities: {}, edges: [], meta: {} }) },
            canonicalTaskService: { listTasks: vi.fn().mockRejectedValue(new Error('task store timeout')) },
            repository: { put: vi.fn(async (value) => value), get: vi.fn() }
        });

        const receipt = await service.create(request, actor());

        expect(receipt.status).toBe('partial');
        expect(receipt.source_status).toEqual({ graph: 'resolved', tasks: 'unavailable' });
        expect(receipt.errors).toEqual([expect.objectContaining({ source: 'tasks' })]);
    });

    it('fails closed when the receipt identity or project access does not match', async () => {
        const stored = new Map();
        const repository = {
            put: vi.fn(async (value) => { stored.set(value.receipt_id, value); return value; }),
            get: vi.fn(async (id) => stored.get(id) || null)
        };
        const service = new MeetingMinutesContextReceiptService({
            infoSSOTService: { getContext: vi.fn().mockResolvedValue({ entities: {}, edges: [], meta: {} }) },
            canonicalTaskService: { listTasks: vi.fn().mockResolvedValue({ items: [], read_status: 'complete' }) },
            repository
        });
        const receipt = await service.create(request, actor());

        await expect(service.get(receipt.receipt_id, { ...request, run_id: 'wrong' }, actor()))
            .rejects.toMatchObject({ code: 'meeting_minutes_context_identity_mismatch', statusCode: 409 });
        await expect(service.get(receipt.receipt_id, request, actor(['other'])))
            .rejects.toMatchObject({ code: 'project_not_accessible', statusCode: 403 });
    });
});
