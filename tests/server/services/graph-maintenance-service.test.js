import { describe, expect, it, vi } from 'vitest';
import { GraphMaintenanceService } from '../../../server/services/graph-maintenance-service.js';
import { hashGraphSnapshot, validateGraphSnapshot } from '../../../server/services/graph-maintenance-engine.js';

const service = new GraphMaintenanceService({ infoSSOTService: {} });

describe('GraphMaintenanceService authorization', () => {
    it('組織Graphに存在する認可済みproject codeだけを返す', async () => {
        const client = {
            query: vi.fn(async (_sql, values) => {
                expect(values).toEqual(['org_unson', ['aitle', 'brainbase', 'growin-project']]);
                return { rows: [{ code: 'brainbase' }, { code: 'growin-project' }] };
            })
        };
        const scopedService = new GraphMaintenanceService({
            infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) }
        });

        await expect(scopedService.listAccessibleProjectCodes({
            organizationId: 'org_unson', role: 'ceo',
            projectCodes: ['growin-project', 'aitle', 'brainbase']
        })).resolves.toEqual(['brainbase', 'growin-project']);
    });

    it('Validate応答へ識別子を含まないEdge抑止集計を伝播する', async () => {
        const snapshot = {
            project_code: 'brainbase',
            entities: [],
            edges: [],
            suppression_summary: {
                edge_count: 1,
                reasons: { unresolved_or_inaccessible_endpoint: 1 }
            }
        };
        snapshot.hash = hashGraphSnapshot(snapshot);
        const validatingService = new GraphMaintenanceService({
            infoSSOTService: {
                withAccessContext: async (_access, callback) => callback({}),
                validateOntology: vi.fn(() => ({ valid: true }))
            }
        });
        validatingService.loadSnapshot = vi.fn(async () => ({ snapshot }));

        const result = await validatingService.validate({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm'
        }, { projectCode: 'brainbase' });

        expect(result).toMatchObject({
            valid: true,
            snapshot_hash: snapshot.hash,
            suppression_summary: snapshot.suppression_summary
        });
        expect(JSON.stringify(result)).not.toContain('hidden_entity');
    });

    it('Ontology required relationの検証対象をactive local Entityへ限定する', async () => {
        const snapshot = {
            project_code: 'brainbase',
            entities: [
                { id: 'decision_active', entity_type: 'decision', lifecycle_status: 'active', payload: { status: 'decided' } },
                { id: 'decision_retired', entity_type: 'decision', lifecycle_status: 'retired', payload: { status: 'decided' } },
                { id: 'decision_superseded', entity_type: 'decision', lifecycle_status: 'superseded', payload: { status: 'decided' } }
            ],
            external_entities: [
                { id: 'app_external', entity_type: 'app', lifecycle_status: 'active', payload: {} }
            ],
            edges: []
        };
        snapshot.hash = hashGraphSnapshot(snapshot);
        const validateOntology = vi.fn(({ snapshot: ontologySnapshot }) => {
            const targets = new Set(ontologySnapshot.required_relation_validation_entity_ids
                || ontologySnapshot.entities.map((item) => item.id));
            const violations = ontologySnapshot.entities
                .filter((item) => targets.has(item.id))
                .map((item) => ({
                    code: item.type === 'app' ? 'CON-APP-OWNER-001' : 'CON-DECISION-DECIDER-001',
                    entity_id: item.id
                }));
            return { valid: violations.length === 0, violations };
        });
        const validatingService = new GraphMaintenanceService({
            infoSSOTService: {
                withAccessContext: async (_access, callback) => callback({}),
                validateOntology
            }
        });
        validatingService.loadSnapshot = vi.fn(async () => ({ snapshot }));

        const result = await validatingService.validate({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm'
        }, { projectCode: 'brainbase' });

        expect(validateOntology).toHaveBeenCalledWith({ snapshot: expect.objectContaining({
            required_relation_validation_entity_ids: ['decision_active'],
            entities: expect.arrayContaining([
                expect.objectContaining({ id: 'decision_retired' }),
                expect.objectContaining({ id: 'decision_superseded' }),
                expect.objectContaining({ id: 'app_external' })
            ])
        }) });
        expect(result.ontology.violations).toEqual([
            { code: 'CON-DECISION-DECIDER-001', entity_id: 'decision_active' }
        ]);
        expect(result.ontology.violations).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ entity_id: 'decision_retired' }),
            expect.objectContaining({ entity_id: 'decision_superseded' }),
            expect.objectContaining({ entity_id: 'app_external' })
        ]));
        expect(result.required_relation_scope_summary).toEqual({
            included: { active_local_entities: 1 },
            excluded: {
                retired_local_entities: 1,
                superseded_local_entities: 1,
                external_metadata_entities: 1
            }
        });
        expect(JSON.stringify(result.required_relation_scope_summary)).not.toContain('decision_retired');
        expect(JSON.stringify(result.required_relation_scope_summary)).not.toContain('decision_superseded');
        expect(JSON.stringify(result.required_relation_scope_summary)).not.toContain('app_external');
    });

    it('Plan差分はvalidatorのorphan categoryを孤立件数へ集計する', () => {
        const snapshot = {
            project_code: 'brainbase',
            entities: [{ id: 'entity_a', entity_type: 'person', project_code: 'brainbase', payload: {}, version: 1 }],
            edges: [{
                id: 'edge_orphan', from_id: 'entity_a', to_id: 'missing_entity', rel_type: 'knows',
                project_code: 'brainbase', payload: {}, version: 1
            }]
        };
        const plan = service.formatPlan({
            id: 'plan_orphan_count', status: 'planned', snapshot_id: 'snapshot_1',
            base_snapshot_hash: 'before', after_snapshot_hash: 'after', reason: 'count regression',
            idempotency_key: 'count-regression', operations: [], before_snapshot: snapshot,
            after_snapshot: structuredClone(snapshot)
        });

        expect(plan.diff_summary.validation).toMatchObject({
            orphan_count_before: 1,
            orphan_count_after: 1,
            orphan_count_delta: 0
        });
    });

    it('Edge抑止集計をPlan差分・Apply Gate・Receiptへ識別子なしで固定する', async () => {
        const suppression = {
            edge_count: 1,
            reasons: { unresolved_or_inaccessible_endpoint: 1 }
        };
        const before = {
            project_code: 'brainbase',
            entities: [{
                id: 'decision_1', entity_type: 'decision', project_code: 'brainbase',
                payload: { title: 'before' }, version: 1
            }],
            edges: [],
            suppression_summary: suppression
        };
        before.hash = hashGraphSnapshot(before);
        const after = structuredClone(before);
        after.entities[0].payload.title = 'after';
        after.entities[0].version = 2;
        after.hash = hashGraphSnapshot(after);
        const row = {
            id: 'plan_suppression_audit', project_id: 'project_brainbase', status: 'planned',
            snapshot_id: 'snapshot_suppression_audit', base_snapshot_hash: before.hash,
            after_snapshot_hash: after.hash, reason: 'suppression audit', idempotency_key: 'suppression-audit-1',
            operations: [{ operation: 'patch_entity', entity_id: 'decision_1', expected_version: 1, patch: { title: 'after' } }],
            before_snapshot: before, after_snapshot: after
        };
        const expectedTransition = { before: suppression, after: suppression };
        const plan = service.formatPlan(row);

        expect(plan.diff_summary.suppression_summary).toEqual(expectedTransition);
        expect(plan.apply_human_gate_scope.suppression_summary).toEqual(expectedTransition);
        expect(JSON.stringify(plan.diff_summary)).not.toContain('hidden_endpoint_id');
        expect(JSON.stringify(plan.apply_human_gate_scope)).not.toContain('hidden_endpoint_id');

        const client = { query: vi.fn(async (_sql, params) => ({ rows: [{
            receipt_id: params[0], plan_id: params[1], receipt_type: params[4], status: 'completed',
            before_hash: params[5], after_hash: params[6], result: JSON.parse(params[7])
        }] })) };
        const receipt = await service.createReceipt(client, {
            organizationId: 'org_1', personId: 'person_1'
        }, row, 'apply', before.hash, after.hash);

        expect(receipt.result.suppression_summary).toEqual(expectedTransition);
        expect(JSON.stringify(receipt.result)).not.toContain('hidden_endpoint_id');
    });

    it('Project subject metadataを認証済みCatalog正本へ束縛する', async () => {
        const configParser = {
            checkIntegrity: vi.fn(async () => ({ applicability: 'applicable', source: { status: 'loaded' }, summary: { errors: 0 } })),
            getProjects: vi.fn(async () => ({ projects: [{ id: 'ua', name: 'Universal Arts', catalog_version: 3 }] }))
        };
        const catalogService = new GraphMaintenanceService({ infoSSOTService: {}, configParser });
        const bound = await catalogService.bindProjectCatalogOperations({ projectCodes: ['brainbase', 'ua'] }, [{
            operation: 'materialize_project_subject', entity_id: 'forged', catalog_project_id: 'ua',
            catalog_version: 99, name: 'forged', source_ref: 'forged', expected_version: 0
        }]);
        expect(bound[0]).toMatchObject({
            entity_id: 'ua', catalog_project_id: 'ua', catalog_version: 3,
            name: 'Universal Arts', source_ref: 'project-catalog:ua@3'
        });
    });

    it('Catalog欠落・権限外・版なしをdry-run前にfail closedする', async () => {
        const unavailable = new GraphMaintenanceService({ infoSSOTService: {}, configParser: {
            checkIntegrity: vi.fn(async () => ({ applicability: 'applicable', source: { status: 'missing' }, summary: { errors: 1 } }))
        } });
        const operation = [{ operation: 'materialize_project_subject', catalog_project_id: 'ua' }];
        await expect(unavailable.bindProjectCatalogOperations({ projectCodes: ['ua'] }, operation))
            .rejects.toMatchObject({ code: 'GRAPH_PROJECT_CATALOG_UNAVAILABLE', status: 503 });

        const inaccessible = new GraphMaintenanceService({ infoSSOTService: {}, configParser: {
            checkIntegrity: vi.fn(async () => ({ applicability: 'applicable', source: { status: 'loaded' }, summary: { errors: 0 } })),
            getProjects: vi.fn(async () => ({ projects: [{ id: 'ua', name: 'Universal Arts', catalog_version: 1 }] }))
        } });
        await expect(inaccessible.bindProjectCatalogOperations({ projectCodes: ['brainbase'] }, operation))
            .rejects.toMatchObject({ code: 'GRAPH_PROJECT_CATALOG_SUBJECT_INACCESSIBLE', status: 403 });

        const incomplete = new GraphMaintenanceService({ infoSSOTService: {}, configParser: {
            checkIntegrity: vi.fn(async () => ({ applicability: 'applicable', source: { status: 'loaded' }, summary: { errors: 0 } })),
            getProjects: vi.fn(async () => ({ projects: [{ id: 'ua', name: 'Universal Arts' }] }))
        } });
        await expect(incomplete.bindProjectCatalogOperations({ projectCodes: ['ua'] }, operation))
            .rejects.toMatchObject({ code: 'GRAPH_PROJECT_CATALOG_SUBJECT_INVALID', status: 409 });
    });

    it.each([
        {
            name: 'Catalog source missing',
            access: { projectCodes: ['brainbase'] },
            integrity: { applicability: 'applicable', source: { status: 'missing' }, summary: { errors: 0 } },
            projects: [],
            expected: { code: 'GRAPH_PROJECT_CATALOG_UNAVAILABLE', status: 503 }
        },
        {
            name: 'Catalog project missing',
            access: { projectCodes: ['brainbase', 'ua'] },
            integrity: { applicability: 'applicable', source: { status: 'loaded' }, summary: { errors: 0 } },
            projects: [],
            expected: { code: 'GRAPH_PROJECT_CATALOG_SUBJECT_INACCESSIBLE', status: 403 }
        },
        {
            name: 'Catalog grant out',
            access: { projectCodes: ['brainbase'] },
            integrity: { applicability: 'applicable', source: { status: 'loaded' }, summary: { errors: 0 } },
            projects: [{ id: 'ua', name: 'Universal Arts', catalog_version: 1 }],
            expected: { code: 'GRAPH_PROJECT_CATALOG_SUBJECT_INACCESSIBLE', status: 403 }
        },
        {
            name: 'Catalog metadata invalid',
            access: { projectCodes: ['brainbase', 'ua'] },
            integrity: { applicability: 'applicable', source: { status: 'loaded' }, summary: { errors: 0 } },
            projects: [{ id: 'ua', name: '', catalog_version: 1 }],
            expected: { code: 'GRAPH_PROJECT_CATALOG_SUBJECT_INVALID', status: 409 }
        }
    ])('planMutations: $name はPlan INSERTとGraph mutationへ到達しない', async ({ access, integrity, projects, expected }) => {
        const snapshot = { project_code: 'brainbase', entities: [], edges: [] };
        snapshot.hash = hashGraphSnapshot(snapshot);
        const client = {
            query: vi.fn(async (sql) => {
                if (sql.includes('FROM graph_maintenance_snapshots')) {
                    return { rows: [{
                        id: 'snapshot_catalog_guard',
                        project_id: 'project_brainbase',
                        snapshot,
                        snapshot_hash: snapshot.hash
                    }] };
                }
                return { rows: [] };
            })
        };
        const configParser = {
            checkIntegrity: vi.fn(async () => integrity),
            getProjects: vi.fn(async () => ({ projects }))
        };
        const guardedService = new GraphMaintenanceService({
            configParser,
            infoSSOTService: {
                withAccessContext: async (_access, callback) => callback(client)
            }
        });

        await expect(guardedService.planMutations({
            organizationId: 'org_1',
            role: 'gm',
            authSource: 'bearer',
            personId: 'person_1',
            ...access
        }, {
            projectCode: 'brainbase',
            snapshotId: 'snapshot_catalog_guard',
            idempotencyKey: `catalog-guard-${expected.code}`,
            reason: 'Project Catalog guard',
            operations: [{
                operation: 'materialize_project_subject',
                entity_id: 'forged',
                catalog_project_id: 'ua',
                catalog_version: 999,
                name: 'forged',
                source_ref: 'forged',
                expected_version: 0
            }]
        })).rejects.toMatchObject(expected);

        expect(client.query.mock.calls.some(([sql]) => /\b(?:INSERT|UPDATE|DELETE)\b[\s\S]*\b(?:graph_maintenance_plans|graph_entities|graph_edges)\b/i.test(sql))).toBe(false);
        expect(configParser.checkIntegrity).toHaveBeenCalledOnce();
        if (expected.code === 'GRAPH_PROJECT_CATALOG_UNAVAILABLE') {
            expect(configParser.getProjects).not.toHaveBeenCalled();
        } else {
            expect(configParser.getProjects).toHaveBeenCalledOnce();
        }
    });

    it.each([
        {
            name: 'Catalog project missing',
            access: { projectCodes: ['brainbase', 'brainbase-universal-arts-ai-support'] },
            integrity: { applicability: 'applicable', source: { status: 'loaded' }, summary: { errors: 0 } },
            projects: [],
            expected: { code: 'GRAPH_PROJECT_CATALOG_SUBJECT_INACCESSIBLE', status: 403 }
        },
        {
            name: 'Catalog source unavailable',
            access: { projectCodes: ['brainbase', 'brainbase-universal-arts-ai-support'] },
            integrity: { applicability: 'applicable', source: { status: 'unavailable' }, summary: { errors: 0 } },
            projects: [],
            expected: { code: 'GRAPH_PROJECT_CATALOG_UNAVAILABLE', status: 503 }
        },
        {
            name: 'Catalog project archived',
            access: { projectCodes: ['brainbase', 'brainbase-universal-arts-ai-support'] },
            integrity: { applicability: 'applicable', source: { status: 'loaded' }, summary: { errors: 0 } },
            projects: [{ id: 'brainbase-universal-arts-ai-support', name: 'Universal Arts', catalog_version: 1, archived: true }],
            expected: { code: 'GRAPH_PROJECT_CATALOG_SUBJECT_INACCESSIBLE', status: 403 }
        },
        {
            name: 'Catalog grant out',
            access: { projectCodes: ['brainbase'] },
            integrity: { applicability: 'applicable', source: { status: 'loaded' }, summary: { errors: 0 } },
            projects: [{ id: 'brainbase-universal-arts-ai-support', name: 'Universal Arts', catalog_version: 1 }],
            expected: { code: 'GRAPH_PROJECT_CATALOG_SUBJECT_INACCESSIBLE', status: 403 }
        },
        {
            name: 'Catalog version invalid',
            access: { projectCodes: ['brainbase', 'brainbase-universal-arts-ai-support'] },
            integrity: { applicability: 'applicable', source: { status: 'loaded' }, summary: { errors: 0 } },
            projects: [{ id: 'brainbase-universal-arts-ai-support', name: 'Universal Arts', catalog_version: 0 }],
            expected: { code: 'GRAPH_PROJECT_CATALOG_SUBJECT_INVALID', status: 409 }
        },
        {
            name: 'Graph projection provenance/version mismatch',
            access: { projectCodes: ['brainbase', 'brainbase-universal-arts-ai-support'] },
            integrity: { applicability: 'applicable', source: { status: 'loaded' }, summary: { errors: 0 } },
            projects: [{ id: 'brainbase-universal-arts-ai-support', name: 'Universal Arts', catalog_version: 2 }],
            expected: { code: 'GRAPH_PROJECT_CATALOG_SUBJECT_INVALID', status: 409 },
            subjectPayload: {
                name: 'Universal Arts', catalog_project_id: 'brainbase-universal-arts-ai-support',
                catalog_version: 1, source_ref: 'project-catalog:brainbase-universal-arts-ai-support@1'
            }
        }
    ])('link_decision_project_subject: $name はPlan INSERTとGraph mutationへ到達しない', async ({
        access, integrity, projects, expected, subjectPayload
    }) => {
        const subjectId = 'brainbase-universal-arts-ai-support';
        const snapshot = {
            project_code: 'brainbase',
            entities: [
                {
                    id: 'decision_1', entity_type: 'decision', project_code: 'brainbase', payload: {},
                    role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1
                },
                {
                    id: subjectId, entity_type: 'project', project_code: 'brainbase',
                    payload: subjectPayload || {
                        name: 'Universal Arts', catalog_project_id: subjectId,
                        catalog_version: 1, source_ref: `project-catalog:${subjectId}@1`
                    },
                    role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1
                }
            ],
            edges: []
        };
        snapshot.hash = hashGraphSnapshot(snapshot);
        const client = {
            query: vi.fn(async (sql) => {
                if (sql.includes('FROM graph_maintenance_snapshots')) {
                    return { rows: [{
                        id: 'snapshot_project_subject_catalog_guard',
                        project_id: 'project_brainbase', snapshot, snapshot_hash: snapshot.hash
                    }] };
                }
                return { rows: [] };
            })
        };
        const configParser = {
            checkIntegrity: vi.fn(async () => integrity),
            getProjects: vi.fn(async () => ({ projects }))
        };
        const guardedService = new GraphMaintenanceService({
            configParser,
            infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) }
        });

        await expect(guardedService.planMutations({
            organizationId: 'org_1', role: 'gm', authSource: 'bearer', personId: 'person_1', ...access
        }, {
            projectCode: 'brainbase', snapshotId: 'snapshot_project_subject_catalog_guard',
            idempotencyKey: `project-subject-catalog-guard-${expected.code}-${expected.status}`,
            reason: 'Project Catalog link guard', humanGateReceipt: 'gate_project_subject', operations: [{
                operation: 'link_decision_project_subject', decision_id: 'decision_1', decision_expected_version: 1,
                subject_entity_id: subjectId, subject_expected_version: 1,
                target_project_code: 'brainbase', expected_version: 0
            }]
        })).rejects.toMatchObject(expected);

        expect(client.query.mock.calls.some(([sql]) => /\b(?:INSERT|UPDATE|DELETE)\b[\s\S]*\b(?:graph_maintenance_plans|graph_entities|graph_edges)\b/i.test(sql))).toBe(false);
        expect(configParser.checkIntegrity).toHaveBeenCalledOnce();
        if (expected.code === 'GRAPH_PROJECT_CATALOG_UNAVAILABLE') {
            expect(configParser.getProjects).not.toHaveBeenCalled();
        } else {
            expect(configParser.getProjects).toHaveBeenCalledOnce();
        }
    });

    it('署名tenant、project scope、gm以上を必須にする', () => {
        expect(() => service.assertMaintenanceAccess({ role: 'gm', projectCodes: ['brainbase'] }, 'brainbase'))
            .toThrow('Signed tenant authorization');
        expect(() => service.assertMaintenanceAccess({ role: 'gm', projectCodes: ['other'], organizationId: 'org_1' }, 'brainbase'))
            .toThrow('Access denied for project');
        expect(() => service.assertMaintenanceAccess({ role: 'member', projectCodes: ['brainbase'], organizationId: 'org_1' }, 'brainbase'))
            .toThrow('requires gm or ceo');
        expect(() => service.assertMaintenanceAccess({ role: 'gm', projectCodes: ['brainbase'], organizationId: 'org_1' }, 'brainbase'))
            .not.toThrow();
    });

    it('cross-tenant subjectはCEOと双方project scopeを要求しtarget最小行だけを読む', async () => {
        const target = { id: 'product_aitle', entity_type: 'product', project_code: 'aitle', organization_id: 'techknight', role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 4 };
        const client = { query: vi.fn(async () => ({ rows: [target] })) };
        const operations = [{ operation: 'link_decision_subject', subject_entity_id: 'product_aitle', target_project_code: 'aitle' }];
        await expect(service.loadExternalEntities(client, {
            organizationId: 'org_unson', projectCodes: ['brainbase', 'aitle'], role: 'gm'
        }, operations)).rejects.toThrow('requires ceo role');
        await expect(service.loadExternalEntities(client, {
            organizationId: 'org_unson', projectCodes: ['brainbase'], role: 'ceo'
        }, operations)).rejects.toThrow('Access denied for target project scope');
        await expect(service.loadExternalEntities(client, {
            organizationId: 'org_unson', projectCodes: ['brainbase', 'aitle'], role: 'ceo'
        }, operations, { lock: true })).resolves.toEqual([target]);
        const [sql, params] = client.query.mock.calls.at(-1);
        expect(sql).toContain('p.code=ANY($2::text[])');
        expect(sql).toContain('p.organization_id IS NOT NULL');
        expect(sql).toContain('FOR UPDATE');
        expect(params).toEqual([['product_aitle'], ['aitle']]);
    });

    it('cross-tenant subject planはHuman Gateを検証しtarget payloadを複製せずEdge 1件だけをdry-runする', async () => {
        const snapshot = {
            project_code: 'brainbase',
            entities: [{ id: 'decision_1', entity_type: 'decision', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 2 }],
            edges: []
        };
        const snapshotHash = hashGraphSnapshot(snapshot);
        snapshot.hash = snapshotHash;
        const stored = { id: 'gms_1', project_id: 'project_brainbase', snapshot, snapshot_hash: snapshotHash };
        const target = { id: 'product_aitle', entity_type: 'product', project_code: 'aitle', role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 4 };
        const client = { query: vi.fn(async (sql, params) => {
            if (sql.includes('FROM graph_maintenance_snapshots')) return { rows: [stored] };
            if (sql.includes('SELECT id FROM graph_edges')) return { rows: [] };
            if (sql.includes('SELECT ge.id, ge.entity_type')) return { rows: [target] };
            if (sql.includes('FROM graph_maintenance_human_gate_receipts')) return { rows: [{
                id: 'gate_1',
                evidence: { operation_scope: {
                    operation: 'link_decision_subject', decision_id: 'decision_1', decision_expected_version: 2,
                    subject_entity_id: 'product_aitle', subject_expected_version: 4,
                    target_project_code: 'aitle', expected_version: 0
                } }
            }] };
            if (sql.includes('SELECT * FROM graph_maintenance_plans')) return { rows: [] };
            if (sql.includes('INSERT INTO graph_maintenance_plans')) return { rows: [{
                id: params[0], project_id: params[2], snapshot_id: params[3], base_snapshot_hash: params[4],
                after_snapshot_hash: params[5], idempotency_key: params[6], input_fingerprint: params[7],
                reason: params[8], operations: JSON.parse(params[9]), before_snapshot: JSON.parse(params[10]),
                after_snapshot: JSON.parse(params[11]), status: 'planned'
            }] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const planService = new GraphMaintenanceService({ infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) } });
        const plan = await planService.planMutations({
            organizationId: 'org_unson', projectCodes: ['brainbase', 'aitle'], role: 'ceo', personId: 'person_1'
        }, {
            projectCode: 'brainbase', snapshotId: 'gms_1', idempotencyKey: 'subject-plan-1', reason: 'Aitle subject link',
            humanGateReceipt: 'gate_1', operations: [{
                operation: 'link_decision_subject', decision_id: 'decision_1', decision_expected_version: 2,
                subject_entity_id: 'product_aitle', subject_expected_version: 4, target_project_code: 'aitle', expected_version: 0
            }]
        });
        expect(plan.dry_run).toBe(true);
        expect(plan.before.external_entities).toEqual([target]);
        expect(plan.before.external_entities[0]).not.toHaveProperty('payload');
        expect(plan.after.edges).toEqual([expect.objectContaining({
            from_id: 'decision_1', to_id: 'product_aitle', rel_type: 'governs', project_code: 'brainbase'
        })]);
        expect(plan.after.entities).toEqual(snapshot.entities);
        expect(client.query.mock.calls.some(([sql]) => /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?graph_(?:entities|edges)/i.test(sql))).toBe(false);
        expect(plan.diff_summary).toMatchObject({
            entities: { added_count: 0, removed_count: 0, modified_count: 0, truncated: false },
            edges: {
                added_count: 1, removed_count: 0, modified_count: 0, truncated: false,
                added: [expect.objectContaining({ from_id: 'decision_1', to_id: 'product_aitle', rel_type: 'governs' })]
            },
            validation: { issue_count_delta: 0, orphan_count_delta: 0 }
        });
        expect(validateGraphSnapshot(plan.after)).toMatchObject({ valid: true, issues: [] });
    });

    it('target project全体を含むsnapshotではDecision subject planを作成せずpayload露出を防ぐ', async () => {
        const snapshot = {
            project_code: 'brainbase',
            entities: [
                { id: 'decision_1', entity_type: 'decision', project_code: 'brainbase', payload: {}, version: 2 },
                { id: 'product_aitle', entity_type: 'product', project_code: 'aitle', payload: { confidential: 'must-not-leak' }, version: 4 }
            ],
            edges: [{ id: 'aitle_private_edge', from_id: 'product_aitle', to_id: 'aitle_private', rel_type: 'contains', project_code: 'aitle', payload: { confidential: true }, version: 1 }]
        };
        snapshot.hash = hashGraphSnapshot(snapshot);
        const client = { query: vi.fn(async (sql, params = []) => {
            if (sql.includes('FROM graph_maintenance_snapshots')) return { rows: [{
                project_id: 'project_brainbase', snapshot, snapshot_hash: snapshot.hash
            }] };
            throw new Error(`query must not run after snapshot scope rejection: ${sql}`);
        }) };
        const scopedService = new GraphMaintenanceService({ infoSSOTService: {
            withAccessContext: async (_access, callback) => callback(client)
        } });
        await expect(scopedService.planMutations({
            organizationId: 'org_unson', projectCodes: ['brainbase', 'aitle'], role: 'ceo'
        }, {
            projectCode: 'brainbase', snapshotId: 'gms_composite', idempotencyKey: 'subject-plan-composite', reason: 'reject composite image',
            operations: [{
                operation: 'link_decision_subject', decision_id: 'decision_1', decision_expected_version: 2,
                subject_entity_id: 'product_aitle', subject_expected_version: 4, target_project_code: 'aitle', expected_version: 0
            }]
        })).rejects.toMatchObject({ code: 'GRAPH_CROSS_TENANT_SNAPSHOT_SCOPE_MISMATCH', status: 409 });
        expect(client.query).toHaveBeenCalledTimes(1);
    });

    it('Decision subjectのHuman Gateは承認したtargetとversionへ束縛する', async () => {
        const operation = {
            operation: 'link_decision_subject', decision_id: 'decision_1', decision_expected_version: 2,
            subject_entity_id: 'product_aitle', subject_expected_version: 4,
            target_project_code: 'aitle', expected_version: 0
        };
        const snapshot = { project_code: 'brainbase', entities: [{
            id: 'decision_1', entity_type: 'decision', project_code: 'brainbase', payload: {},
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 2
        }], edges: [] };
        snapshot.hash = hashGraphSnapshot(snapshot);
        const client = { query: vi.fn(async (sql, params = []) => {
            if (sql.includes('FROM graph_maintenance_snapshots')) return { rows: [{ project_id: 'project_brainbase', snapshot, snapshot_hash: snapshot.hash }] };
            if (sql.includes('SELECT id FROM graph_edges')) return { rows: [] };
            if (sql.includes('SELECT ge.id, ge.entity_type')) return { rows: [{ id: 'product_aitle', entity_type: 'product', project_code: 'aitle', lifecycle_status: 'active', version: 4 }] };
            if (sql.includes('FROM graph_maintenance_human_gate_receipts')) return { rows: [{ id: 'gate_1', evidence: { operation_scope: { ...operation, subject_expected_version: 3 } } }] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const boundService = new GraphMaintenanceService({ infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) } });
        await expect(boundService.planMutations({
            organizationId: 'org_unson', projectCodes: ['brainbase', 'aitle'], role: 'ceo'
        }, {
            projectCode: 'brainbase', snapshotId: 'gms_1', idempotencyKey: 'subject-plan-mismatch',
            reason: 'mismatch', humanGateReceipt: 'gate_1', operations: [operation]
        })).rejects.toMatchObject({ code: 'GRAPH_HUMAN_GATE_SCOPE_MISMATCH', status: 409 });
    });

    it('Decision subjectのHuman Gate scope欠損は構造化409で拒否する', async () => {
        const operation = {
            operation: 'link_decision_subject', decision_id: 'decision_1', decision_expected_version: 2,
            subject_entity_id: 'product_aitle', subject_expected_version: 4,
            target_project_code: 'aitle', expected_version: 0
        };
        const snapshot = { project_code: 'brainbase', entities: [{
            id: 'decision_1', entity_type: 'decision', project_code: 'brainbase', payload: {},
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 2
        }], edges: [] };
        snapshot.hash = hashGraphSnapshot(snapshot);
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('FROM graph_maintenance_snapshots')) return { rows: [{ project_id: 'project_brainbase', snapshot, snapshot_hash: snapshot.hash }] };
            if (sql.includes('SELECT id FROM graph_edges')) return { rows: [] };
            if (sql.includes('SELECT ge.id, ge.entity_type')) return { rows: [{ id: 'product_aitle', entity_type: 'product', project_code: 'aitle', lifecycle_status: 'active', version: 4 }] };
            if (sql.includes('FROM graph_maintenance_human_gate_receipts')) return { rows: [{ id: 'gate_1', evidence: {} }] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const boundService = new GraphMaintenanceService({ infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) } });
        await expect(boundService.planMutations({
            organizationId: 'org_unson', projectCodes: ['brainbase', 'aitle'], role: 'ceo'
        }, {
            projectCode: 'brainbase', snapshotId: 'gms_1', idempotencyKey: 'subject-plan-missing-scope',
            reason: 'missing scope', humanGateReceipt: 'gate_1', operations: [operation]
        })).rejects.toMatchObject({
            code: 'GRAPH_HUMAN_GATE_SCOPE_MISMATCH', status: 409,
            details: { expected_operation_scope: operation }
        });
    });

    it('AC-005 INV-002 external endpoint version drift changes composite snapshot hash', async () => {
        const planned = {
            project_code: 'brainbase', entities: [], edges: [],
            external_entities: [{ id: 'product_aitle', entity_type: 'product', project_code: 'aitle', role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 4 }]
        };
        const client = { query: vi.fn(async () => ({ rows: [{ ...planned.external_entities[0], version: 5 }] })) };
        const current = structuredClone(planned);
        current.external_entities = await service.loadExternalEntitiesFromImage(client, {
            organizationId: 'org_unson', projectCodes: ['brainbase', 'aitle'], role: 'ceo'
        }, planned, { lock: true });
        expect(hashGraphSnapshot(current)).not.toBe(hashGraphSnapshot(planned));
        expect(client.query.mock.calls[0][0]).toContain('FOR UPDATE');
    });

    it('既存cross-tenant targetを保持したまま別targetをPlanの複合hashへ追加する', async () => {
        const existing = {
            id: 'product_existing', entity_type: 'product', project_code: 'existing',
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 3
        };
        const added = {
            id: 'product_added', entity_type: 'product', project_code: 'added', organization_id: 'org_added',
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 7
        };
        const snapshot = {
            project_code: 'brainbase',
            entities: [{ id: 'decision_1', entity_type: 'decision', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 2 }],
            edges: [{ id: 'edge_existing', from_id: 'decision_1', to_id: existing.id, rel_type: 'governs', project_code: 'brainbase', payload: { cross_tenant: true, target_project_code: 'existing' }, role_min: 'ceo', sensitivity: 'restricted', lifecycle_status: 'active', version: 1 }],
            external_entities: [existing]
        };
        snapshot.hash = hashGraphSnapshot(snapshot);
        const stored = { id: 'snapshot_1', project_id: 'project_brainbase', snapshot, snapshot_hash: snapshot.hash };
        const operation = {
            operation: 'link_decision_subject', decision_id: 'decision_1', decision_expected_version: 2,
            subject_entity_id: added.id, subject_expected_version: 7, target_project_code: 'added',
            edge_id: 'edge_added', expected_version: 0, human_gate_receipt: 'gate_added'
        };
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('FROM graph_maintenance_snapshots')) return { rows: [stored] };
            if (sql.includes('SELECT id FROM graph_edges')) return { rows: [] };
            if (sql.includes('SELECT ge.id, ge.entity_type')) return { rows: [added] };
            if (sql.includes('FROM graph_maintenance_human_gate_receipts')) return { rows: [{ evidence: { operation_scope: {
                operation: operation.operation, decision_id: operation.decision_id,
                decision_expected_version: operation.decision_expected_version,
                subject_entity_id: operation.subject_entity_id,
                subject_expected_version: operation.subject_expected_version,
                target_project_code: operation.target_project_code,
                expected_version: operation.expected_version
            } } }] };
            if (sql.includes('FROM graph_maintenance_plans')) return { rows: [] };
            if (sql.includes('INSERT INTO graph_maintenance_plans')) return { rows: [{
                id: 'plan_added', status: 'planned', snapshot_id: stored.id,
                base_snapshot_hash: snapshot.hash, after_snapshot_hash: 'after', reason: 'add subject',
                idempotency_key: 'add-subject', operations: [operation], before_snapshot: snapshot,
                after_snapshot: { ...snapshot, external_entities: [existing, added] }
            }] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const planningService = new GraphMaintenanceService({ infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) } });
        const plan = await planningService.planMutations({
            organizationId: 'org_source', projectCodes: ['brainbase', 'existing', 'added'], role: 'ceo'
        }, { projectCode: 'brainbase', snapshotId: stored.id, idempotencyKey: 'add-subject', reason: 'add subject', operations: [operation] });
        const insertedSnapshot = JSON.parse(client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO graph_maintenance_plans'))[1][11]);
        expect(insertedSnapshot.external_entities.map((entity) => entity.id)).toEqual(['product_added', 'product_existing']);
        expect(plan.plan_id).toBe('plan_added');
    });

    it.each([
        ['applyPlan', 'planned', 'apply', 'snapshot hash conflict'],
        ['rollbackPlan', 'applied', 'rollback', 'rollback snapshot hash conflict']
    ])('%sはexternal endpointのversion drift時に書込みとReceipt作成を行わない', async (method, status, receiptType, message) => {
        const local = { project_code: 'brainbase', entities: [{ id: 'decision_1', entity_type: 'decision', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 2 }], edges: [] };
        const external = { id: 'product_aitle', entity_type: 'product', project_code: 'aitle', role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 4 };
        const before = { ...structuredClone(local), external_entities: [external] };
        before.hash = hashGraphSnapshot(before);
        const after = structuredClone(before);
        after.edges.push({ id: 'edge_subject', from_id: 'decision_1', to_id: 'product_aitle', rel_type: 'governs', project_code: 'brainbase', payload: { target_project_code: 'aitle', cross_tenant: true }, role_min: 'ceo', sensitivity: 'restricted', lifecycle_status: 'active', version: 1 });
        after.hash = hashGraphSnapshot(after);
        const plan = {
            id: 'plan_drift', project_id: 'project_brainbase', organization_id: 'org_unson', project_code: 'brainbase', status,
            operations: [{ operation: 'link_decision_subject' }], reason: 'drift test', idempotency_key: 'drift-1',
            base_snapshot_hash: before.hash, after_snapshot_hash: after.hash, before_snapshot: before, after_snapshot: after
        };
        const client = { query: vi.fn(async (sql, params) => {
            if (sql.includes('FROM graph_maintenance_plans')) return { rows: [plan] };
            if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [] };
            if (sql.includes('FROM graph_maintenance_receipts')) {
                if (method === 'rollbackPlan' && params[1] === 'apply') return { rows: [{ receipt_id: 'apply_1' }] };
                return { rows: [] };
            }
            throw new Error(`mutation query must not run: ${sql}`);
        }) };
        const driftService = new GraphMaintenanceService({ infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) } });
        vi.spyOn(driftService, 'loadSnapshot').mockResolvedValue({ snapshot: { ...structuredClone(local), hash: hashGraphSnapshot(local) } });
        vi.spyOn(driftService, 'loadExternalEntitiesFromImage').mockResolvedValue([{ ...external, version: 5 }]);
        const replace = vi.spyOn(driftService, 'replaceSnapshot');
        const createReceipt = vi.spyOn(driftService, 'createReceipt');
        const access = { organizationId: 'org_unson', projectCodes: ['brainbase', 'aitle'], role: 'ceo' };
        const input = method === 'applyPlan'
            ? { projectCode: 'brainbase', planId: 'plan_drift', snapshotHash: before.hash }
            : { projectCode: 'brainbase', planId: 'plan_drift', applyReceiptId: 'apply_1' };
        await expect(driftService[method](access, input)).rejects.toThrow(message);
        expect(replace).not.toHaveBeenCalled();
        expect(createReceipt).not.toHaveBeenCalled();
        expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO graph_maintenance_receipts'))).toBe(false);
        expect(receiptType).toBe(method === 'applyPlan' ? 'apply' : 'rollback');
    });

    const expectPlanIdentityLocksBeforeRowLock = async (method, input) => {
        const plan = {
            id: 'plan_lock_order', project_id: 'project_brainbase', organization_id: 'org_1',
            project_code: 'brainbase', status: method === 'applyPlan' ? 'planned' : 'applied',
            before_snapshot: { project_code: 'brainbase', entities: [{ id: 'entity_z' }], edges: [] },
            after_snapshot: { project_code: 'brainbase', entities: [{ id: 'entity_a' }, { id: 'entity_z' }], edges: [] }
        };
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('FROM graph_maintenance_plans')) {
                if (sql.includes('FOR UPDATE')) throw new Error('stop after plan row lock');
                return { rows: [plan] };
            }
            if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const lockOrderService = new GraphMaintenanceService({
            infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) }
        });

        await expect(lockOrderService[method]({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm'
        }, input)).rejects.toThrow('stop after plan row lock');

        const lockCalls = client.query.mock.calls
            .filter(([sql]) => sql.includes('pg_try_advisory_xact_lock'));
        expect(lockCalls.map(([, params]) => params[0])).toEqual([
            'brainbase:project-graph-identity:entity_a',
            'brainbase:project-graph-identity:entity_z'
        ]);
        const rowLockIndex = client.query.mock.calls.findIndex(([sql]) => (
            sql.includes('FROM graph_maintenance_plans') && sql.includes('FOR UPDATE')
        ));
        const finalIdentityLockIndex = client.query.mock.calls.reduce((last, [sql], index) => (
            sql.includes('pg_try_advisory_xact_lock') ? index : last
        ), -1);
        expect(finalIdentityLockIndex).toBeLessThan(rowLockIndex);
    };

    it('applyPlanはplan行をロックする前に全entity IDを昇順でロックする', async () => {
        await expectPlanIdentityLocksBeforeRowLock('applyPlan', {
            projectCode: 'brainbase', planId: 'plan_lock_order', snapshotHash: 'before'
        });
    });

    it('rollbackPlanはplan行をロックする前に全entity IDを昇順でロックする', async () => {
        await expectPlanIdentityLocksBeforeRowLock('rollbackPlan', {
            projectCode: 'brainbase', planId: 'plan_lock_order', applyReceiptId: 'apply_1'
        });
    });

    it('applyPlanはidentity lock後にplanのentity集合が変わった場合は書込前に拒否する', async () => {
        const preliminaryPlan = {
            id: 'plan_scope_drift', project_id: 'project_brainbase', organization_id: 'org_1',
            project_code: 'brainbase', status: 'planned',
            before_snapshot: { project_code: 'brainbase', entities: [{ id: 'entity_a' }], edges: [] },
            after_snapshot: { project_code: 'brainbase', entities: [{ id: 'entity_a' }], edges: [] }
        };
        const lockedPlan = structuredClone(preliminaryPlan);
        lockedPlan.after_snapshot.entities = [{ id: 'entity_b' }];
        let planReads = 0;
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('FROM graph_maintenance_plans')) {
                planReads += 1;
                return { rows: [planReads === 1 ? preliminaryPlan : lockedPlan] };
            }
            if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [] };
            throw new Error(`mutation query must not run: ${sql}`);
        }) };
        const scopeDriftService = new GraphMaintenanceService({
            infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) }
        });

        await expect(scopeDriftService.applyPlan({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm'
        }, {
            projectCode: 'brainbase', planId: 'plan_scope_drift', snapshotHash: 'before'
        })).rejects.toThrow('plan identity scope changed before lock');
        expect(client.query.mock.calls.filter(([sql]) => sql.includes('pg_try_advisory_xact_lock')))
            .toHaveLength(1);
    });

    it('複数Decisionを含むPlanはDecision集合に束縛した単一Human Gateで原子的にApplyする', async () => {
        const before = {
            project_code: 'brainbase',
            entities: ['decision_1', 'decision_2'].map((id) => ({
                id, entity_type: 'decision', project_code: 'brainbase', payload: {}, role_min: 'member',
                sensitivity: 'internal', lifecycle_status: 'active', version: 1
            })),
            edges: []
        };
        before.hash = hashGraphSnapshot(before);
        const after = structuredClone(before);
        after.entities.forEach((entity) => { entity.lifecycle_status = 'retired'; entity.version = 2; });
        after.hash = hashGraphSnapshot(after);
        const plan = {
            id: 'plan_two_decisions', project_id: 'project_brainbase', organization_id: 'org_1',
            project_code: 'brainbase', status: 'planned', base_snapshot_hash: before.hash,
            after_snapshot_hash: after.hash, before_snapshot: before, after_snapshot: after,
            operations: before.entities.map((entity) => ({
                operation: 'retire_entity', entity_id: entity.id, expected_version: 1
            }))
        };
        const operationScope = {
            operation: 'apply_plan', decision_id: 'decision_1', decision_ids: ['decision_1', 'decision_2'],
            plan_id: plan.id, base_snapshot_hash: before.hash, after_snapshot_hash: after.hash,
            operations_fingerprint: expect.stringMatching(/^sha256:/), diff_fingerprint: expect.stringMatching(/^sha256:/)
        };
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('FROM graph_maintenance_plans')) return { rows: [plan] };
            if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [] };
            if (sql.includes('FROM graph_maintenance_receipts')) return { rows: [] };
            if (sql.includes('FROM graph_maintenance_human_gate_receipts')) return { rows: [{
                id: 'gate_multi', evidence: { operation_scope: multiDecisionService.formatPlan(plan).apply_human_gate_scope }
            }] };
            if (sql.includes('UPDATE graph_maintenance_plans')) return { rows: [] };
            throw new Error(`mutation query must not run: ${sql}`);
        }) };
        const multiDecisionService = new GraphMaintenanceService({
            infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) }
        });
        vi.spyOn(multiDecisionService, 'loadSnapshot')
            .mockResolvedValueOnce({ snapshot: before })
            .mockResolvedValueOnce({ snapshot: after });
        vi.spyOn(multiDecisionService, 'replaceSnapshot').mockResolvedValue(undefined);
        vi.spyOn(multiDecisionService, 'createReceipt').mockResolvedValue({ receipt_id: 'apply_multi' });
        expect(multiDecisionService.formatPlan(plan).apply_human_gate_scope).toMatchObject(operationScope);
        await expect(multiDecisionService.applyPlan({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm',
            authSource: 'bearer', personId: 'person_1'
        }, {
            projectCode: 'brainbase', planId: plan.id, snapshotHash: before.hash,
            humanGateReceipt: 'gate_multi'
        })).resolves.toEqual({ receipt_id: 'apply_multi' });
        expect(multiDecisionService.replaceSnapshot).toHaveBeenCalledOnce();
    });

    it('旧単一Decision Human Gate scopeを単一Decision Planで互換受理する', async () => {
        const before = { project_code: 'brainbase', entities: [{
            id: 'decision_1', entity_type: 'decision', project_code: 'brainbase', payload: {}, role_min: 'member',
            sensitivity: 'internal', lifecycle_status: 'active', version: 1
        }], edges: [] };
        before.hash = hashGraphSnapshot(before);
        const after = structuredClone(before);
        after.entities[0].lifecycle_status = 'retired';
        after.entities[0].version = 2;
        after.hash = hashGraphSnapshot(after);
        const plan = {
            id: 'plan_legacy_single', project_id: 'project_brainbase', organization_id: 'org_1',
            project_code: 'brainbase', status: 'planned', base_snapshot_hash: before.hash,
            after_snapshot_hash: after.hash, before_snapshot: before, after_snapshot: after,
            operations: [{ operation: 'retire_entity', entity_id: 'decision_1', expected_version: 1 }]
        };
        const service = new GraphMaintenanceService({ infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) } });
        const legacyScope = { ...service.formatPlan(plan).apply_human_gate_scope };
        delete legacyScope.decision_ids;
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('FROM graph_maintenance_plans')) return { rows: [plan] };
            if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [] };
            if (sql.includes('FROM graph_maintenance_receipts')) return { rows: [] };
            if (sql.includes('FROM graph_maintenance_human_gate_receipts')) return { rows: [{ id: 'gate_legacy', evidence: { operation_scope: legacyScope } }] };
            if (sql.includes('UPDATE graph_maintenance_plans')) return { rows: [] };
            throw new Error(`mutation query must not run: ${sql}`);
        }) };
        vi.spyOn(service, 'loadSnapshot').mockResolvedValueOnce({ snapshot: before }).mockResolvedValueOnce({ snapshot: after });
        vi.spyOn(service, 'replaceSnapshot').mockResolvedValue(undefined);
        vi.spyOn(service, 'createReceipt').mockResolvedValue({ receipt_id: 'apply_legacy' });
        await expect(service.applyPlan({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', planId: plan.id, snapshotHash: before.hash, humanGateReceipt: 'gate_legacy' }))
            .resolves.toEqual({ receipt_id: 'apply_legacy' });
    });

    it('旧単一Decision Human Gate scopeを複数Decision Planへ拡張しない', async () => {
        const before = { project_code: 'brainbase', entities: ['decision_1', 'decision_2'].map((id) => ({
            id, entity_type: 'decision', project_code: 'brainbase', payload: {}, role_min: 'member',
            sensitivity: 'internal', lifecycle_status: 'active', version: 1
        })), edges: [] };
        before.hash = hashGraphSnapshot(before);
        const after = structuredClone(before);
        after.entities.forEach((entity) => { entity.lifecycle_status = 'retired'; entity.version = 2; });
        after.hash = hashGraphSnapshot(after);
        const plan = {
            id: 'plan_legacy_multi', project_id: 'project_brainbase', organization_id: 'org_1',
            project_code: 'brainbase', status: 'planned', base_snapshot_hash: before.hash,
            after_snapshot_hash: after.hash, before_snapshot: before, after_snapshot: after,
            operations: before.entities.map((entity) => ({ operation: 'retire_entity', entity_id: entity.id, expected_version: 1 }))
        };
        let legacyScope;
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('FROM graph_maintenance_plans')) return { rows: [plan] };
            if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [] };
            if (sql.includes('FROM graph_maintenance_receipts')) return { rows: [] };
            if (sql.includes('FROM graph_maintenance_human_gate_receipts')) return { rows: [{ id: 'gate_legacy', evidence: { operation_scope: legacyScope } }] };
            throw new Error(`mutation query must not run: ${sql}`);
        }) };
        const service = new GraphMaintenanceService({ infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) } });
        legacyScope = { ...service.formatPlan(plan).apply_human_gate_scope };
        delete legacyScope.decision_ids;
        vi.spyOn(service, 'loadSnapshot').mockResolvedValue({ snapshot: before });
        const replaceSnapshot = vi.spyOn(service, 'replaceSnapshot').mockResolvedValue(undefined);
        await expect(service.applyPlan({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', planId: plan.id, snapshotHash: before.hash, humanGateReceipt: 'gate_legacy' }))
            .rejects.toMatchObject({ code: 'GRAPH_HUMAN_GATE_SCOPE_MISMATCH', status: 409 });
        expect(replaceSnapshot).not.toHaveBeenCalled();
    });

    it('旧Decision集合は単一Decisionだけ互換受理し、抑止集計のない旧Gateは再承認を要求する', async () => {
        const makePlan = (ids) => {
            const before = { project_code: 'brainbase', entities: ids.map((id) => ({
                id, entity_type: 'decision', project_code: 'brainbase', payload: {}, role_min: 'member',
                sensitivity: 'internal', lifecycle_status: 'active', version: 1
            })), edges: [] };
            before.hash = hashGraphSnapshot(before);
            const after = structuredClone(before);
            after.entities.forEach((entity) => { entity.lifecycle_status = 'retired'; entity.version = 2; });
            after.hash = hashGraphSnapshot(after);
            return {
                id: `plan_${ids.length}`, project_id: 'project_brainbase', organization_id: 'org_1',
                project_code: 'brainbase', status: 'planned', base_snapshot_hash: before.hash,
                after_snapshot_hash: after.hash, before_snapshot: before, after_snapshot: after,
                operations: ids.map((id) => ({ operation: 'retire_entity', entity_id: id, expected_version: 1 }))
            };
        };
        const record = async (plan, receiptId, { omitSuppressionSummary = false } = {}) => {
            let service;
            const client = { query: vi.fn(async (sql, params) => {
                if (sql.includes('SELECT id, code, organization_id FROM projects')) return { rows: [{ id: 'project_brainbase', code: 'brainbase', organization_id: 'org_1' }] };
                if (sql.includes('FROM graph_maintenance_plans')) return { rows: [plan] };
                if (sql.includes("entity_type='decision'")) return { rows: [{ id: 'decision_1' }] };
                if (sql.includes('INSERT INTO graph_maintenance_human_gate_receipts')) return { rows: [{ receipt_id: receiptId, decision_id: 'decision_1', status: 'approved' }] };
                throw new Error(`unexpected query: ${sql} ${params}`);
            }) };
            service = new GraphMaintenanceService({ infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) } });
            const legacyScope = { ...service.formatPlan(plan).apply_human_gate_scope };
            delete legacyScope.decision_ids;
            if (omitSuppressionSummary) delete legacyScope.suppression_summary;
            return service.recordHumanGateReceipt({
                organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'bearer', personId: 'person_1'
            }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId, evidence: { operation_scope: legacyScope } });
        };
        await expect(record(makePlan(['decision_1']), 'gate_legacy_single'))
            .resolves.toMatchObject({ receipt_id: 'gate_legacy_single', status: 'approved' });
        await expect(record(makePlan(['decision_1']), 'gate_pre_suppression', { omitSuppressionSummary: true }))
            .rejects.toMatchObject({ code: 'GRAPH_HUMAN_GATE_EVIDENCE_INVALID', status: 400 });
        await expect(record(makePlan(['decision_1', 'decision_2']), 'gate_legacy_multi'))
            .rejects.toMatchObject({ code: 'GRAPH_HUMAN_GATE_SCOPE_MISMATCH', status: 409 });
    });

    it('適用済みの複数Decision Planは追加Human Gate評価前に既存Receiptを返す', async () => {
        const before = {
            project_code: 'brainbase',
            entities: ['decision_1', 'decision_2'].map((id) => ({
                id, entity_type: 'decision', project_code: 'brainbase', payload: {}, role_min: 'member',
                sensitivity: 'internal', lifecycle_status: 'active', version: 1
            })),
            edges: []
        };
        before.hash = hashGraphSnapshot(before);
        const plan = {
            id: 'plan_applied_two_decisions', project_id: 'project_brainbase', organization_id: 'org_1',
            project_code: 'brainbase', status: 'applied', base_snapshot_hash: before.hash,
            after_snapshot_hash: before.hash, before_snapshot: before, after_snapshot: before,
            operations: before.entities.map((entity) => ({
                operation: 'retire_entity', entity_id: entity.id, expected_version: 1
            }))
        };
        const receipt = { receipt_id: 'apply_existing', plan_id: plan.id, receipt_type: 'apply', status: 'completed' };
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('FROM graph_maintenance_plans')) return { rows: [plan] };
            if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [] };
            if (sql.includes('FROM graph_maintenance_receipts')) return { rows: [receipt] };
            throw new Error(`mutation query must not run: ${sql}`);
        }) };
        const appliedService = new GraphMaintenanceService({
            infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) }
        });
        await expect(appliedService.applyPlan({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm'
        }, {
            projectCode: 'brainbase', planId: plan.id, snapshotHash: before.hash
        })).resolves.toEqual(receipt);
        expect(client.query).toHaveBeenCalledTimes(5);
    });

    it('既存Receiptの再取得はPlanのtenantとprojectに一致するものだけを返す', async () => {
        const before = {
            project_code: 'brainbase',
            entities: [],
            edges: []
        };
        before.hash = hashGraphSnapshot(before);
        const plan = {
            id: 'plan_receipt_scope', project_id: 'project_brainbase', organization_id: 'org_1',
            project_code: 'brainbase', status: 'applied', base_snapshot_hash: before.hash,
            after_snapshot_hash: before.hash, before_snapshot: before, after_snapshot: before,
            operations: []
        };
        const mismatchedReceipt = {
            receipt_id: 'apply_other_scope', plan_id: plan.id, receipt_type: 'apply', status: 'completed',
            organization_id: 'org_other', project_id: 'project_other'
        };
        let receiptQuery;
        const client = { query: vi.fn(async (sql, params) => {
            if (sql.includes('FROM graph_maintenance_plans')) return { rows: [plan] };
            if (sql.includes('FROM graph_maintenance_receipts')) {
                receiptQuery = { sql, params };
                const scoped = sql.includes('r.organization_id=$3')
                    && sql.includes('r.project_id=p.project_id')
                    && sql.includes('p.organization_id=$3')
                    && sql.includes('project_scope.code=$4');
                return { rows: scoped ? [] : [mismatchedReceipt] };
            }
            throw new Error(`mutation query must not run: ${sql}`);
        }) };
        const scopedService = new GraphMaintenanceService({
            infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) }
        });

        await expect(scopedService.applyPlan({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm'
        }, {
            projectCode: 'brainbase', planId: plan.id, snapshotHash: before.hash
        })).rejects.toThrow('Plan is not applicable: applied');
        expect(receiptQuery.params).toEqual([plan.id, 'apply', 'org_1', 'brainbase']);
        expect(client.query).toHaveBeenCalledTimes(3);
    });

    it('適用済みPlanでもbase snapshot hash不一致はReceipt readbackより先に拒否する', async () => {
        const before = {
            project_code: 'brainbase',
            entities: [],
            edges: []
        };
        before.hash = hashGraphSnapshot(before);
        const plan = {
            id: 'plan_applied_hash_mismatch', project_id: 'project_brainbase', organization_id: 'org_1',
            project_code: 'brainbase', status: 'applied', base_snapshot_hash: before.hash,
            after_snapshot_hash: before.hash, before_snapshot: before, after_snapshot: before,
            operations: []
        };
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('FROM graph_maintenance_plans')) return { rows: [plan] };
            throw new Error(`Receipt readback must not run: ${sql}`);
        }) };
        const appliedService = new GraphMaintenanceService({
            infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) }
        });
        await expect(appliedService.applyPlan({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm'
        }, {
            projectCode: 'brainbase', planId: plan.id, snapshotHash: 'sha256:wrong'
        })).rejects.toThrow('snapshot hash mismatch');
        expect(client.query).toHaveBeenCalledTimes(2);
    });

    it('replaceSnapshotは別tenantのedge IDを上書きしない', async () => {
        const snapshot = {
            project_code: 'brainbase',
            entities: [
                { id: 'entity_a', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 },
                { id: 'entity_b', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }
            ],
            edges: [{ id: 'edge_owned_by_other_tenant', from_id: 'entity_a', to_id: 'entity_b', rel_type: 'knows', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }]
        };
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [] };
            if (sql.includes('SELECT id, code FROM projects')) return { rows: [{ id: 'project_brainbase', code: 'brainbase' }] };
            if (sql.includes("to_regclass('public.project_registry')")) return { rows: [{ project_registry: null }] };
            if (sql.includes('SELECT id FROM graph_entities')) return { rows: [] };
            if (sql.includes('SELECT id FROM graph_edges')) return { rows: [{ id: 'edge_owned_by_other_tenant' }] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        await expect(service.replaceSnapshot(client, {
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm'
        }, snapshot)).rejects.toThrow('edge id tenant conflict');
        expect(client.query).toHaveBeenCalledTimes(7);
    });

    it('replaceSnapshotは既存のorphanを増やさない変更を許容する', async () => {
        const before = {
            project_code: 'brainbase',
            entities: [{ id: 'entity_a', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }],
            edges: [{ id: 'edge_orphan', from_id: 'entity_a', to_id: 'missing_entity', rel_type: 'knows', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }]
        };
        const after = structuredClone(before);
        after.entities[0].lifecycle_status = 'retired';
        after.entities[0].version = 2;
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [] };
            if (sql.includes('SELECT id, code FROM projects')) return { rows: [{ id: 'project_brainbase', code: 'brainbase' }] };
            if (sql.includes("to_regclass('public.project_registry')")) return { rows: [{ project_registry: null }] };
            if (sql.includes('SELECT id FROM graph_entities') || sql.includes('SELECT id FROM graph_edges')) return { rows: [] };
            if (sql.includes('INSERT INTO graph_entities') || sql.includes('INSERT INTO graph_edges')) return { rowCount: 1, rows: [] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        await expect(service.replaceSnapshot(client, {
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm'
        }, after, { baseline: before })).resolves.toBeUndefined();
        expect(client.query).toHaveBeenCalledTimes(7);
    });

    it('rejects a stored plan snapshot whose content no longer matches its hash before mutation', async () => {
        const before = {
            project_code: 'brainbase',
            entities: [{ id: 'entity_a', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }],
            edges: []
        };
        before.hash = hashGraphSnapshot(before);
        const after = structuredClone(before);
        after.entities[0].version = 2;
        after.hash = hashGraphSnapshot(after);
        const plan = {
            id: 'plan_tampered', project_id: 'project_brainbase', organization_id: 'org_1', project_code: 'brainbase', status: 'planned',
            base_snapshot_hash: before.hash, after_snapshot_hash: after.hash,
            before_snapshot: before, after_snapshot: structuredClone(after)
        };
        plan.after_snapshot.entities[0].payload.tampered = true;
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('FROM graph_maintenance_plans')) return { rows: [plan] };
            if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [] };
            if (sql.includes('FROM graph_maintenance_receipts')) return { rows: [] };
            throw new Error(`mutation query must not run: ${sql}`);
        }) };
        const tamperService = new GraphMaintenanceService({ infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) } });
        await expect(tamperService.applyPlan({ organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm' }, {
            projectCode: 'brainbase', planId: 'plan_tampered', snapshotHash: before.hash
        })).rejects.toThrow('stored plan snapshot hash mismatch');
        expect(client.query).toHaveBeenCalledTimes(4);
    });

    it('rejects an introduced orphan that is absent from the immutable baseline', async () => {
        const before = {
            project_code: 'brainbase',
            entities: [{ id: 'entity_a', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }],
            edges: []
        };
        const image = structuredClone(before);
        image.edges.push({ id: 'edge_new_orphan', from_id: 'entity_a', to_id: 'missing_new', rel_type: 'knows', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 });
        const client = { query: vi.fn() };
        await expect(service.loadSnapshotImage(client, { organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm' }, image, {
            baseline: before
        })).rejects.toThrow('Graph snapshot image is invalid: orphan');
        expect(client.query).not.toHaveBeenCalled();
    });

    it('rejects a missing planned row during baseline-relative readback', async () => {
        const image = {
            project_code: 'brainbase',
            entities: [
                { id: 'entity_a', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 },
                { id: 'entity_b', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }
            ],
            edges: []
        };
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('SELECT id, code FROM projects')) return { rows: [{ id: 'project_brainbase', code: 'brainbase' }] };
            if (sql.includes('SELECT ge.id, ge.entity_type')) return { rows: [image.entities[0]] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        await expect(service.loadSnapshotImage(client, { organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm' }, image, {
            baseline: image
        })).rejects.toThrow('Graph snapshot image contains missing or inaccessible records');
    });

    it('keeps strict validation when no immutable baseline is supplied', async () => {
        const invalid = {
            project_code: 'brainbase',
            entities: [{ id: 'entity_a', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }],
            edges: [{ id: 'edge_orphan', from_id: 'entity_a', to_id: 'missing_entity', rel_type: 'knows', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }]
        };
        const client = { query: vi.fn() };
        await expect(service.replaceSnapshot(client, { organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm' }, invalid))
            .rejects.toThrow('Graph snapshot is invalid: orphan');
        expect(client.query).not.toHaveBeenCalled();
    });

    it('複合scope snapshotは全project accessとorganization一致を要求する', async () => {
        const rowsByCode = {
            brainbase: { id: 'project_brainbase', code: 'brainbase', organization_id: 'org_1' },
            vibepro: { id: 'project_vibepro', code: 'vibepro', organization_id: 'org_1' }
        };
        const client = { query: vi.fn(async (sql, params) => {
            if (sql.includes('SELECT id, code, organization_id FROM projects')) {
                return { rows: rowsByCode[params[0]] ? [rowsByCode[params[0]]] : [] };
            }
            if (sql.includes('SELECT ge.id, ge.entity_type')) return { rows: [
                { id: 'decision_1', entity_type: 'decision', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 },
                { id: 'project_vibepro_entity', entity_type: 'project', project_code: 'vibepro', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }
            ] };
            if (sql.includes('SELECT gx.id, gx.from_id')) return { rows: [] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const multiScopeService = new GraphMaintenanceService({ infoSSOTService: {} });
        const access = { organizationId: 'org_1', projectCodes: ['brainbase', 'vibepro'], role: 'gm' };
        const { snapshot } = await multiScopeService.loadSnapshot(client, access, 'brainbase', {
            includeProjectCodes: ['vibepro', 'vibepro']
        });
        expect(snapshot.entities.map((entity) => entity.project_code)).toEqual(['brainbase', 'vibepro']);
        const entityQuery = client.query.mock.calls.find(([sql]) => sql.includes('SELECT ge.id, ge.entity_type'));
        expect(entityQuery?.[1]).toEqual([['project_brainbase', 'project_vibepro']]);

        await expect(multiScopeService.loadSnapshot(client, {
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm'
        }, 'brainbase', { includeProjectCodes: ['vibepro'] })).rejects.toThrow('Access denied for project: vibepro');
    });

    it('同一organizationで参照権限のある跨project endpointをmetadata-only参照として解決する', async () => {
        const localEntity = {
            id: 'project_brainbase_entity', entity_type: 'project', project_code: 'brainbase', payload: {},
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1
        };
        const externalPerson = {
            id: 'per_yajima_tsuyoshi', entity_type: 'person', project_code: 'techknight', organization_id: 'org_1',
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 3
        };
        const edge = {
            id: 'edge_yajima_member_of', from_id: externalPerson.id, to_id: localEntity.id, rel_type: 'member_of',
            project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal',
            lifecycle_status: 'active', version: 1
        };
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('SELECT id, code, organization_id FROM projects')) {
                return { rows: [{ id: 'project_brainbase', code: 'brainbase', organization_id: 'org_1' }] };
            }
            if (sql.includes('WHERE ge.project_id=ANY')) return { rows: [localEntity] };
            if (sql.includes('SELECT gx.id, gx.from_id')) return { rows: [edge] };
            if (sql.includes('WHERE ge.id=ANY')) return { rows: [externalPerson] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const scoped = new GraphMaintenanceService({ infoSSOTService: {} });
        const { snapshot } = await scoped.loadSnapshot(client, {
            organizationId: 'org_1', projectCodes: ['brainbase', 'techknight'], role: 'gm'
        }, 'brainbase');

        expect(snapshot.entities).toEqual([localEntity]);
        expect(snapshot.edges).toEqual([edge]);
        expect(snapshot.external_entities).toEqual([{
            id: externalPerson.id, entity_type: 'person', project_code: 'techknight', reference_scope: 'same_organization',
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 3
        }]);
        expect(snapshot.external_entities[0]).not.toHaveProperty('payload');
        expect(validateGraphSnapshot(snapshot)).toMatchObject({ valid: true, counts: { orphans: 0 } });
    });

    it('projectless Personをactive member_ofのproject経由でmetadata-only参照として解決する', async () => {
        const localEntity = {
            id: 'project_brainbase_entity', entity_type: 'project', project_code: 'brainbase', payload: {},
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1
        };
        const projectlessPerson = {
            id: 'per_yajima_tsuyoshi', entity_type: 'person', project_code: 'techknight', organization_id: 'org_1',
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 3
        };
        const edge = {
            id: 'edge_yajima_member_of', from_id: projectlessPerson.id, to_id: localEntity.id, rel_type: 'member_of',
            project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal',
            lifecycle_status: 'active', version: 1
        };
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('SELECT id, code, organization_id FROM projects')) {
                return { rows: [{ id: 'project_brainbase', code: 'brainbase', organization_id: 'org_1' }] };
            }
            if (sql.includes('WHERE ge.project_id=ANY')) return { rows: [localEntity] };
            if (sql.includes('SELECT gx.id, gx.from_id')) return { rows: [edge] };
            if (sql.includes('WHERE ge.id=ANY')) return { rows: [projectlessPerson] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const scoped = new GraphMaintenanceService({ infoSSOTService: {} });
        const { snapshot } = await scoped.loadSnapshot(client, {
            organizationId: 'org_1', projectCodes: ['brainbase', 'techknight'], role: 'gm'
        }, 'brainbase');

        const endpointQuery = client.query.mock.calls.find(([sql]) => sql.includes('WHERE ge.id=ANY'));
        expect(endpointQuery?.[0]).toContain("ge.entity_type='person'");
        expect(endpointQuery?.[0]).toContain("membership.rel_type='member_of'");
        expect(endpointQuery?.[0]).toContain('COUNT(DISTINCT membership_project.organization_id)=1');
        expect(endpointQuery?.[0]).toContain('membership.sensitivity=ANY($4::text[])');
        expect(snapshot.edges).toEqual([edge]);
        expect(snapshot.external_entities).toEqual([{
            id: projectlessPerson.id, entity_type: 'person', project_code: 'techknight',
            reference_scope: 'same_organization', role_min: 'member', sensitivity: 'internal',
            lifecycle_status: 'active', version: 3
        }]);
        expect(validateGraphSnapshot(snapshot)).toMatchObject({ valid: true, counts: { orphans: 0 } });
    });

    it('複数organizationに所属するprojectless Personを保守Snapshotでも解決しない', async () => {
        const localEntity = {
            id: 'project_brainbase_entity', entity_type: 'project', project_code: 'brainbase', payload: {},
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1
        };
        const edge = {
            id: 'edge_ambiguous_person', from_id: 'person_multi_org', to_id: localEntity.id, rel_type: 'member_of',
            project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal',
            lifecycle_status: 'active', version: 1
        };
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('SELECT id, code, organization_id FROM projects')) {
                return { rows: [{ id: 'project_brainbase', code: 'brainbase', organization_id: 'org_1' }] };
            }
            if (sql.includes('WHERE ge.project_id=ANY')) return { rows: [localEntity] };
            if (sql.includes('SELECT gx.id, gx.from_id')) return { rows: [edge] };
            if (sql.includes('WHERE ge.id=ANY')) {
                expect(sql).toContain('COUNT(DISTINCT membership_project.organization_id)=1');
                return { rows: [] };
            }
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const scoped = new GraphMaintenanceService({ infoSSOTService: {} });
        const { snapshot } = await scoped.loadSnapshot(client, {
            organizationId: 'org_1', projectCodes: ['brainbase', 'techknight'], role: 'gm', clearance: ['internal']
        }, 'brainbase');

        expect(snapshot.edges).toEqual([]);
        expect(snapshot).not.toHaveProperty('external_entities');
        expect(snapshot.suppression_summary).toEqual({
            edge_count: 1,
            reasons: { unresolved_or_inaccessible_endpoint: 1 }
        });
        expect(JSON.stringify(snapshot)).not.toContain('person_multi_org');
    });

    it('非canonical scope marker Edgeを識別子なしの理由付きで抑止する', async () => {
        const localEntities = [{
            id: 'decision_local', entity_type: 'decision', project_code: 'brainbase', payload: {},
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1
        }, {
            id: 'project_local', entity_type: 'project', project_code: 'brainbase', payload: {},
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1
        }];
        const edge = {
            id: 'edge_noncanonical_marker', from_id: 'decision_local', to_id: 'project_local',
            rel_type: 'related_to', project_code: 'brainbase',
            payload: { cross_tenant: true, target_project_code: 'aitle' },
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1
        };
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('SELECT id, code, organization_id FROM projects')) {
                return { rows: [{ id: 'project_brainbase', code: 'brainbase', organization_id: 'org_1' }] };
            }
            if (sql.includes('WHERE ge.project_id=ANY')) return { rows: localEntities };
            if (sql.includes('SELECT gx.id, gx.from_id')) return { rows: [edge] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const scoped = new GraphMaintenanceService({ infoSSOTService: {} });
        const { snapshot } = await scoped.loadSnapshot(client, {
            organizationId: 'org_1', projectCodes: ['brainbase', 'aitle'], role: 'gm'
        }, 'brainbase');

        expect(snapshot.edges).toEqual([]);
        expect(snapshot.suppression_summary).toEqual({
            edge_count: 1,
            reasons: { noncanonical_cross_tenant_marker: 1 }
        });
        expect(JSON.stringify(snapshot)).not.toContain(edge.id);
        const edgeQuery = client.query.mock.calls.find(([sql]) => sql.includes('SELECT gx.id, gx.from_id'));
        expect(edgeQuery?.[0]).not.toContain("NOT (gx.payload ? 'target_project_code'");
    });

    it('同一organizationでも参照先projectが権限外ならEdgeとendpointを公開しない', async () => {
        const localEntity = {
            id: 'project_brainbase_entity', entity_type: 'project', project_code: 'brainbase', payload: {},
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1
        };
        const edge = {
            id: 'edge_hidden_member_of', from_id: 'person_hidden', to_id: localEntity.id, rel_type: 'member_of',
            project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal',
            lifecycle_status: 'active', version: 1
        };
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('SELECT id, code, organization_id FROM projects')) {
                return { rows: [{ id: 'project_brainbase', code: 'brainbase', organization_id: 'org_1' }] };
            }
            if (sql.includes('WHERE ge.project_id=ANY')) return { rows: [localEntity] };
            if (sql.includes('SELECT gx.id, gx.from_id')) return { rows: [edge] };
            if (sql.includes('WHERE ge.id=ANY')) return { rows: [{
                id: localEntity.id, entity_type: localEntity.entity_type, project_code: localEntity.project_code,
                organization_id: 'org_1', role_min: localEntity.role_min, sensitivity: localEntity.sensitivity,
                lifecycle_status: localEntity.lifecycle_status, version: localEntity.version
            }] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const scoped = new GraphMaintenanceService({ infoSSOTService: {} });
        const { snapshot } = await scoped.loadSnapshot(client, {
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm'
        }, 'brainbase');

        expect(snapshot.edges).toEqual([]);
        expect(snapshot).not.toHaveProperty('external_entities');
        expect(snapshot.suppression_summary).toEqual({
            edge_count: 1,
            reasons: { unresolved_or_inaccessible_endpoint: 1 }
        });
        expect(JSON.stringify(snapshot)).not.toContain('person_hidden');
    });

    it('通常Edgeの別organization endpointはorganization境界で解決せず公開しない', async () => {
        const localEntity = {
            id: 'project_brainbase_entity', entity_type: 'project', project_code: 'brainbase', payload: {},
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1
        };
        const edge = {
            id: 'edge_cross_org_noncanonical', from_id: 'person_other_org', to_id: localEntity.id,
            rel_type: 'member_of', project_code: 'brainbase', payload: {}, role_min: 'member',
            sensitivity: 'internal', lifecycle_status: 'active', version: 1
        };
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('SELECT id, code, organization_id FROM projects')) {
                return { rows: [{ id: 'project_brainbase', code: 'brainbase', organization_id: 'org_1' }] };
            }
            if (sql.includes('WHERE ge.project_id=ANY')) return { rows: [localEntity] };
            if (sql.includes('SELECT gx.id, gx.from_id')) return { rows: [edge] };
            if (sql.includes('WHERE ge.id=ANY')) return { rows: [] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const scoped = new GraphMaintenanceService({ infoSSOTService: {} });
        const access = {
            organizationId: 'org_1', projectCodes: ['brainbase', 'other_project'], role: 'gm'
        };
        const { snapshot } = await scoped.loadSnapshot(client, access, 'brainbase');

        const endpointQuery = client.query.mock.calls.find(([sql]) => sql.includes('WHERE ge.id=ANY'));
        expect(endpointQuery?.[0]).toContain('COALESCE(p.organization_id, membership_scope.organization_id)=$2');
        expect(endpointQuery?.[0]).toContain('COALESCE(p.code, membership_scope.project_code)=ANY($3::text[])');
        expect(endpointQuery?.[1]).toEqual([
            ['person_other_org'], 'org_1', access.projectCodes, ['internal'], access.role
        ]);
        expect(snapshot.edges).toEqual([]);
        expect(snapshot).not.toHaveProperty('external_entities');
        expect(snapshot.suppression_summary).toEqual({
            edge_count: 1,
            reasons: { unresolved_or_inaccessible_endpoint: 1 }
        });
        expect(JSON.stringify(snapshot)).not.toContain('person_other_org');
    });

    it('canonical cross-tenant endpointが欠損していればSnapshot全体をfail closedにする', async () => {
        const localDecision = {
            id: 'decision_local', entity_type: 'decision', project_code: 'brainbase', payload: {},
            role_min: 'ceo', sensitivity: 'restricted', lifecycle_status: 'active', version: 1
        };
        const edge = {
            id: 'edge_missing_subject', from_id: localDecision.id, to_id: 'product_missing', rel_type: 'governs',
            project_code: 'brainbase', payload: { cross_tenant: true, target_project_code: 'aitle' },
            role_min: 'ceo', sensitivity: 'restricted', lifecycle_status: 'active', version: 1
        };
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('SELECT id, code, organization_id FROM projects')) {
                return { rows: [{ id: 'project_brainbase', code: 'brainbase', organization_id: 'org_1' }] };
            }
            if (sql.includes('WHERE ge.project_id=ANY')) return { rows: [localDecision] };
            if (sql.includes('SELECT gx.id, gx.from_id')) return { rows: [edge] };
            if (sql.includes('WHERE ge.id=ANY')) return { rows: [] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const scoped = new GraphMaintenanceService({ infoSSOTService: {} });

        await expect(scoped.loadSnapshot(client, {
            organizationId: 'org_1', projectCodes: ['brainbase', 'aitle'], role: 'ceo'
        }, 'brainbase')).rejects.toThrow('Decision subject target is missing or inaccessible');
    });

    it.each([
        ['source type', { entity_type: 'person' }, {}],
        ['source lifecycle', { lifecycle_status: 'retired' }, {}],
        ['target type', {}, { entity_type: 'person' }],
        ['target lifecycle', {}, { lifecycle_status: 'retired' }]
    ])('existing canonical cross-tenant Edge with invalid endpoint is fail-closed without identifiers (%s)', async (_caseName, sourcePatch, targetPatch) => {
        const localDecision = {
            id: 'decision_invalid_endpoint', entity_type: 'decision', project_code: 'brainbase', payload: {},
            role_min: 'ceo', sensitivity: 'restricted', lifecycle_status: 'active', version: 1,
            ...sourcePatch
        };
        const target = {
            id: 'product_invalid_endpoint', entity_type: 'product', project_code: 'aitle', organization_id: 'org_other',
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1,
            ...targetPatch
        };
        const edge = {
            id: 'edge_invalid_endpoint', from_id: localDecision.id, to_id: target.id, rel_type: 'governs',
            project_code: 'brainbase', payload: { cross_tenant: true, target_project_code: 'aitle' },
            role_min: 'ceo', sensitivity: 'restricted', lifecycle_status: 'active', version: 1
        };
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('SELECT id, code, organization_id FROM projects')) {
                return { rows: [{ id: 'project_brainbase', code: 'brainbase', organization_id: 'org_source' }] };
            }
            if (sql.includes('WHERE ge.project_id=ANY')) return { rows: [localDecision] };
            if (sql.includes('SELECT gx.id, gx.from_id')) return { rows: [edge] };
            if (sql.includes('WHERE ge.id=ANY')) return { rows: [target] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const scoped = new GraphMaintenanceService({ infoSSOTService: {} });

        let error;
        try {
            await scoped.loadSnapshot(client, {
                organizationId: 'org_source', projectCodes: ['brainbase', 'aitle'], role: 'ceo'
            }, 'brainbase');
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('Decision subject target is missing or inaccessible');
        expect(error.message).not.toContain(localDecision.id);
        expect(error.message).not.toContain(target.id);
        expect(error.message).not.toContain(edge.id);
    });

    it.each([
        ['source type', { entity_type: 'person' }, {}],
        ['source lifecycle', { lifecycle_status: 'retired' }, {}],
        ['target type', {}, { entity_type: 'person' }],
        ['target reference scope', {}, { reference_scope: 'same_organization' }],
        ['target lifecycle', {}, { lifecycle_status: 'retired' }]
    ])('existing canonical cross-tenant Edge image with invalid endpoint is fail-closed without identifiers (%s)', async (_caseName, sourcePatch, targetPatch) => {
        const localDecision = {
            id: 'decision_invalid_image_endpoint', entity_type: 'decision', project_code: 'brainbase', payload: {},
            role_min: 'ceo', sensitivity: 'restricted', lifecycle_status: 'active', version: 1,
            ...sourcePatch
        };
        const expected = {
            id: 'product_invalid_image_endpoint', entity_type: 'product', project_code: 'aitle',
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1,
            ...targetPatch
        };
        const target = {
            ...expected, organization_id: 'org_other', ...targetPatch
        };
        const edge = {
            id: 'edge_invalid_image_endpoint', from_id: localDecision.id, to_id: expected.id, rel_type: 'governs',
            project_code: 'brainbase', payload: { cross_tenant: true, target_project_code: 'aitle' },
            role_min: 'ceo', sensitivity: 'restricted', lifecycle_status: 'active', version: 1
        };
        const client = { query: vi.fn(async () => ({ rows: [target] })) };
        const image = {
            project_code: 'brainbase', entities: [localDecision], edges: [edge], external_entities: [expected]
        };

        let error;
        try {
            await service.loadExternalEntitiesFromImage(client, {
                organizationId: 'org_source', projectCodes: ['brainbase', 'aitle'], role: 'ceo'
            }, image);
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('Decision subject target is missing or inaccessible');
        expect(error.message).not.toContain(localDecision.id);
        expect(error.message).not.toContain(expected.id);
        expect(error.message).not.toContain(edge.id);
    });

    it('same-organization external endpointのreadbackはGMでも許可しscope markerを維持する', async () => {
        const expected = {
            id: 'per_yajima_tsuyoshi', entity_type: 'person', project_code: 'techknight',
            reference_scope: 'same_organization', role_min: 'member', sensitivity: 'internal',
            lifecycle_status: 'active', version: 3
        };
        const client = { query: vi.fn(async () => ({ rows: [{
            ...expected, organization_id: 'org_1', reference_scope: undefined
        }] })) };

        const readback = await service.loadExternalEntitiesFromImage(client, {
            organizationId: 'org_1', projectCodes: ['brainbase', 'techknight'], role: 'gm'
        }, { project_code: 'brainbase', entities: [], edges: [], external_entities: [expected] }, { lock: true });

        expect(readback).toEqual([expected]);
        expect(client.query.mock.calls[0][0]).toContain('FOR UPDATE');
    });

    it.each([
        ['gm', ['brainbase']],
        ['ceo', ['brainbase']]
    ])('既存cross-tenant edgeは片側scopeの%s snapshotから存在も返さない', async (role, projectCodes) => {
        const crossEdge = {
            id: 'edge_subject', from_id: 'decision_1', to_id: 'product_aitle', rel_type: 'governs',
            project_code: 'brainbase', payload: { cross_tenant: true, target_project_code: 'aitle' },
            role_min: 'ceo', sensitivity: 'restricted', lifecycle_status: 'active', version: 1
        };
        const client = { query: vi.fn(async (sql, params) => {
            if (sql.includes('SELECT id, code, organization_id FROM projects')) {
                return { rows: [{ id: 'project_brainbase', code: 'brainbase', organization_id: 'org_unson' }] };
            }
            if (sql.includes('SELECT ge.id, ge.entity_type')) return { rows: [{
                id: 'decision_1', entity_type: 'decision', project_code: 'brainbase', payload: {},
                role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1
            }] };
            if (sql.includes('SELECT gx.id, gx.from_id')) {
                const visible = params[1] === 'ceo' && params[2].includes('aitle');
                return { rows: visible ? [crossEdge] : [] };
            }
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const scoped = new GraphMaintenanceService({ infoSSOTService: {} });
        const { snapshot } = await scoped.loadSnapshot(client, { organizationId: 'org_unson', role, projectCodes }, 'brainbase');
        expect(snapshot.edges).toEqual([]);
        expect(snapshot).not.toHaveProperty('external_entities');
    });

    it('Human Gate receiptは署名Bearerの人間principalからのみ供給できる', async () => {
        const client = { query: vi.fn(async (sql, params = []) => {
            if (sql.includes('SELECT id, code, organization_id FROM projects')) return { rows: [{ id: 'project_brainbase', code: 'brainbase', organization_id: 'org_1' }] };
            if (sql.includes('SELECT ge.id, ge.entity_type, p.code AS project_code')) return { rows: [{
                id: 'product_aitle', entity_type: 'product', project_code: 'aitle', organization_id: 'org_2',
                role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 4
            }] };
            if (sql.includes("entity_type='decision'")) return { rows: [{ id: 'decision_1' }] };
            if (sql.includes('INSERT INTO graph_maintenance_human_gate_receipts')) return { rows: [{
                receipt_id: params[0], organization_id: 'org_1', project_id: 'project_brainbase', decision_id: params[3],
                status: 'approved', approved_by: 'person_1', approved_at: '2026-08-21T00:00:00.000Z', evidence: JSON.parse(params[5])
            }] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const withAccessContext = vi.fn(async (_access, callback) => callback(client));
        const humanGateService = new GraphMaintenanceService({ infoSSOTService: { withAccessContext } });
        await expect(humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'service-token', personId: 'svc_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_1', evidence: {} })).rejects
            .toMatchObject({ code: 'GRAPH_HUMAN_PRINCIPAL_REQUIRED', status: 403 });
        await expect(humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_invalid', evidence: null }))
            .rejects.toMatchObject({ code: 'GRAPH_HUMAN_GATE_EVIDENCE_INVALID', status: 400 });
        await expect(humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_secret', evidence: { token: 'raw-secret' } }))
            .rejects.toMatchObject({ code: 'GRAPH_HUMAN_GATE_EVIDENCE_SECRET', status: 400 });
        await expect(humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_bearer', evidence: { reason: 'Bearer abcdefghijklmnopqrstuvwxyz' } }))
            .rejects.toMatchObject({ code: 'GRAPH_HUMAN_GATE_EVIDENCE_SECRET', status: 400 });
        await expect(humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_large', evidence: { reason: 'x'.repeat(8200) } }))
            .rejects.toMatchObject({ code: 'GRAPH_HUMAN_GATE_EVIDENCE_INVALID', status: 400 });
        await expect(humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_oversized_scope', evidence: { operation_scope: {
            operation: 'link_decision_subject', decision_id: 'x'.repeat(8200), decision_expected_version: 1,
            subject_entity_id: 'product_1', subject_expected_version: 1, target_project_code: 'target', expected_version: 0
        } } })).rejects.toMatchObject({ code: 'GRAPH_HUMAN_GATE_EVIDENCE_TOO_LARGE', status: 413 });
        await expect(humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_unbound', evidence: { source: 'human-review' } }))
            .rejects.toMatchObject({ code: 'GRAPH_HUMAN_GATE_EVIDENCE_INVALID', status: 400 });
        await expect(humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_forbidden', evidence: { operation_scope: {
            operation: 'link_decision_subject', decision_id: 'decision_1', decision_expected_version: 2,
            subject_entity_id: 'product_aitle', subject_expected_version: 4,
            target_project_code: 'aitle', expected_version: 0
        } } })).rejects.toThrow('Cross-tenant Decision subject link requires ceo role');
        await expect(humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'ceo', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_source_only', evidence: { operation_scope: {
            operation: 'link_decision_subject', decision_id: 'decision_1', decision_expected_version: 2,
            subject_entity_id: 'product_aitle', subject_expected_version: 4,
            target_project_code: 'aitle', expected_version: 0
        } } })).rejects.toThrow('Access denied for target project scope');
        const receipt = await humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase', 'aitle'], role: 'ceo', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_1', evidence: { operation_scope: {
            operation: 'link_decision_subject', decision_id: 'decision_1', decision_expected_version: 2,
            subject_entity_id: 'product_aitle', subject_expected_version: 4,
            target_project_code: 'aitle', expected_version: 0
        }, source: 'human-review' } });
        expect(receipt).toMatchObject({ receipt_id: 'gate_1', status: 'approved', decision_id: 'decision_1' });
        const projectSubjectReceipt = await humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_project_subject', evidence: { operation_scope: {
            operation: 'link_decision_project_subject', decision_id: 'decision_1', decision_expected_version: 2,
            subject_entity_id: 'brainbase-universal-arts-ai-support', subject_expected_version: 1,
            target_project_code: 'brainbase', expected_version: 0
        } } });
        expect(projectSubjectReceipt).toMatchObject({
            receipt_id: 'gate_project_subject', status: 'approved', decision_id: 'decision_1'
        });
        const retireReceipt = await humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_retire', evidence: { operation_scope: {
            operation: 'retire_entity', decision_id: 'decision_1', decision_expected_version: 2
        } } });
        expect(retireReceipt).toMatchObject({ receipt_id: 'gate_retire', status: 'approved', decision_id: 'decision_1' });
        await expect(humanGateService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm', authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_other', receiptId: 'gate_mismatch', evidence: { operation_scope: {
            operation: 'retire_entity', decision_id: 'decision_1', decision_expected_version: 2
        } } })).rejects.toMatchObject({ code: 'GRAPH_HUMAN_GATE_SCOPE_MISMATCH', status: 409 });
        expect(withAccessContext).toHaveBeenCalledTimes(5);
    });

    it('Human Gate receipt IDの再利用は同一operation_scopeだけを許可する', async () => {
        const existingScope = {
            operation: 'link_decision_subject', decision_id: 'decision_1', decision_expected_version: 2,
            subject_entity_id: 'product_aitle', subject_expected_version: 4,
            target_project_code: 'aitle', expected_version: 0
        };
        const requestedScope = { ...existingScope, subject_expected_version: 5 };
        const client = { query: vi.fn(async (sql) => {
            if (sql.includes('SELECT id, code, organization_id FROM projects')) return { rows: [{ id: 'project_brainbase', code: 'brainbase', organization_id: 'org_1' }] };
            if (sql.includes('SELECT ge.id, ge.entity_type, p.code AS project_code')) return { rows: [{
                id: 'product_aitle', entity_type: 'product', project_code: 'aitle', organization_id: 'org_2',
                role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 5
            }] };
            if (sql.includes("entity_type='decision'")) return { rows: [{ id: 'decision_1' }] };
            if (sql.includes('INSERT INTO graph_maintenance_human_gate_receipts')) return { rows: [] };
            if (sql.includes('FROM graph_maintenance_human_gate_receipts WHERE id=')) return { rows: [{
                receipt_id: 'gate_1', organization_id: 'org_1', project_id: 'project_brainbase',
                decision_id: 'decision_1', status: 'approved', evidence: { operation_scope: existingScope }
            }] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const receiptService = new GraphMaintenanceService({ infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) } });
        await expect(receiptService.recordHumanGateReceipt({
            organizationId: 'org_1', projectCodes: ['brainbase', 'aitle'], role: 'ceo',
            authSource: 'bearer', personId: 'person_1'
        }, { projectCode: 'brainbase', decisionId: 'decision_1', receiptId: 'gate_1', evidence: { operation_scope: requestedScope } }))
            .rejects.toMatchObject({ code: 'GRAPH_HUMAN_GATE_SCOPE_MISMATCH', status: 409 });
    });

    it('rollbackはafter imageで新規作成されたedgeだけをorg/project限定で消し、残存を検出する', async () => {
        const before = {
            project_code: 'brainbase',
            entities: [
                { id: 'entity_a', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 },
                { id: 'entity_b', entity_type: 'person', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }
            ], edges: []
        };
        before.hash = hashGraphSnapshot(before);
        const after = structuredClone(before);
        after.edges = [{ id: 'edge_created', from_id: 'entity_a', to_id: 'entity_b', rel_type: 'knows', project_code: 'brainbase', payload: {}, role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1 }];
        after.hash = hashGraphSnapshot(after);
        const plan = {
            id: 'plan_1', project_id: 'project_brainbase', organization_id: 'org_1', project_code: 'brainbase', status: 'applied',
            operations: [], reason: 'rollback test', idempotency_key: 'rollback-1', base_snapshot_hash: before.hash,
            after_snapshot_hash: after.hash, before_snapshot: before, after_snapshot: after
        };
        let edgeExists = true;
        const client = { query: vi.fn(async (sql, params) => {
            if (sql.includes('FROM graph_maintenance_plans')) return { rows: [plan] };
            if (sql.includes('pg_try_advisory_xact_lock')) return { rows: [] };
            if (sql.includes('FROM graph_maintenance_receipts')) {
                return params[1] === 'apply' ? { rows: [{ receipt_id: 'apply_1' }] } : { rows: [] };
            }
            if (sql.includes('SELECT id, code FROM projects') && sql.includes('ANY($1::text[])')) return { rows: [{ id: 'project_brainbase', code: 'brainbase' }] };
            if (sql.includes("to_regclass('public.project_registry')")) return { rows: [{ project_registry: null }] };
            if (sql.includes('SELECT id, code, organization_id FROM projects')) return { rows: [{ id: 'project_brainbase', code: 'brainbase', organization_id: 'org_1' }] };
            if (sql.includes('SELECT id FROM projects WHERE code=ANY')) return { rows: [{ id: 'project_brainbase' }] };
            if (sql.includes('SELECT ge.id, ge.entity_type')) return { rows: after.entities };
            if (sql.includes('SELECT gx.id, gx.from_id')) return { rows: edgeExists ? after.edges : [] };
            if (sql.includes('SELECT ge.id FROM graph_entities ge WHERE ge.id=ANY')) return { rows: [{ id: 'entity_a' }, { id: 'entity_b' }] };
            if (sql.includes('SELECT ge.id') && sql.includes('JOIN projects')) return { rows: [{ id: 'entity_a' }, { id: 'entity_b' }] };
            if (sql.includes('DELETE FROM graph_edges')) { edgeExists = false; return { rowCount: 1, rows: [] }; }
            if (sql.includes('SELECT id FROM graph_edges')) return { rows: edgeExists ? [{ id: 'edge_created' }] : [] };
            if (sql.includes('SELECT id FROM graph_entities')) return { rows: [] };
            if (sql.includes('INSERT INTO graph_entities')) return { rowCount: 1, rows: [] };
            if (sql.includes('INSERT INTO graph_maintenance_receipts')) return { rows: [{ receipt_id: 'rollback_1', receipt_type: 'rollback', status: 'completed' }] };
            if (sql.includes('UPDATE graph_maintenance_plans')) return { rowCount: 1, rows: [] };
            throw new Error(`unexpected query: ${sql}`);
        }) };
        const rollbackService = new GraphMaintenanceService({ infoSSOTService: { withAccessContext: async (_access, callback) => callback(client) } });
        const receipt = await rollbackService.rollbackPlan({ organizationId: 'org_1', projectCodes: ['brainbase'], role: 'gm' }, {
            projectCode: 'brainbase', planId: 'plan_1', applyReceiptId: 'apply_1'
        });
        expect(receipt).toMatchObject({ receipt_id: 'rollback_1', receipt_type: 'rollback' });
        const deleteCall = client.query.mock.calls.find(([sql]) => sql.includes('DELETE FROM graph_edges'));
        expect(deleteCall?.[1]).toEqual([['edge_created'], 'org_1', ['brainbase']]);
        expect(edgeExists).toBe(false);
    });
});
