import { createHash } from 'node:crypto';
import { normalizeRepositoryRelativePath } from './canonical-document-writer-adapter.js';

const SOURCE_CLASS = 'owning_repo';
const CONTENT_TYPE = 'team_document';

function documentGraphError(code, message, status = 503, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    error.details = details;
    return error;
}

function requiredText(value, field, status = 400) {
    if (typeof value !== 'string' || !value.trim()) {
        throw documentGraphError(
            'knowledge_document_graph_registration_required',
            `${field} is required for a Graph document source registration`,
            status,
            { field }
        );
    }
    return value.trim();
}

function optionalRevision(value) {
    if (value === null) return null;
    if (!Number.isInteger(value) || value < 1) {
        throw documentGraphError(
            'knowledge_document_graph_revision_invalid',
            'expected_revision must be null or a positive integer',
            400,
            { field: 'expected_revision' }
        );
    }
    return value;
}

function requestFingerprint(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function organizationIdFrom(access) {
    const organizationId = access?.organizationId || access?.tenantId;
    if (typeof organizationId !== 'string' || !organizationId.trim()) {
        throw documentGraphError(
            'knowledge_document_tenant_required',
            'authenticated organization is required for a Graph document source registration',
            403
        );
    }
    return organizationId.trim();
}

function parseRepository(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function normalizePathScope(value) {
    const raw = requiredText(value, 'path_scope').replace(/\/+$/u, '');
    try {
        return normalizeRepositoryRelativePath(raw);
    } catch {
        throw documentGraphError(
            'knowledge_document_graph_registration_invalid',
            'path_scope must be a normalized repository-relative path',
            400,
            { field: 'path_scope' }
        );
    }
}

function registrationFields(input, access, organizationId) {
    const projectCode = requiredText(input?.project_code, 'project_code');
    const tenantId = requiredText(input?.tenant_id || input?.tenant, 'tenant_id', 403);
    if (tenantId !== organizationId) {
        throw documentGraphError(
            'knowledge_document_tenant_mismatch',
            'document source tenant does not match the authenticated organization',
            403,
            { project_code: projectCode }
        );
    }
    if (!access?.personId) {
        throw documentGraphError(
            'knowledge_document_graph_registration_authority_required',
            'authenticated person is required to register a Graph document source',
            403
        );
    }
    const sourceClass = input?.source_class || SOURCE_CLASS;
    const contentType = input?.content_type || CONTENT_TYPE;
    if (sourceClass !== SOURCE_CLASS || contentType !== CONTENT_TYPE) {
        throw documentGraphError(
            'knowledge_document_graph_registration_unsupported',
            'only owning_repo team_document registrations are supported',
            422,
            { source_class: sourceClass, content_type: contentType }
        );
    }
    return {
        organizationId,
        tenantId,
        projectCode,
        sourceClass,
        contentType,
        repositoryOwner: requiredText(input?.repository_owner || input?.owner, 'repository_owner'),
        repositoryName: requiredText(input?.repository_name || input?.repo, 'repository_name'),
        branch: requiredText(input?.branch, 'branch'),
        pathScope: normalizePathScope(input?.path_scope || input?.path),
        graphEntityId: input?.graph_entity_id ? requiredText(input.graph_entity_id, 'graph_entity_id') : null,
        registeredBy: access.personId
    };
}

export class KnowledgeDocumentGraphRepository {
    constructor({ infoSSOTService, pool = infoSSOTService?.pool } = {}) {
        this.infoSSOTService = infoSSOTService;
        this.pool = pool;
    }

    _requireAccess(access) {
        if (!access) throw documentGraphError('knowledge_access_required', 'knowledge Graph access context is required', 403);
        organizationIdFrom(access);
        if (!Array.isArray(access.projectCodes)) {
            throw documentGraphError('knowledge_project_not_accessible', 'project access scope is required', 403);
        }
    }

    _withAccess(access, handler, client) {
        this._requireAccess(access);
        if (typeof this.infoSSOTService?.withAccessContext === 'function') {
            return this.infoSSOTService.withAccessContext(access, handler, client ? { client } : undefined);
        }
        if (client) return handler(client);
        if (typeof this.pool?.connect !== 'function') {
            throw documentGraphError('knowledge_document_graph_repository_unavailable', 'Graph repository database is unavailable', 503);
        }
        return this.pool.connect().then(async (connection) => {
            try {
                return await handler(connection);
            } finally {
                connection.release();
            }
        });
    }

    async _readOnClient(client, projectCode, organizationId) {
        const result = await client.query(
            `SELECT r.organization_id,
                    r.tenant_id,
                    r.project_code,
                    r.source_class,
                    r.content_type,
                    r.repository_owner,
                    r.repository_name,
                    r.branch,
                    r.path_scope,
                    r.graph_project_id,
                    r.graph_entity_id,
                    r.registration_status,
                    r.registered_by,
                    r.revision,
                    r.updated_at,
                    pr.repository AS registry_repository,
                    ge.entity_type AS graph_entity_type,
                    ge.lifecycle_status AS graph_entity_lifecycle_status
             FROM knowledge_document_source_registrations r
             JOIN projects p
               ON p.id = r.graph_project_id
              AND p.code = r.project_code
              AND p.organization_id = r.organization_id
             JOIN project_registry pr
               ON pr.project_code = r.project_code
              AND pr.organization_id = r.organization_id
              AND pr.graph_entity_id = r.graph_entity_id
              AND pr.graph_binding_status = 'linked'
             JOIN graph_entities ge
               ON ge.id = r.graph_entity_id
              AND ge.project_id = p.id
             WHERE r.project_code = $1
               AND r.organization_id = $2
             LIMIT 1`,
            [projectCode, organizationId]
        );
        return result?.rows?.[0] || null;
    }

    async readDocumentSourceRegistration({ project_code: projectCode } = {}, { client, access } = {}) {
        this._requireAccess(access);
        if (!projectCode || !access.projectCodes.includes(projectCode)) {
            throw documentGraphError('knowledge_project_not_accessible', 'project is not accessible', 403, {
                project_code: projectCode || null
            });
        }
        const organizationId = organizationIdFrom(access);
        return this._withAccess(access, (contextClient) => (
            this._readOnClient(contextClient, projectCode, organizationId)
        ), client);
    }

    async registerDocumentSourceRegistration(input = {}, { client, access } = {}) {
        this._requireAccess(access);
        const organizationId = organizationIdFrom(access);
        const fields = registrationFields(input, access, organizationId);
        const expectedRevision = optionalRevision(input.expected_revision);
        const idempotencyKey = requiredText(input.idempotency_key, 'idempotency_key');
        if (!access.projectCodes.includes(fields.projectCode)) {
            throw documentGraphError('knowledge_project_not_accessible', 'project is not accessible', 403, {
                project_code: fields.projectCode
            });
        }
        if (typeof this.infoSSOTService?.assertWriteAccess === 'function') {
            try {
                this.infoSSOTService.assertWriteAccess(access, {
                    projectCode: fields.projectCode,
                    roleMin: 'member',
                    sensitivity: 'internal'
                });
            } catch (error) {
                throw documentGraphError(
                    'knowledge_document_graph_registration_forbidden',
                    error?.message || 'Graph document source registration is not authorized',
                    403,
                    { project_code: fields.projectCode }
                );
            }
        }

        return this._withAccess(access, async (contextClient) => {
            const fingerprint = requestFingerprint({
                project_code: fields.projectCode,
                repository_owner: fields.repositoryOwner,
                repository_name: fields.repositoryName,
                branch: fields.branch,
                path_scope: fields.pathScope,
                expected_revision: expectedRevision
            });
            const receiptResult = await contextClient.query(
                `SELECT request_fingerprint, result
                 FROM knowledge_document_source_registration_receipts
                 WHERE organization_id = $1
                   AND owner_person_id = $2
                   AND project_code = $3
                   AND idempotency_key = $4`,
                [fields.organizationId, fields.registeredBy, fields.projectCode, idempotencyKey]
            );
            const existingReceipt = receiptResult?.rows?.[0];
            if (existingReceipt) {
                if (existingReceipt.request_fingerprint !== fingerprint) {
                    throw documentGraphError(
                        'knowledge_document_graph_idempotency_conflict',
                        'idempotency_key was already used for another registration request',
                        409,
                        { project_code: fields.projectCode }
                    );
                }
                return { registration: existingReceipt.result, idempotent: true };
            }

            const currentResult = await contextClient.query(
                `SELECT revision
                 FROM knowledge_document_source_registrations
                 WHERE organization_id = $1 AND project_code = $2
                 FOR UPDATE`,
                [fields.organizationId, fields.projectCode]
            );
            const currentRevision = currentResult?.rows?.[0]?.revision ?? null;
            if (currentRevision !== expectedRevision) {
                throw documentGraphError(
                    'knowledge_document_graph_revision_conflict',
                    'document source registration changed since it was read',
                    409,
                    { project_code: fields.projectCode, expected_revision: expectedRevision, current_revision: currentRevision }
                );
            }
            const targetResult = await contextClient.query(
                `SELECT p.id AS graph_project_id,
                        p.code AS project_code,
                        p.organization_id,
                        pr.graph_entity_id,
                        pr.graph_binding_status,
                        pr.repository,
                        ge.entity_type AS graph_entity_type,
                        ge.lifecycle_status AS graph_entity_lifecycle_status
                 FROM projects p
                 JOIN project_registry pr
                   ON pr.project_code = p.code
                  AND pr.organization_id = p.organization_id
                 LEFT JOIN graph_entities ge
                   ON ge.id = pr.graph_entity_id
                  AND ge.project_id = p.id
                 WHERE p.code = $1
                 LIMIT 1`,
                [fields.projectCode]
            );
            const target = targetResult?.rows?.[0];
            if (!target) {
                throw documentGraphError(
                    'knowledge_document_graph_target_unavailable',
                    'Project Registry and Graph project target are required before document registration',
                    503,
                    { project_code: fields.projectCode }
                );
            }
            if (target.organization_id !== fields.organizationId) {
                throw documentGraphError(
                    'knowledge_document_tenant_mismatch',
                    'project Graph target belongs to another organization',
                    403,
                    { project_code: fields.projectCode }
                );
            }
            if (target.graph_binding_status !== 'linked'
                || !target.graph_entity_id
                || target.graph_entity_type !== 'project'
                || target.graph_entity_lifecycle_status !== 'active') {
                throw documentGraphError(
                    'knowledge_document_graph_target_unavailable',
                    'an active, linked project Graph entity is required before document registration',
                    503,
                    {
                        project_code: fields.projectCode,
                        graph_binding_status: target.graph_binding_status || null,
                        graph_entity_id: target.graph_entity_id || null,
                        graph_entity_type: target.graph_entity_type || null,
                        graph_entity_lifecycle_status: target.graph_entity_lifecycle_status || null
                    }
                );
            }
            if (fields.graphEntityId && fields.graphEntityId !== target.graph_entity_id) {
                throw documentGraphError(
                    'knowledge_document_graph_target_mismatch',
                    'requested Graph entity does not match the Project Registry target',
                    409,
                    { project_code: fields.projectCode, graph_entity_id: target.graph_entity_id }
                );
            }
            const registryRepository = parseRepository(target.repository);
            if (!registryRepository?.owner || !registryRepository?.repo) {
                throw documentGraphError(
                    'knowledge_document_graph_target_unavailable',
                    'Project Registry owning repository is not configured',
                    503,
                    { project_code: fields.projectCode }
                );
            }
            if (registryRepository.owner !== fields.repositoryOwner
                || registryRepository.repo !== fields.repositoryName) {
                throw documentGraphError(
                    'knowledge_document_graph_repository_mismatch',
                    'registered owner/repository must match the Project Registry owning repository',
                    409,
                    {
                        project_code: fields.projectCode,
                        expected_owner: registryRepository.owner,
                        expected_repo: registryRepository.repo
                    }
                );
            }

            await contextClient.query(
                `INSERT INTO knowledge_document_source_registrations (
                     organization_id, tenant_id, project_code,
                     source_class, content_type,
                     repository_owner, repository_name, branch, path_scope,
                     graph_project_id, graph_entity_id, registration_status,
                     registered_by, registry_repository, revision, updated_at
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'active',$12,$13::jsonb,1,NOW())
                 ON CONFLICT (organization_id, project_code) DO UPDATE SET
                     tenant_id = EXCLUDED.tenant_id,
                     source_class = EXCLUDED.source_class,
                     content_type = EXCLUDED.content_type,
                     repository_owner = EXCLUDED.repository_owner,
                     repository_name = EXCLUDED.repository_name,
                     branch = EXCLUDED.branch,
                     path_scope = EXCLUDED.path_scope,
                     graph_project_id = EXCLUDED.graph_project_id,
                     graph_entity_id = EXCLUDED.graph_entity_id,
                     registration_status = EXCLUDED.registration_status,
                     registered_by = EXCLUDED.registered_by,
                     registry_repository = EXCLUDED.registry_repository,
                     revision = knowledge_document_source_registrations.revision + 1,
                     updated_at = NOW()`,
                [
                    fields.organizationId,
                    fields.tenantId,
                    fields.projectCode,
                    fields.sourceClass,
                    fields.contentType,
                    fields.repositoryOwner,
                    fields.repositoryName,
                    fields.branch,
                    fields.pathScope,
                    target.graph_project_id,
                    target.graph_entity_id,
                    fields.registeredBy,
                    JSON.stringify(registryRepository)
                ]
            );
            const readback = await this._readOnClient(contextClient, fields.projectCode, fields.organizationId);
            if (!readback || readback.registration_status !== 'active'
                || readback.repository_owner !== fields.repositoryOwner
                || readback.repository_name !== fields.repositoryName
                || readback.branch !== fields.branch
                || readback.path_scope !== fields.pathScope
                || readback.graph_entity_id !== target.graph_entity_id) {
                throw documentGraphError(
                    'knowledge_document_graph_registration_readback_invalid',
                    'Graph document source registration readback did not match the requested target',
                    503,
                    { project_code: fields.projectCode }
                );
            }
            await contextClient.query(
                `INSERT INTO knowledge_document_source_registration_receipts (
                     organization_id, owner_person_id, project_code,
                     idempotency_key, request_fingerprint, result
                 ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
                [fields.organizationId, fields.registeredBy, fields.projectCode,
                    idempotencyKey, fingerprint, JSON.stringify(readback)]
            );
            return { registration: readback, idempotent: false };
        }, client);
    }

    async registerDocumentSource(input = {}, options = {}) {
        return this.registerDocumentSourceRegistration(input, options);
    }
}

export class PgKnowledgeDocumentGraphRepository extends KnowledgeDocumentGraphRepository {}
