import { createEmbeddingProviderFromEnv } from '../../vendor/brainbase-oss-graph/embedding-provider.js';
import { validatePortableGraph, portableGraphDigest, retrievePortableGraph } from '../../vendor/brainbase-oss-graph/portable-graph.js';

function fail(status, code) { throw Object.assign(new Error(code), { status, code }); }

/** Owner-private immutable snapshots; never writes the shared organization graph. */
export class PortableGraphService {
    constructor(infoSSOTService, { provider } = {}) { this.info = infoSSOTService; this.provider = provider; this.providerInitialized = provider !== undefined; }

    async scoped(access, projectCode, graphId, operation) {
        const org = access?.organizationId || access?.tenantId;
        if (access?.authSource !== 'bearer' || !org || !access.personId) fail(403, 'portable_graph_signed_owner_required');
        if (access.organizationId && access.tenantId && access.organizationId !== access.tenantId) fail(403, 'portable_graph_tenant_conflict');
        if (typeof projectCode !== 'string' || !projectCode || projectCode.includes(',') || !access.projectCodes?.includes(projectCode)) fail(403, 'portable_graph_project_denied');
        if (typeof graphId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(graphId)) fail(400, 'portable_graph_id_invalid');
        return this.info.withAccessContext(access, async client => {
            const { rows } = await client.query('SELECT id FROM projects WHERE code = $1 AND organization_id = $2', [projectCode, org]);
            if (!rows.length) fail(403, 'portable_graph_project_denied');
            await client.query('SELECT set_config($1, $2, true)', ['app.portable_graph_owner', access.personId]);
            return operation(client, [org, projectCode, access.personId, graphId]);
        }, { requireCanonicalTenant: true });
    }

    async import(access, projectCode, graphId, bundle) {
        // Validate before storing, and use the same content identity as the OSS client.
        try { validatePortableGraph(bundle); } catch { fail(400, 'portable_graph_bundle_invalid'); }
        const digest = portableGraphDigest(bundle);
        return this.scoped(access, projectCode, graphId, async (client, key) => {
            const inserted = await client.query(`INSERT INTO portable_graph_snapshots
                (organization_id, project_code, owner_person_id, graph_id, bundle, digest)
                VALUES ($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT DO NOTHING RETURNING digest`, [...key, JSON.stringify(bundle), digest]);
            const stored = await this.readRow(client, key);
            if (stored.digest !== digest) fail(409, 'portable_graph_snapshot_conflict');
            return { status: inserted.rows.length ? 'imported' : 'unchanged', digest };
        });
    }

    async readRow(client, key) {
        const { rows } = await client.query(`SELECT bundle, digest FROM portable_graph_snapshots
            WHERE organization_id=$1 AND project_code=$2 AND owner_person_id=$3 AND graph_id=$4`, key);
        if (!rows.length) fail(404, 'portable_graph_not_found');
        if (portableGraphDigest(rows[0].bundle) !== rows[0].digest) fail(500, 'portable_graph_integrity_failed');
        return { bundle: rows[0].bundle, digest: rows[0].digest };
    }

    read(access, projectCode, graphId) {
        return this.scoped(access, projectCode, graphId, (client, key) => this.readRow(client, key));
    }

    async search(access, projectCode, graphId, input) {
        if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['query','limit','project','asOf','seedIds','steps'].includes(key))) fail(400, 'portable_graph_search_invalid');
        const { bundle } = await this.read(access, projectCode, graphId);
        try {
            if (!this.providerInitialized && !input?.seedIds?.length) {
                this.provider = createEmbeddingProviderFromEnv();
                this.providerInitialized = true;
            }
            const result = await retrievePortableGraph(bundle, input, input?.seedIds?.length ? undefined : this.provider);
            return { ...result, authority: 'organization_graph' };
        } catch (error) {
            if (String(error?.code || '').startsWith('embedding_')) fail(503, error.code);
            fail(400, 'portable_graph_search_invalid');
        }
    }
}
