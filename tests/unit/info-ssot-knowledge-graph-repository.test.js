import { describe, expect, it, vi } from 'vitest';

import { InfoSSOTKnowledgeGraphRepository } from '../../server/services/knowledge-event/info-ssot-knowledge-graph-repository.js';

const access = {
    personId: 'person_reviewer', organizationId: 'org_a', role: 'gm',
    projectCodes: ['brainbase'], clearance: ['internal']
};

function serviceFixture() {
    const client = { query: vi.fn(async () => ({ rows: [{ id: 'project_uuid' }] })) };
    const infoSSOTService = {
        withAccessContext: vi.fn(async (_access, work) => work(client)),
        assertDecisionAuthority: vi.fn(async () => undefined),
        commitOntologyGraph: vi.fn(async (_access, input) => ({
            entity_id: input.entity.id,
            edge_count: input.edges?.length || 0,
            ontology_version: '1.0.0'
        }))
    };
    return { client, infoSSOTService };
}

function authoringFixture({ includeTarget = true, relationValid = true } = {}) {
    const client = {
        query: vi.fn(async (sql, params) => {
            const text = String(sql);
            if (text.includes('FROM projects')) {
                return { rows: [{ id: 'project_uuid', code: 'brainbase', organization_id: 'org_a' }] };
            }
            if (text.includes('SELECT ge.id, ge.entity_type')) {
                const ids = params?.[0] || [];
                return {
                    rows: [
                        ...(ids.includes('person_owner') ? [{ id: 'person_owner', entity_type: 'person', project_id: null, payload: {}, organization_id: 'org_a' }] : []),
                        ...(includeTarget && ids.includes('decision_target') ? [{ id: 'decision_target', entity_type: 'decision', project_id: 'project_uuid', payload: {}, organization_id: 'org_a' }] : []),
                        ...(ids.includes('decision_existing') ? [{ id: 'decision_existing', entity_type: 'decision', project_id: 'project_uuid', payload: { version: '7', statement: 'Existing' }, organization_id: 'org_a' }] : [])
                    ]
                };
            }
            if (text.includes("entity_type = 'project' AND project_id")) {
                return { rows: [{ id: 'project_entity', entity_type: 'project', project_id: 'project_uuid', payload: {} }] };
            }
            return { rows: [] };
        })
    };
    const infoSSOTService = {
        withAccessContext: vi.fn(async (_access, work) => work(client)),
        assertDecisionAuthority: vi.fn(async () => undefined),
        validateOntology: vi.fn(() => (relationValid ? { valid: true } : { valid: false, violations: [{ code: 'relation_not_registered' }] })),
        validateGraphMutation: vi.fn(async () => undefined),
        assertWriteAccess: vi.fn(),
        upsertGraphEdge: vi.fn(async () => undefined)
    };
    return { client, infoSSOTService };
}

describe('InfoSSOTKnowledgeGraphRepository normalized promotion', () => {
    it('authoringはownerの存在・組織・authorityとontology relationを検証する', async () => {
        const { client, infoSSOTService } = authoringFixture();
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });

        const result = await repository.validateAuthoringContext({
            project_code: 'brainbase', entity_type: 'decision', owner_person_id: 'person_owner',
            relations: [{ relation: 'references', to_id: 'decision_target' }], decision_domain: 'engineering'
        }, { access });

        expect(result).toMatchObject({ owner_person_id: 'person_owner', authority_verified: true });
        expect(result.relations).toEqual([expect.objectContaining({
            relation: 'references', to_id: 'decision_target', to_type: 'decision'
        })]);
        expect(infoSSOTService.assertDecisionAuthority).toHaveBeenCalledWith(client, expect.objectContaining({
            projectId: 'project_uuid', personId: 'person_owner', decisionDomain: 'engineering'
        }));
        expect(infoSSOTService.validateOntology).toHaveBeenCalledWith(expect.objectContaining({
            edge: expect.objectContaining({ relation: 'references', from_type: 'decision', to_type: 'decision' })
        }));
    });

    it('authoringは未検証のdecision authorityをGraphへ書き込む前に拒否する', async () => {
        const { infoSSOTService } = authoringFixture();
        infoSSOTService.assertDecisionAuthority.mockRejectedValueOnce(new Error('Decision authority missing'));
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });

        await expect(repository.validateAuthoringContext({
            project_code: 'brainbase', entity_type: 'decision', owner_person_id: 'person_owner',
            decision_domain: 'engineering'
        }, { access })).rejects.toMatchObject({
            code: 'knowledge_decision_authority_missing', status: 403
        });
    });

    it('authoringは未認可endpointと未登録relationをGraphへ書き込む前に拒否する', async () => {
        const missingTarget = new InfoSSOTKnowledgeGraphRepository({
            infoSSOTService: authoringFixture({ includeTarget: false }).infoSSOTService
        });
        await expect(missingTarget.validateAuthoringContext({
            project_code: 'brainbase', entity_type: 'decision', owner_person_id: 'person_owner',
            relations: [{ relation: 'references', to_id: 'decision_target' }]
        }, { access })).rejects.toMatchObject({ code: 'knowledge_relation_endpoint_not_authorized', status: 403 });

        const invalidRelation = authoringFixture({ relationValid: false });
        const invalidRepository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService: invalidRelation.infoSSOTService });
        await expect(invalidRepository.validateAuthoringContext({
            project_code: 'brainbase', entity_type: 'decision', owner_person_id: 'person_owner',
            relations: [{ relation: 'made_up_relation', to_id: 'decision_target' }]
        }, { access })).rejects.toMatchObject({ code: 'knowledge_authoring_relation_invalid', status: 422 });
    });

    it('authoring saveはowner・project・要求relationの実Graph edgeをupsertする', async () => {
        const { infoSSOTService } = authoringFixture();
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });

        const result = await repository.persistAuthoringRelations({
            project_code: 'brainbase', entity_type: 'decision', entity_id: 'decision_existing',
            owner_person_id: 'person_owner', expected_version: '7',
            relations: [{ relation: 'references', to_id: 'decision_target' }], decision_domain: 'engineering'
        }, { access });

        expect(result).toMatchObject({ entity_id: 'decision_existing', graph_saved: true, readback_verified: true });
        expect(infoSSOTService.validateGraphMutation).toHaveBeenCalledOnce();
        expect(infoSSOTService.upsertGraphEdge).toHaveBeenCalledTimes(3);
        expect(infoSSOTService.upsertGraphEdge.mock.calls.map(([_, input]) => input.relType)).toEqual(expect.arrayContaining([
            'owned_by', 'belongs_to_project', 'references'
        ]));
    });

    it('validates decision authority before committing a normalized decision', async () => {
        const { client, infoSSOTService } = serviceFixture();
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });
        const result = await repository.commitNormalizedPromotion({
            project_code: 'brainbase',
            entity: {
                id: 'decision_1',
                type: 'decision',
                payload: {
                    statement: '暗黙fallbackを禁止する',
                    decision_authority: { decider_id: 'person_a', domain: 'brainbase_architecture' },
                    promotion_evidence: { normalized_payload_hash: 'sha256:abc' }
                }
            },
            edges: [],
            context_entities: [],
            role_min: 'member',
            sensitivity: 'internal'
        }, { client, access });

        expect(infoSSOTService.assertDecisionAuthority).toHaveBeenCalledWith(client, {
            projectId: 'project_uuid',
            projectCode: 'brainbase',
            personId: 'person_a',
            decisionDomain: 'brainbase_architecture'
        });
        expect(infoSSOTService.commitOntologyGraph).toHaveBeenCalledWith(
            access,
            expect.objectContaining({
                projectCode: 'brainbase',
                entity: expect.objectContaining({ id: 'decision_1', type: 'decision' })
            }),
            { client, access_context_applied: true }
        );
        expect(result).toMatchObject({ id: 'decision_1', entity_type: 'decision' });
    });

    it('commits normalized entities and explicit relations without fabricating authority', async () => {
        const { client, infoSSOTService } = serviceFixture();
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });
        const result = await repository.commitNormalizedPromotion({
            project_code: 'brainbase',
            entity: {
                id: 'project_brainbase',
                type: 'project',
                payload: { name: 'Brainbase', promotion_evidence: { normalized_payload_hash: 'sha256:abc' } }
            },
            edges: [{
                from_id: 'project_brainbase', to_id: 'org_unson', relation: 'owned_by',
                payload: { promotion_evidence: { normalized_payload_hash: 'sha256:abc' } }
            }],
            context_entities: [{ id: 'org_unson', type: 'org' }],
            role_min: 'member',
            sensitivity: 'internal'
        }, { client, access });

        expect(infoSSOTService.assertDecisionAuthority).not.toHaveBeenCalled();
        expect(infoSSOTService.commitOntologyGraph).toHaveBeenCalledWith(
            access,
            expect.objectContaining({
                edges: [expect.objectContaining({ relation: 'owned_by' })],
                contextEntities: [{ id: 'org_unson', type: 'org' }]
            }),
            { client, access_context_applied: true }
        );
        expect(result).toMatchObject({ id: 'project_brainbase', edge_count: 1 });
    });

    const expectDirectDecisionUpdateToUseGuard = async (method) => {
        const client = {
            query: vi.fn(async (sql) => {
                if (String(sql).includes("payload->'decision_authority'")) {
                    return { rows: [{ project_id: 'project_uuid', decision_domain: 'engineering' }] };
                }
                if (String(sql).includes("to_regclass('public.project_registry')")) {
                    return { rows: [{ project_registry: null }] };
                }
                if (String(sql).includes('UPDATE graph_entities')) {
                    return { rows: [{ id: 'decision_1', entity_type: 'decision', payload: {} }] };
                }
                return { rows: [] };
            })
        };
        const infoSSOTService = {
            withAccessContext: vi.fn(async (_access, work) => work(client)),
            assertDecisionAuthority: vi.fn(async () => undefined)
        };
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });

        await repository[method]({
            id: 'decision_1',
            event_id: 'event_1',
            replacement_event_id: 'event_2',
            replacement_candidate_id: 'candidate_2',
            source_pointer: null
        }, { client, access });

        const lockIndex = client.query.mock.calls.findIndex(([sql]) => String(sql).includes('pg_try_advisory_xact_lock'));
        const updateIndex = client.query.mock.calls.findIndex(([sql]) => String(sql).includes('UPDATE graph_entities'));
        expect(lockIndex).toBeGreaterThanOrEqual(0);
        expect(updateIndex).toBeGreaterThan(lockIndex);
    };

    it('supersedeDecisionは直接UPDATE前に共通Graph ID guardを通る', async () => {
        await expectDirectDecisionUpdateToUseGuard('supersedeDecision');
    });

    it('retractDecisionは直接UPDATE前に共通Graph ID guardを通る', async () => {
        await expectDirectDecisionUpdateToUseGuard('retractDecision');
    });

    it('lifecycle変更は認証personのdecision authority不足時にGraph更新しない', async () => {
        const client = { query: vi.fn(async (sql) => {
            if (String(sql).includes("payload->'decision_authority'")) {
                return { rows: [{ project_id: 'project_uuid', decision_domain: 'engineering' }] };
            }
            return { rows: [] };
        }) };
        const denied = Object.assign(new Error('Decision authority missing'), { code: 'decision_authority_missing' });
        const infoSSOTService = {
            withAccessContext: vi.fn(async (_access, work) => work(client)),
            assertDecisionAuthority: vi.fn(async () => { throw denied; })
        };
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });

        await expect(repository.changeLifecycle({
            id: 'decision_1', project_code: 'brainbase', expected_version: 'v1',
            state: 'retired', reason: 'obsolete', actor_person_id: access.personId
        }, { access })).rejects.toBe(denied);
        expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE graph_entities'))).toBe(false);
        expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO knowledge_lifecycle_history'))).toBe(false);
    });

    it('lifecycle変更はpayloadとGraph正規列のversion/statusを同時に進める', async () => {
        const client = { query: vi.fn(async (sql) => {
            if (String(sql).includes("payload->'decision_authority'")) {
                return { rows: [{ project_id: 'project_uuid', decision_domain: 'engineering' }] };
            }
            if (String(sql).includes("to_regclass('public.project_registry')")) return { rows: [{ project_registry: null }] };
            if (String(sql).includes('UPDATE graph_entities')) {
                return { rows: [{ id: 'decision_1', entity_type: 'decision', payload: { version: 'lc_next' } }] };
            }
            return { rows: [] };
        }) };
        const infoSSOTService = {
            withAccessContext: vi.fn(async (_access, work) => work(client)),
            assertDecisionAuthority: vi.fn(async () => undefined)
        };
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });

        await repository.changeLifecycle({
            id: 'decision_1', project_code: 'brainbase', expected_version: 'v1',
            state: 'retired', reason: 'obsolete', actor_person_id: access.personId
        }, { access });

        const update = client.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE graph_entities'));
        expect(update[0]).toContain('lifecycle_status=$8::text');
        expect(update[0]).toContain('version=entity.version+1');
        expect(update[1].at(-1)).toBe('inactive');
    });

    it('本文改訂はauthority確認後にCAS更新し、前後snapshotを履歴へ保存する', async () => {
        const oldPayload = {
            statement: 'old', version: 'v1', status: 'retired', semantic_state: 'retracted', searchable: false,
            decision_authority: { domain: 'engineering' }
        };
        const client = { query: vi.fn(async (sql) => {
            const text = String(sql);
            if (text.includes('SELECT from_version, reason, to_snapshot')) return { rows: [] };
            if (text.includes("payload->'decision_authority'")) {
                return { rows: [{ project_id: 'project_uuid', payload: oldPayload, decision_domain: 'engineering' }] };
            }
            if (text.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: true }] };
            if (text.includes("to_regclass('public.project_registry')")) return { rows: [{ project_registry: null }] };
            if (text.includes('UPDATE graph_entities')) {
                return { rows: [{ id: 'decision_1', entity_type: 'decision', payload: { ...oldPayload, statement: 'new', version: 'rev_next' } }] };
            }
            return { rows: [] };
        }) };
        const infoSSOTService = {
            withAccessContext: vi.fn(async (_access, work) => work(client)),
            assertDecisionAuthority: vi.fn(async () => undefined)
        };
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });

        await repository.reviseDecision({
            id: 'decision_1', project_code: 'brainbase', expected_version: 'v1',
            idempotency_key: 'rev-1', reason: 'clarify', content: 'new',
            content_hash: 'sha256:new', actor_person_id: access.personId
        }, { access });

        const update = client.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE graph_entities'));
        expect(update[0]).toContain("entity.payload->>'version'=$3");
        expect(update[0]).toContain('version=entity.version+1');
        expect(update[0]).not.toContain("lifecycle_status='active'");
        expect(infoSSOTService.assertDecisionAuthority).toHaveBeenCalledWith(client, {
            projectId: 'project_uuid', projectCode: 'brainbase', personId: access.personId,
            decisionDomain: 'engineering'
        });
        const history = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO knowledge_revision_history'));
        expect(JSON.parse(history[1][8])).toEqual(oldPayload);
        expect(JSON.parse(history[1][9])).toMatchObject({
            statement: 'new', content_hash: 'sha256:new',
            status: 'retired', semantic_state: 'retracted', searchable: false
        });
    });

    it('改訂metadataはactiveな責任者を検証し、scopeと有効期間をsnapshotへ保存する', async () => {
        const oldPayload = {
            statement: 'old', version: 'v1', owner_id: 'person_old',
            applicability_scope: { scope: 'project', project_code: 'brainbase', organization_id: 'org_a' },
            decision_authority: { domain: 'engineering' }
        };
        const client = { query: vi.fn(async (sql) => {
            const text = String(sql);
            if (text.includes('SELECT from_version, reason, to_snapshot')) return { rows: [] };
            if (text.includes("payload->'decision_authority'")) {
                return { rows: [{ project_id: 'project_uuid', payload: oldPayload, decision_domain: 'engineering' }] };
            }
            if (text.includes("SELECT id FROM people")) return { rows: [{ id: 'person_new' }] };
            if (text.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: true }] };
            if (text.includes("to_regclass('public.project_registry')")) return { rows: [{ project_registry: null }] };
            if (text.includes('UPDATE graph_entities')) {
                return { rows: [{ id: 'decision_1', entity_type: 'decision', payload: { version: 'rev_next' } }] };
            }
            return { rows: [] };
        }) };
        const infoSSOTService = {
            withAccessContext: vi.fn(async (_access, work) => work(client)),
            assertDecisionAuthority: vi.fn(async () => undefined)
        };
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });

        await repository.reviseDecision({
            id: 'decision_1', project_code: 'brainbase', expected_version: 'v1',
            idempotency_key: 'rev-metadata', reason: 'transfer ownership', content: 'new',
            content_hash: 'sha256:new', actor_person_id: access.personId,
            organization_id: 'org_a', scope: 'organization', owner_person_id: 'person_new',
            effective_at: '2026-10-01T00:00:00.000Z', expires_at: '2027-10-01T00:00:00.000Z'
        }, { access });

        const history = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO knowledge_revision_history'));
        expect(JSON.parse(history[1][9])).toMatchObject({
            owner_id: 'person_new', effective_at: '2026-10-01T00:00:00.000Z',
            expires_at: '2027-10-01T00:00:00.000Z',
            applicability_scope: { scope: 'organization', project_code: 'brainbase', organization_id: 'org_a' }
        });
    });

    it('存在しない責任者への改訂はGraphを更新しない', async () => {
        const client = { query: vi.fn(async (sql) => {
            const text = String(sql);
            if (text.includes('SELECT from_version, reason, to_snapshot')) return { rows: [] };
            if (text.includes("payload->'decision_authority'")) {
                return { rows: [{ project_id: 'project_uuid', payload: { version: 'v1' }, decision_domain: 'engineering' }] };
            }
            return { rows: [] };
        }) };
        const infoSSOTService = {
            withAccessContext: vi.fn(async (_access, work) => work(client)),
            assertDecisionAuthority: vi.fn(async () => undefined)
        };
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });
        await expect(repository.reviseDecision({
            id: 'decision_1', project_code: 'brainbase', expected_version: 'v1', idempotency_key: 'rev-owner',
            reason: 'transfer', content: 'new', content_hash: 'sha256:new', actor_person_id: access.personId,
            owner_person_id: 'person_missing'
        }, { access })).rejects.toMatchObject({ code: 'knowledge_revision_owner_not_found', status: 400 });
        expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE graph_entities'))).toBe(false);
    });

    it('多段のsupersedes到達経路を再帰検査しcycleを拒否する', async () => {
        const client = { query: vi.fn(async (sql) => {
            const text = String(sql);
            if (text.includes('FROM knowledge_supersession_history')) return { rows: [] };
            if (text.includes('entity.id = ANY')) return { rows: [
                { id: 'decision_a', project_id: 'project_uuid', decision_domain: 'engineering', payload: { version: 'v1' } },
                { id: 'decision_c', project_id: 'project_uuid', decision_domain: 'policy', payload: { version: 'v3' } }
            ] };
            if (text.includes('WITH RECURSIVE superseded_descendants')) return { rows: [{ conflict: 'cycle' }] };
            return { rows: [] };
        }) };
        const infoSSOTService = { withAccessContext: vi.fn(async (_access, work) => work(client)),
            assertDecisionAuthority: vi.fn(), upsertGraphEdge: vi.fn() };
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });
        await expect(repository.establishSupersession({
            replacement_id: 'decision_a', superseded_id: 'decision_c', project_code: 'brainbase',
            replacement_expected_version: 'v1', superseded_expected_version: 'v3',
            effective_at: '2027-01-01T00:00:00.000Z', reason: 'would close A-B-C-A', idempotency_key: 'sup-cycle',
            organization_id: 'org_a', actor_person_id: access.personId
        }, { access })).rejects.toMatchObject({ code: 'knowledge_supersession_relation_conflict', status: 409 });
        expect(client.query.mock.calls.some(([sql]) => String(sql).includes('WITH RECURSIVE superseded_descendants'))).toBe(true);
        expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE graph_entities'))).toBe(false);
    });

    it('旧形式decided_atより前のexpires_atだけを指定した改訂を拒否する', async () => {
        const client = { query: vi.fn(async (sql) => {
            const text = String(sql);
            if (text.includes('SELECT from_version, reason, to_snapshot')) return { rows: [] };
            if (text.includes("payload->'decision_authority'")) {
                return { rows: [{ project_id: 'project_uuid', payload: {
                    version: 'v1', decided_at: '2027-01-01T00:00:00.000Z'
                }, decision_domain: 'engineering' }] };
            }
            return { rows: [] };
        }) };
        const infoSSOTService = {
            withAccessContext: vi.fn(async (_access, work) => work(client)),
            assertDecisionAuthority: vi.fn(async () => undefined)
        };
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });
        await expect(repository.reviseDecision({
            id: 'decision_1', project_code: 'brainbase', expected_version: 'v1', idempotency_key: 'rev-period',
            reason: 'expire', content: 'new', content_hash: 'sha256:new', actor_person_id: access.personId,
            expires_at: '2026-12-01T00:00:00.000Z'
        }, { access })).rejects.toMatchObject({ code: 'knowledge_revision_effective_period_invalid', status: 400 });
        expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE graph_entities'))).toBe(false);
    });

    it('同じ改訂keyは同一入力だけ再利用し、内容変更は409にする', async () => {
        const prior = { statement: 'new', title: 'Decision', version: 'rev_2' };
        const client = { query: vi.fn(async (sql) => String(sql).includes('SELECT from_version, reason, to_snapshot')
            ? { rows: [{ from_version: 'v1', reason: 'clarify', to_snapshot: prior }] }
            : { rows: [] }) };
        const infoSSOTService = {
            withAccessContext: vi.fn(async (_access, work) => work(client)),
            assertDecisionAuthority: vi.fn(async () => undefined)
        };
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });
        const base = {
            id: 'decision_1', project_code: 'brainbase', expected_version: 'v1',
            idempotency_key: 'rev-1', reason: 'clarify', content: 'new', title: 'Decision',
            content_hash: 'sha256:new', actor_person_id: access.personId
        };

        await expect(repository.reviseDecision(base, { access })).resolves.toMatchObject({
            idempotent: true, payload: prior
        });
        await expect(repository.reviseDecision({ ...base, content: 'changed' }, { access }))
            .rejects.toMatchObject({ code: 'knowledge_revision_idempotency_conflict', status: 409 });
        await expect(repository.reviseDecision({ ...base, reason: 'different audit reason' }, { access }))
            .rejects.toMatchObject({ code: 'knowledge_revision_idempotency_conflict', status: 409 });
        expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE graph_entities'))).toBe(false);
    });

    it('判断domainは認証personのGraph RACIだけから列挙する', async () => {
        const client = { query: vi.fn(async () => ({ rows: [{ domain: 'engineering' }, { domain: 'finance' }] })) };
        const infoSSOTService = { withAccessContext: vi.fn(async (_access, work) => work(client)) };
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });

        await expect(repository.listDecisionAuthorityDomains({ project_code: 'brainbase' }, { access }))
            .resolves.toEqual(['engineering', 'finance']);
        expect(client.query).toHaveBeenCalledWith(expect.stringContaining("raci.role_code LIKE 'decision:%'"), [
            'brainbase', access.personId
        ]);
    });

    it('正式な置換は両判断をCAS更新しsupersedes edgeと監査receiptを同一処理で保存する', async () => {
        const decisions = [
            { id: 'decision_new', project_id: 'project_uuid', decision_domain: 'engineering', payload: { version: 'v2' } },
            { id: 'decision_old', project_id: 'project_uuid', decision_domain: 'policy', payload: { version: 'v4' } }
        ];
        const client = { query: vi.fn(async (sql, params) => {
            const text = String(sql);
            if (text.includes('FROM knowledge_supersession_history')) return { rows: [] };
            if (text.includes('entity.id = ANY')) return { rows: decisions };
            if (text.includes("FROM graph_edges")) return { rows: [] };
            if (text.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: true }] };
            if (text.includes("to_regclass('public.project_registry')")) return { rows: [{ project_registry: null }] };
            if (text.includes('UPDATE graph_entities')) return { rows: [{ id: params[0], entity_type: 'decision', payload: JSON.parse(params[3]) }] };
            return { rows: [] };
        }) };
        const infoSSOTService = {
            withAccessContext: vi.fn(async (_access, work) => work(client)),
            assertDecisionAuthority: vi.fn(async () => undefined),
            upsertGraphEdge: vi.fn(async () => undefined)
        };
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });
        const result = await repository.establishSupersession({
            replacement_id: 'decision_new', superseded_id: 'decision_old', project_code: 'brainbase',
            replacement_expected_version: 'v2', superseded_expected_version: 'v4',
            effective_at: '2026-10-01T00:00:00.000Z', reason: 'new policy', idempotency_key: 'sup-1',
            organization_id: 'org_a', actor_person_id: access.personId
        }, { access });
        expect(result.replacement.payload).toMatchObject({ effective_at: '2026-10-01T00:00:00.000Z' });
        expect(result.superseded.payload).toMatchObject({ expires_at: '2026-10-01T00:00:00.000Z' });
        expect(infoSSOTService.assertDecisionAuthority).toHaveBeenCalledTimes(2);
        expect(infoSSOTService.upsertGraphEdge).toHaveBeenCalledWith(client, expect.objectContaining({
            fromId: 'decision_new', toId: 'decision_old', relType: 'supersedes'
        }));
        expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO knowledge_supersession_history'))).toBe(true);
    });

    it('旧判断の発効以前に失効させる置換はGraph更新前に拒否する', async () => {
        const client = { query: vi.fn(async (sql) => {
            const text = String(sql);
            if (text.includes('FROM knowledge_supersession_history')) return { rows: [] };
            if (text.includes('entity.id = ANY')) return { rows: [
                { id: 'decision_new', project_id: 'project_uuid', decision_domain: 'engineering', payload: { version: 'v2' } },
                { id: 'decision_old', project_id: 'project_uuid', decision_domain: 'policy',
                    payload: { version: 'v4', decided_at: '2027-01-01T00:00:00.000Z' } }
            ] };
            return { rows: [] };
        }) };
        const infoSSOTService = { withAccessContext: vi.fn(async (_access, work) => work(client)),
            assertDecisionAuthority: vi.fn(), upsertGraphEdge: vi.fn() };
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });
        await expect(repository.establishSupersession({
            replacement_id: 'decision_new', superseded_id: 'decision_old', project_code: 'brainbase',
            replacement_expected_version: 'v2', superseded_expected_version: 'v4',
            effective_at: '2026-10-01T00:00:00.000Z', reason: 'invalid', idempotency_key: 'sup-invalid',
            organization_id: 'org_a', actor_person_id: access.personId
        }, { access })).rejects.toMatchObject({ code: 'knowledge_supersession_effective_period_invalid', status: 400 });
        expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE graph_entities'))).toBe(false);
        expect(infoSSOTService.upsertGraphEdge).not.toHaveBeenCalled();
    });

    it.each([
        ['退役済みの代替判断', { status: 'retired' }, [], 'knowledge_supersession_replacement_inactive'],
        ['循環する置換関係', {}, [{ from_id: 'decision_old', to_id: 'decision_new' }], 'knowledge_supersession_relation_conflict'],
        ['別判断による競合置換', {}, [{ from_id: 'decision_other', to_id: 'decision_old' }], 'knowledge_supersession_relation_conflict']
    ])('%sは両判断を更新する前に拒否する', async (_label, replacementState, edgeRows, expectedCode) => {
        const client = { query: vi.fn(async (sql) => {
            const text = String(sql);
            if (text.includes('FROM knowledge_supersession_history')) return { rows: [] };
            if (text.includes('entity.id = ANY')) return { rows: [
                { id: 'decision_new', project_id: 'project_uuid', decision_domain: 'engineering',
                    payload: { version: 'v2', ...replacementState } },
                { id: 'decision_old', project_id: 'project_uuid', decision_domain: 'policy', payload: { version: 'v4' } }
            ] };
            if (text.includes('FROM graph_edges')) return { rows: edgeRows };
            return { rows: [] };
        }) };
        const infoSSOTService = { withAccessContext: vi.fn(async (_access, work) => work(client)),
            assertDecisionAuthority: vi.fn(), upsertGraphEdge: vi.fn() };
        const repository = new InfoSSOTKnowledgeGraphRepository({ infoSSOTService });
        await expect(repository.establishSupersession({
            replacement_id: 'decision_new', superseded_id: 'decision_old', project_code: 'brainbase',
            replacement_expected_version: 'v2', superseded_expected_version: 'v4',
            effective_at: '2026-10-01T00:00:00.000Z', reason: 'invalid', idempotency_key: 'sup-invalid',
            organization_id: 'org_a', actor_person_id: access.personId
        }, { access })).rejects.toMatchObject({ code: expectedCode });
        expect(client.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE graph_entities'))).toBe(false);
    });
});
