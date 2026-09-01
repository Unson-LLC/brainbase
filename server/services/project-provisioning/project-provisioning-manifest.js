import crypto from 'crypto';

const ALLOWED_KEYS = new Set([
    'schema_version', 'project_code', 'display_name', 'kind', 'catalog_version',
    'session_select', 'organization_entity_id', 'owner_person_id', 'initial_grants',
    'repository'
]);
const PROJECT_CODE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KINDS = new Set(['client', 'internal', 'product', 'research', 'other']);
const REPOSITORY_MODES = new Set(['none', 'link_existing', 'create']);
const REPOSITORY_KEYS = new Set(['mode', 'owner', 'repo', 'visibility']);
const GRANT_KEYS = new Set(['person_id', 'role']);
const REPOSITORY_SLUG = /^[A-Za-z0-9_.-]+$/;

function fail(message, code = 'PROJECT_PROVISIONING_MANIFEST_INVALID') {
    const error = new Error(message);
    error.code = code;
    error.statusCode = 400;
    throw error;
}

function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
    }
    return value;
}

export function normalizeProjectProvisioningManifest(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Manifest must be an object');
    const unknown = Object.keys(input).filter((key) => !ALLOWED_KEYS.has(key));
    if (unknown.length) fail(`Unknown manifest fields: ${unknown.join(', ')}`);
    if (input.local_path !== undefined) fail('local_path belongs to Workspace Setup, not Project Provisioning');
    if (input.schema_version !== 'project-provisioning.v1') fail('schema_version must be project-provisioning.v1');
    const projectCode = String(input.project_code || '').trim();
    if (!PROJECT_CODE.test(projectCode)) fail('project_code must be canonical kebab-case');
    const displayName = String(input.display_name || '').trim();
    if (!displayName) fail('display_name is required');
    const kind = String(input.kind || '').trim();
    if (!KINDS.has(kind)) fail(`kind must be one of: ${[...KINDS].join(', ')}`);
    const catalogVersion = Number(input.catalog_version);
    if (!Number.isInteger(catalogVersion) || catalogVersion < 1) fail('catalog_version must be a positive integer');
    const organizationEntityId = String(input.organization_entity_id || '').trim();
    const ownerPersonId = String(input.owner_person_id || '').trim();
    if (!organizationEntityId || !ownerPersonId) fail('organization_entity_id and owner_person_id are required');
    const grants = Array.isArray(input.initial_grants) ? input.initial_grants : [];
    const initialGrants = grants.map((grant, index) => {
        const unknownGrantKeys = Object.keys(grant || {}).filter((key) => !GRANT_KEYS.has(key));
        if (unknownGrantKeys.length) fail(`initial_grants[${index}] has unknown fields: ${unknownGrantKeys.join(', ')}`);
        const personId = String(grant?.person_id || '').trim();
        const role = String(grant?.role || '').trim().toLowerCase();
        if (!personId || !['member', 'gm', 'ceo'].includes(role)) fail(`initial_grants[${index}] is invalid`);
        return { person_id: personId, role };
    });
    const repository = input.repository || { mode: 'none' };
    if (!repository || typeof repository !== 'object' || Array.isArray(repository)) fail('repository must be an object');
    const unknownRepositoryKeys = Object.keys(repository).filter((key) => !REPOSITORY_KEYS.has(key));
    if (unknownRepositoryKeys.length) fail(`repository has unknown fields: ${unknownRepositoryKeys.join(', ')}`);
    const mode = String(repository.mode || 'none');
    if (!REPOSITORY_MODES.has(mode)) fail('repository.mode is invalid');
    if (mode !== 'none' && (!String(repository.owner || '').trim() || !String(repository.repo || '').trim())) {
        fail('repository owner and repo are required');
    }
    if (mode !== 'none' && (!REPOSITORY_SLUG.test(String(repository.owner)) || !REPOSITORY_SLUG.test(String(repository.repo)))) {
        fail('repository owner and repo must be GitHub-safe slugs');
    }
    const visibility = String(repository.visibility || 'private').trim();
    if (!['private', 'public'].includes(visibility)) fail('repository.visibility must be private or public');
    return canonicalize({
        schema_version: 'project-provisioning.v1',
        project_code: projectCode,
        display_name: displayName,
        kind,
        catalog_version: catalogVersion,
        session_select: input.session_select !== false,
        organization_entity_id: organizationEntityId,
        owner_person_id: ownerPersonId,
        initial_grants: initialGrants,
        repository: mode === 'none' ? { mode } : {
            mode,
            owner: String(repository.owner).trim(),
            repo: String(repository.repo).trim(),
            visibility
        }
    });
}

export function fingerprintProjectProvisioningManifest(manifest) {
    return crypto.createHash('sha256').update(JSON.stringify(canonicalize(manifest))).digest('hex');
}
