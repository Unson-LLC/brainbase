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
        expect(receipt.context.retrieval).toMatchObject({
            mode: 'project_scoped_legacy',
            mention_count: 0,
            gaps: [expect.objectContaining({ code: 'mention_context_unavailable' })]
        });
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

    it('keeps mention-scoped glossary candidates available when decisions would otherwise fill the entity cap', async () => {
        const listGraphEntities = vi.fn(async (_access, options) => {
            if (options.entityType === 'project') return [{ id: 'project:mana', name: 'mana' }];
            if (options.entityType === 'decision') {
                return Array.from({ length: 71 }, (_, index) => ({
                    id: `decision:${index}`,
                    name: `Decision ${index}`
                }));
            }
            if (options.entityType === 'glossary_term' && options.query === 'アイテル') {
                return [
                    ...Array.from({ length: 24 }, (_, index) => ({
                        id: `glossary:other-${index}`,
                        payload: { term: `Other ${index}` }
                    })),
                    { id: 'glossary:other-project', project_code: 'other-project', payload: { term: 'アイテル' } },
                    { id: 'glossary:aitel', payload: { term: 'アイテル', aliases: ['Aitel'] } }
                ];
            }
            return [];
        });
        const service = new MeetingMinutesContextReceiptService({
            infoSSOTService: { listGraphEntities },
            canonicalTaskService: { listTasks: vi.fn().mockResolvedValue({ items: [], read_status: 'complete' }) },
            repository: { put: vi.fn(async (value) => value), get: vi.fn() }
        });

        const receipt = await service.create({
            ...request,
            retrieval_context: {
                mention_candidates: [{
                    surface_form: 'アイテル',
                    entity_types: ['glossary_term'],
                    source_ref: 'slack:C0A489A4EFJ/p1789361153129979',
                    context: '用語の正式表記を確認する'
                }]
            }
        }, actor());

        expect(receipt.status).toBe('resolved');
        expect(receipt.identity).toEqual(request);
        expect(receipt.context.decisions.length).toBeGreaterThanOrEqual(16);
        expect(receipt.context.glossary).toHaveLength(1);
        expect(receipt.context.glossary[0]).toEqual(expect.objectContaining({ id: 'glossary:aitel' }));
        expect(listGraphEntities).toHaveBeenCalledWith(
            expect.any(Object),
            expect.objectContaining({
                projectCode: 'mana',
                entityType: 'glossary_term',
                query: 'アイテル',
                limit: 8
            })
        );
        expect(receipt.context.retrieval).toMatchObject({
            mode: 'mention_scoped',
            mention_count: 1,
            query_count: 1,
            gaps: []
        });
        expect(receipt.searched_scope.retrieval).toMatchObject({
            mode: 'mention_scoped',
            query_count: 1,
            queries: [expect.objectContaining({
                surface_form: 'アイテル',
                entity_type: 'glossary_term',
                result_count: 26,
                matched_result_count: 1,
                status: 'matched'
            })]
        });
        expect(listGraphEntities.mock.calls.every(([, options]) => options.projectCode === 'mana')).toBe(true);
    });

    it('forwards the confirmed actor tenant identity to every scoped Graph query', async () => {
        const listGraphEntities = vi.fn(async (_access, options) => {
            if (options.entityType === 'project') return [{ id: 'project:mana', name: 'mana' }];
            if (options.entityType === 'glossary_term' && options.query === 'アイテル') {
                return [{ id: 'glossary:aitel', name: 'アイテル' }];
            }
            return [];
        });
        const service = new MeetingMinutesContextReceiptService({
            infoSSOTService: { listGraphEntities },
            canonicalTaskService: { listTasks: vi.fn().mockResolvedValue({ items: [], read_status: 'complete' }) },
            repository: { put: vi.fn(async (value) => value), get: vi.fn() }
        });

        await service.create({
            ...request,
            retrieval_context: {
                mention_candidates: [{ surface_form: 'アイテル', entity_types: ['glossary_term'] }]
            }
        }, {
            ...actor(),
            tenant_id: 'tenant-a',
            project_id: 'project-mana'
        });

        expect(listGraphEntities).toHaveBeenCalled();
        expect(listGraphEntities.mock.calls.every(([access, options]) => (
            access.organizationId === 'tenant-a'
            && access.tenantId === 'tenant-a'
            && options.projectCode === 'mana'
        ))).toBe(true);
    });

    it('keeps equally strong glossary matches unresolved when a mention is ambiguous', async () => {
        const listGraphEntities = vi.fn(async (_access, options) => {
            if (options.entityType === 'project') return [{ id: 'project:mana', name: 'mana' }];
            if (options.entityType === 'glossary_term' && options.query === 'アイテル') {
                return [
                    { id: 'glossary:aitel-a', payload: { term: 'アイテル' } },
                    { id: 'glossary:aitel-b', payload: { term: 'アイテル' } }
                ];
            }
            return [];
        });
        const service = new MeetingMinutesContextReceiptService({
            infoSSOTService: { listGraphEntities },
            canonicalTaskService: { listTasks: vi.fn().mockResolvedValue({ items: [], read_status: 'complete' }) },
            repository: { put: vi.fn(async (value) => value), get: vi.fn() }
        });

        const receipt = await service.create({
            ...request,
            retrieval_context: {
                mention_candidates: [{ surface_form: 'アイテル', entity_types: ['glossary_term'] }]
            }
        }, actor());

        expect(receipt.context.glossary).toHaveLength(2);
        expect(receipt.context.retrieval.gaps).toContainEqual(expect.objectContaining({
            code: 'mention_ambiguous',
            surface_form: 'アイテル',
            candidate_ids: expect.arrayContaining(['glossary:aitel-a', 'glossary:aitel-b'])
        }));
        expect(receipt.context.retrieval.gaps).not.toContainEqual(expect.objectContaining({
            code: 'mention_unresolved',
            surface_form: 'アイテル'
        }));
    });

    it('keeps a near-miss glossary result unresolved instead of correcting the transcript surface', async () => {
        const listGraphEntities = vi.fn(async (_access, options) => {
            if (options.entityType === 'project') return [{ id: 'project:mana', name: 'mana' }];
            if (options.entityType === 'glossary_term' && options.query === 'アイテム') {
                return [{ id: 'glossary:aitel', payload: { term: 'アイテル', aliases: ['Aitel'] } }];
            }
            return [];
        });
        const service = new MeetingMinutesContextReceiptService({
            infoSSOTService: { listGraphEntities },
            canonicalTaskService: { listTasks: vi.fn().mockResolvedValue({ items: [], read_status: 'complete' }) },
            repository: { put: vi.fn(async (value) => value), get: vi.fn() }
        });

        const receipt = await service.create({
            ...request,
            retrieval_context: {
                mention_candidates: [{ surface_form: 'アイテム', entity_types: ['glossary_term'] }]
            }
        }, actor());

        expect(receipt.context.glossary).toEqual([]);
        expect(receipt.context.retrieval.gaps).toEqual([
            expect.objectContaining({
                code: 'mention_unresolved',
                surface_form: 'アイテム',
                entity_types: ['glossary_term']
            })
        ]);
        expect(receipt.searched_scope.retrieval.queries).toContainEqual(expect.objectContaining({
            surface_form: 'アイテム',
            entity_type: 'glossary_term',
            result_count: 1,
            matched_result_count: 0,
            status: 'unmatched'
        }));
    });

    it('records an unresolved retrieval gap when a transcript mention has no Graph candidate', async () => {
        const listGraphEntities = vi.fn(async (_access, options) => (
            options.entityType === 'project' ? [{ id: 'project:mana', name: 'mana' }] : []
        ));
        const service = new MeetingMinutesContextReceiptService({
            infoSSOTService: { listGraphEntities },
            canonicalTaskService: { listTasks: vi.fn().mockResolvedValue({ items: [], read_status: 'complete' }) },
            repository: { put: vi.fn(async (value) => value), get: vi.fn() }
        });

        const receipt = await service.create({
            ...request,
            retrieval_context: {
                mention_candidates: [{ surface_form: '存在しない用語', entity_types: ['glossary_term'] }]
            }
        }, actor());

        expect(receipt.status).toBe('resolved');
        expect(receipt.context.glossary).toEqual([]);
        expect(receipt.context.retrieval.gaps).toEqual([
            expect.objectContaining({
                code: 'mention_unresolved',
                surface_form: '存在しない用語',
                entity_types: ['glossary_term']
            })
        ]);
        expect(receipt.searched_scope.retrieval.gaps).toEqual(receipt.context.retrieval.gaps);
    });

    it('rejects explicitly unsupported mention entity types instead of broadening the search', async () => {
        const listGraphEntities = vi.fn();
        const listTasks = vi.fn();
        const repository = { put: vi.fn(), get: vi.fn() };
        const service = new MeetingMinutesContextReceiptService({
            infoSSOTService: { listGraphEntities },
            canonicalTaskService: { listTasks },
            repository
        });

        await expect(service.create({
            ...request,
            retrieval_context: {
                mention_candidates: [{ surface_form: 'アイテル', entity_types: ['decision'] }]
            }
        }, actor())).rejects.toMatchObject({
            code: 'meeting_minutes_context_input_invalid',
            statusCode: 400,
            details: {
                invalid_entity_types: ['decision']
            }
        });
        await expect(service.create({
            ...request,
            retrieval_context: {
                mention_candidates: [{ surface_form: 'アイテル', entity_types: [] }]
            }
        }, actor())).rejects.toMatchObject({
            code: 'meeting_minutes_context_input_invalid',
            statusCode: 400
        });
        expect(listGraphEntities).not.toHaveBeenCalled();
        expect(listTasks).not.toHaveBeenCalled();
        expect(repository.put).not.toHaveBeenCalled();
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

    it('marks a partial Graph base retrieval as partial while retaining successful sources', async () => {
        const listGraphEntities = vi.fn(async (_access, options) => {
            if (options.entityType === 'project') return [{ id: 'project:mana', name: 'mana' }];
            if (options.entityType === 'decision') throw new Error('decision query timeout');
            if (options.entityType === 'document') return [{ id: 'document:approved', status: 'approved' }];
            return [];
        });
        const service = new MeetingMinutesContextReceiptService({
            infoSSOTService: { listGraphEntities },
            canonicalTaskService: { listTasks: vi.fn().mockResolvedValue({ items: [], read_status: 'complete' }) },
            repository: { put: vi.fn(async (value) => value), get: vi.fn() }
        });

        const receipt = await service.create(request, actor());

        expect(receipt.status).toBe('partial');
        expect(receipt.source_status).toEqual({ graph: 'partial', tasks: 'resolved' });
        expect(receipt.context.project).toEqual([expect.objectContaining({ id: 'project:mana' })]);
        expect(receipt.context.retrieval.gaps).toContainEqual(expect.objectContaining({
            code: 'base_entity_query_failed',
            entity_type: 'decision',
            error_code: 'Error'
        }));
        expect(receipt.errors).toEqual([expect.objectContaining({
            source: 'graph',
            code: 'graph_context_partial',
            details: {
                failed_queries: [expect.objectContaining({
                    kind: 'base',
                    entity_type: 'decision',
                    error_code: 'Error'
                })]
            }
        })]);
    });

    it('marks a failed mention search as partial while keeping the retrieval gap explicit', async () => {
        const listGraphEntities = vi.fn(async (_access, options) => {
            if (options.entityType === 'project') return [{ id: 'project:mana', name: 'mana' }];
            if (options.entityType === 'glossary_term' && options.query === 'アイテル') {
                throw new Error('glossary query timeout');
            }
            return [];
        });
        const service = new MeetingMinutesContextReceiptService({
            infoSSOTService: { listGraphEntities },
            canonicalTaskService: { listTasks: vi.fn().mockResolvedValue({ items: [], read_status: 'complete' }) },
            repository: { put: vi.fn(async (value) => value), get: vi.fn() }
        });

        const receipt = await service.create({
            ...request,
            retrieval_context: {
                mention_candidates: [{ surface_form: 'アイテル', entity_types: ['glossary_term'] }]
            }
        }, actor());

        expect(receipt.status).toBe('partial');
        expect(receipt.source_status).toEqual({ graph: 'partial', tasks: 'resolved' });
        expect(receipt.context.retrieval.gaps).toContainEqual(expect.objectContaining({
            code: 'mention_search_failed',
            surface_form: 'アイテル',
            error_codes: ['Error']
        }));
        expect(receipt.errors).toEqual([expect.objectContaining({
            source: 'graph',
            code: 'graph_context_partial',
            details: {
                failed_queries: [expect.objectContaining({
                    kind: 'mention',
                    surface_form: 'アイテル',
                    entity_type: 'glossary_term',
                    error_code: 'Error'
                })]
            }
        })]);
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

    it('scopes persisted receipts by tenant and project', async () => {
        const dir = await mkdtemp(path.join(os.tmpdir(), 'minutes-context-scope-'));
        const repository = new JsonFileMeetingMinutesContextReceiptRepository({
            filePath: path.join(dir, 'receipts.json')
        });
        const service = new MeetingMinutesContextReceiptService({
            infoSSOTService: { getContext: vi.fn().mockResolvedValue({ entities: {}, edges: [], meta: {} }) },
            canonicalTaskService: { listTasks: vi.fn().mockResolvedValue({ items: [], read_status: 'complete' }) },
            repository
        });
        const tenantA = { ...actor(), tenant_id: 'tenant-a', project_id: 'project-mana' };
        const tenantB = { ...actor(), tenant_id: 'tenant-b', project_id: 'project-mana' };

        const receiptA = await service.create(request, tenantA);
        const receiptB = await service.create(request, tenantB);

        expect(receiptA.receipt_id).not.toBe(receiptB.receipt_id);
        await expect(service.get(receiptA.receipt_id, request, tenantB))
            .rejects.toMatchObject({ code: 'meeting_minutes_context_receipt_not_found', statusCode: 404 });
        await expect(service.get(receiptA.receipt_id, request, tenantA)).resolves.toEqual(receiptA);
    });

    it('fails closed before Graph or receipt access when tenant identity claims conflict', async () => {
        const listGraphEntities = vi.fn();
        const repository = {
            put: vi.fn(async (value) => value),
            get: vi.fn(async () => null)
        };
        const service = new MeetingMinutesContextReceiptService({
            infoSSOTService: { listGraphEntities },
            canonicalTaskService: { listTasks: vi.fn() },
            repository
        });
        const conflictingActor = {
            ...actor(),
            organizationId: 'tenant-b',
            tenant_id: 'tenant-a',
            project_id: 'project-mana'
        };

        await expect(service.create(request, conflictingActor)).rejects.toMatchObject({
            code: 'tenant_identity_ambiguous',
            statusCode: 403
        });
        await expect(service.get('receipt-1', request, conflictingActor)).rejects.toMatchObject({
            code: 'tenant_identity_ambiguous',
            statusCode: 403
        });
        expect(listGraphEntities).not.toHaveBeenCalled();
        expect(repository.put).not.toHaveBeenCalled();
        expect(repository.get).not.toHaveBeenCalled();
    });
});
