import { describe, expect, it } from 'vitest';
import {
    applyPlanToSnapshot,
    buildRemediationPlan
} from '../../../scripts/ontology-remediate-production-1.0.0.js';

const appOwners = {
    app_aitle: 'techknight', app_aitle_site: 'techknight', app_baao: 'baao', app_back_office: 'unson',
    app_brainbase: 'unson', app_conn: 'unson', app_detectiveai: 'unson', app_dialogai: 'unson',
    app_dialogai_environment_production: 'unson', app_dialogai_environment_staging: 'unson',
    app_emporio: 'unson', app_flux: 'unson', app_hq_dashboard: 'techknight', app_infisical: 'unson',
    app_mana: 'unson', app_mywa: 'baao', app_postio: 'unson', app_salestailor: 'salestailor',
    app_sato_portfolio: 'unson', app_senpainurse: 'techknight', app_senrigan: 'unson',
    app_smartfront: 'techknight', app_techknight_platform: 'techknight', app_unson_os: 'unson',
    app_vibepro: 'unson', app_zeims: 'zeims'
};

function entity(id, type, payload = {}) {
    return { id, type, entity_type: type, project_id: 'prj_scope', payload, role_min: 'member', sensitivity: 'internal' };
}

function fixture() {
    return {
        entities: [
            entity('per_01KGYC7NNS0VXADK7NP48W4VR5', 'person', { name: '佐藤 圭吾' }),
            entity('prj_01KGCS8CAJKKDWACPNK1E5WX8H', 'project', { name: 'Brainbase' }),
            ...[...new Set(Object.values(appOwners))].map((id) => entity(id, 'org', { name: id })),
            ...Object.keys(appOwners).map((id) => entity(id, 'app', { name: id })),
            entity('dec_01KQ8T4J1P5CZ0GXTD1YGS774D', 'decision', { status: 'decided' }),
            entity('dec_01KQ8T8SZV67GHYYERGYGMFSZ4', 'decision', { status: 'decided' }),
            entity('dec_vibepro_ai_self_evaluation_metrics_japanese_ssot', 'decision', { status: 'decided' })
        ],
        edges: [],
        complete: true
    };
}

describe('ontology 1.0.0 production remediation plan', () => {
    it('preserves history and makes only additive edges plus two fixture status updates', () => {
        const snapshot = fixture();
        const plan = buildRemediationPlan(snapshot);
        expect(plan.entityUpserts.map((item) => item.id)).toEqual([
            'per_01KGS5F2HGJSWMZX68QJEQB0BB',
            'ncom-catalyst-program',
            'unson-ncom-engagement'
        ]);
        expect(plan.entityPayloadUpdates).toHaveLength(2);
        expect(plan.entityPayloadUpdates.every((item) => item.payload.status === 'pending_validation')).toBe(true);
        expect(plan.edgeUpserts).toHaveLength(28);
        expect(plan.edgeUpserts.filter((item) => item.relation === 'owned_by')).toHaveLength(27);
        expect(plan.edgeUpserts.filter((item) => item.relation === 'belongs_to_project')).toHaveLength(1);
        const planned = applyPlanToSnapshot(snapshot, plan);
        expect(planned.entities).toHaveLength(snapshot.entities.length + 3);
        expect(planned.edges).toHaveLength(28);
        expect(snapshot.entities.find((item) => item.id.startsWith('dec_')).payload.status).toBe('decided');
    });

    it('is idempotent for inserted entities and edges', () => {
        const snapshot = fixture();
        const first = buildRemediationPlan(snapshot);
        const planned = applyPlanToSnapshot(snapshot, first);
        const second = buildRemediationPlan(planned);
        expect(second.entityUpserts).toEqual([]);
        expect(second.entityPayloadUpdates).toEqual([]);
        expect(second.edgeUpserts).toEqual([]);
    });
});
