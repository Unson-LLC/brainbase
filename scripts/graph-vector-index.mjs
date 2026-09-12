#!/usr/bin/env node
// Bounded operator job: no automatic tenant/project expansion and no API endpoint
// that lets a search caller cause bulk external embedding spend.
import { InfoSSOTService } from '../server/services/info-ssot-service.js';
import { GraphVectorSearchService } from '../server/services/graph-vector-search-service.js';

const projectCodes = (process.env.BRAINBASE_EMBEDDING_PROJECT_CODES || '').split(',').map(s => s.trim()).filter(Boolean);
if (!projectCodes.length) throw new Error('BRAINBASE_EMBEDDING_PROJECT_CODES is required');
const access = { role: 'ceo', projectCodes, clearance: ['internal', 'restricted', 'finance', 'hr', 'contract'] };
const maxBatches = Number(process.env.BRAINBASE_EMBEDDING_MAX_BATCHES || 1);
if (!Number.isInteger(maxBatches) || maxBatches < 1 || maxBatches > 100) throw new Error('Invalid max batches');
const info = new InfoSSOTService();
const service = new GraphVectorSearchService(info);
let lock;
try {
    lock = await info.pool.connect();
    const { rows: [row] } = await lock.query("SELECT pg_try_advisory_lock(hashtext('brainbase:graph-vector-index')) AS acquired");
    if (!row.acquired) {
        console.log(JSON.stringify({ status: 'busy' }));
    } else {
        let indexed = 0;
        let selected = 0;
        for (let n = 0; n < maxBatches; n++) {
            const result = await service.indexBatch(access, { limit: 32 });
            indexed += result.indexed;
            selected += result.selected;
            if (result.selected < 32) break;
        }
        console.log(JSON.stringify({ status: 'ok', indexed, selected, max_batches: maxBatches, projects: projectCodes }));
    }
} catch (error) {
    console.error(JSON.stringify({ status: 'failed', code: /^[a-z_]+$/.test(error.code || '') ? error.code : 'graph_vector_index_failed' }));
    process.exitCode = 1;
} finally {
    if (lock) { await lock.query("SELECT pg_advisory_unlock(hashtext('brainbase:graph-vector-index'))"); lock.release(); }
    await info.pool?.end();
}
