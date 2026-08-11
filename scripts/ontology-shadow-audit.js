import process from 'node:process';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { OntologyKernel } from '../server/services/ontology-kernel.js';
import { OntologyRegistry } from '../server/services/ontology-registry.js';

function argument(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : null;
}

const version = argument('--version');
const baselineRef = argument('--baseline-ref');
if (!version) {
    throw new Error('Usage: node scripts/ontology-shadow-audit.js --version <version> [--baseline-ref <git-sha>]');
}
if (!process.env.INFO_SSOT_DATABASE_URL) {
    throw new Error('INFO_SSOT_DATABASE_URL is required');
}

const release = new OntologyRegistry({ rootDir: process.cwd() }).resolve({ version });
const client = new pg.Client({ connectionString: process.env.INFO_SSOT_DATABASE_URL });

function digest(value) {
    return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
}

function counts(values) {
    return Object.fromEntries([...values.reduce((result, value) => {
        result.set(value, (result.get(value) || 0) + 1);
        return result;
    }, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function violationCounts(result) {
    return counts(result.violations.map((item) => item.rule_id));
}

await client.connect();
await client.query('BEGIN READ ONLY');
try {
    const entities = (await client.query(
        'SELECT id, entity_type AS type, payload FROM graph_entities ORDER BY id'
    )).rows;
    const edges = (await client.query(
        'SELECT from_id, to_id, rel_type AS relation, payload FROM graph_edges ORDER BY from_id, to_id, rel_type'
    )).rows;
    const result = release.kernel.validateSnapshot({ entities, edges, complete: true });
    const byId = new Map(entities.map((entity) => [entity.id, entity.type]));
    const inventory = {
        entity_types: counts(entities.map((entity) => entity.type)),
        relation_endpoints: counts(edges.map((edge) => [
            edge.relation,
            byId.get(edge.from_id) || '__missing__',
            byId.get(edge.to_id) || '__missing__'
        ].join('|')))
    };
    const snapshotDigest = digest({ entities, edges });
    const inventoryDigest = digest(inventory);
    let baseline = null;
    if (baselineRef) {
        const releasePath = `config/ontology/releases/${version}.json`;
        const baselineBytes = execFileSync('git', ['show', `${baselineRef}:${releasePath}`], { encoding: 'utf8' });
        const baselineManifest = JSON.parse(baselineBytes);
        const baselineResult = new OntologyKernel({ manifest: baselineManifest, status: baselineManifest.initial_status })
            .validateSnapshot({ entities, edges, complete: true });
        baseline = {
            source_ref: baselineRef,
            release_path: releasePath,
            release_digest: digest(baselineBytes),
            violation_count: baselineResult.violations.length,
            violations_by_rule: violationCounts(baselineResult)
        };
    }
    const candidateViolationCount = result.violations.length;
    const baselineViolationCount = baseline?.violation_count ?? null;
    const reductionPercent = baselineViolationCount == null || baselineViolationCount === 0
        ? null
        : Number((((baselineViolationCount - candidateViolationCount) / baselineViolationCount) * 100).toFixed(3));
    const ruleIds = new Set(result.violations.map((item) => item.rule_id));
    process.stdout.write(`${JSON.stringify({
        schema_version: '1.0.0',
        audited_at: new Date().toISOString(),
        transaction: 'READ ONLY',
        collection_complete: true,
        ontology_version: result.ontology_version,
        release_digest: release.digest,
        release_status: release.kernel.status,
        entity_count: entities.length,
        edge_count: edges.length,
        snapshot_digest_algorithm: 'sha256',
        snapshot_digest: snapshotDigest,
        inventory_digest_algorithm: 'sha256',
        inventory_digest: inventoryDigest,
        observed_inventory: inventory,
        verification: result.verification,
        valid: result.valid,
        baseline,
        baseline_violation_count: baselineViolationCount,
        candidate_violation_count: candidateViolationCount,
        reduction_percent: reductionPercent,
        violations_by_rule: violationCounts(result),
        zero_count_categories: [
            ['unknown_entity_type', 'entity-type-registered'],
            ['unknown_relation_type', 'relation-type-registered'],
            ['relation_endpoint', 'relation-endpoint-'],
            ['relation_cardinality', 'relation-cardinality-']
        ].filter(([, prefix]) => ![...ruleIds].some((id) => id === prefix || id.startsWith(prefix))).map(([category]) => category),
        activation_decision: result.valid && release.kernel.status === 'active' ? 'REVIEW_REQUIRED' : 'NO_GO',
        reproduction: {
            command: `node scripts/ontology-shadow-audit.js --version ${version}${baselineRef ? ` --baseline-ref ${baselineRef}` : ''}`,
            database_url_source: 'INFO_SSOT_DATABASE_URL'
        }
    }, null, 2)}\n`);
} finally {
    await client.query('ROLLBACK');
    await client.end();
}
