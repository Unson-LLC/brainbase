import { describe, expect, it } from 'vitest';
import {
    applyGraphOperations,
    buildGraphPlan,
    validateGraphSnapshot
} from '../src/graph-maintenance-engine.js';

// VibePro traceability: story-graph-shared-person-membership AC-001, AC-004, AC-006.
const baseSnapshot = () => ({
    project_code: 'techknight',
    entities: [
        {
            id: 'dec_add_member', entity_type: 'decision', project_code: 'techknight',
            payload: { title: '小松原さんをtechknightのメンバーにする', status: 'decided' },
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1
        },
        {
            id: 'prj_techknight', entity_type: 'project', project_code: 'techknight',
            payload: { name: 'TechKnight' },
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 2
        },
        {
            id: 'per_other', entity_type: 'app', project_code: 'techknight',
            payload: { name: 'other' },
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1
        }
    ],
    external_entities: [{
        id: 'per_shared', entity_type: 'person', project_code: 'techknight', reference_scope: 'shared_person',
        role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 4
    }],
    edges: [{
        id: 'edg_existing', from_id: 'per_other', to_id: 'prj_techknight', rel_type: 'related_to',
        project_code: 'techknight', payload: {}, role_min: 'member', sensitivity: 'internal',
        lifecycle_status: 'active', version: 1
    }]
});

const operation = (overrides = {}) => ({
    operation: 'add_shared_membership',
    decision_id: 'dec_add_member', decision_expected_version: 1,
    subject_entity_id: 'per_shared', subject_expected_version: 4,
    target_project_entity_id: 'prj_techknight', target_project_expected_version: 2,
    target_project_code: 'techknight', expected_version: 0, edge_id: 'edg_new_membership',
    basis: '2026-10-02 佐藤承認: techknight・aitle-siteに参加', confirmed_at: '2026-10-02',
    human_gate_receipt: 'hgr_membership',
    ...overrides
});

describe('add_shared_membership engine', () => {
    it('AC-001 AC-004 共有の人物からProject entityへmember_ofを1本だけ足し、根拠を残す', () => {
        const before = baseSnapshot();
        const plan = buildGraphPlan(before, {
            project_code: 'techknight', idempotency_key: 'k', reason: 'shared membership', operations: [operation()]
        });
        const byId = (records) => [...records].sort((left, right) => left.id.localeCompare(right.id));
        expect(byId(plan.after.entities)).toEqual(byId(before.entities));
        expect(plan.after.external_entities).toEqual(before.external_entities);
        expect(byId(plan.after.edges.filter((edge) => edge.id !== 'edg_new_membership'))).toEqual(byId(before.edges));
        expect(plan.after.edges.find((edge) => edge.id === 'edg_new_membership')).toEqual({
            id: 'edg_new_membership', from_id: 'per_shared', to_id: 'prj_techknight', rel_type: 'member_of',
            project_code: 'techknight',
            payload: {
                source: 'graph_maintenance:add_shared_membership', source_graph_scope: 'shared_person',
                basis: '2026-10-02 佐藤承認: techknight・aitle-siteに参加', confirmed_at: '2026-10-02',
                decision_id: 'dec_add_member', human_gate_receipt: 'hgr_membership'
            },
            role_min: 'member', sensitivity: 'internal', lifecycle_status: 'active', version: 1
        });
        expect(validateGraphSnapshot(plan.after).valid).toBe(true);
    });

    it('AC-006 有効な同じ所属があれば何も変えない', () => {
        const before = baseSnapshot();
        before.edges.push({
            id: 'edg_already', from_id: 'per_shared', to_id: 'prj_techknight', rel_type: 'member_of',
            project_code: 'techknight', payload: {}, role_min: 'member', sensitivity: 'internal',
            lifecycle_status: 'active', version: 1
        });
        const plan = buildGraphPlan(before, {
            project_code: 'techknight', idempotency_key: 'k', reason: 'shared membership', operations: [operation()]
        });
        expect(plan.after_hash).toBe(plan.before_hash);
    });

    it('退いた所属は再有効化せず拒否する', () => {
        const before = baseSnapshot();
        before.edges.push({
            id: 'edg_retired', from_id: 'per_shared', to_id: 'prj_techknight', rel_type: 'member_of',
            project_code: 'techknight', payload: {}, role_min: 'member', sensitivity: 'internal',
            lifecycle_status: 'retired', version: 2
        });
        expect(() => applyGraphOperations(before, [operation()], { projectCode: 'techknight' }))
            .toThrow('A retired membership exists');
    });

    it.each([
        ['人物が外部endpointに無い', { subject_entity_id: 'per_missing' }, 'Shared person endpoint is required'],
        ['人物がlocalのentity', { subject_entity_id: 'per_other' }, 'Shared person endpoint is required'],
        ['Decisionのversionが古い', { decision_expected_version: 2 }, 'expected_version conflict'],
        ['人物のversionが古い', { subject_expected_version: 3 }, 'expected_version conflict'],
        ['Projectのversionが古い', { target_project_expected_version: 1 }, 'expected_version conflict'],
        ['足す先がProjectでない', { target_project_entity_id: 'per_other', target_project_expected_version: 1 }, 'active Project entity'],
        ['Decisionでない', { decision_id: 'per_other' }, 'active Decision'],
        ['receiptが無い', { human_gate_receipt: undefined }, 'human_gate_receipt is required'],
        ['basisが無い', { basis: ' ' }, 'basis is required'],
        ['確認日が日付でない', { confirmed_at: '2026/10/02' }, 'confirmed_at must be a YYYY-MM-DD date'],
        ['別プロジェクトを指す', { target_project_code: 'unson' }, 'target_project_code must be the plan project'],
        ['新規でexpected_versionが0でない', { expected_version: 1 }, 'expected_version conflict']
    ])('%sなら拒否する', (_label, overrides, message) => {
        expect(() => applyGraphOperations(baseSnapshot(), [operation(overrides)], { projectCode: 'techknight' }))
            .toThrow(message);
    });

    it('人物がretire済みなら拒否する', () => {
        const before = baseSnapshot();
        before.external_entities[0].lifecycle_status = 'retired';
        expect(() => applyGraphOperations(before, [operation()], { projectCode: 'techknight' }))
            .toThrow('active shared Person is required');
    });
});
