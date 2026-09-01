import { GraphMaintenanceService } from '../graph-maintenance-service.js';
import { AuthGrantService } from './auth-grant-service.js';
import { GitHubRepositoryBootstrap } from './github-repository-bootstrap.js';
import {
    fingerprintProjectProvisioningManifest,
    normalizeProjectProvisioningManifest
} from './project-provisioning-manifest.js';
import { PgProjectProvisioningRepository } from './project-provisioning-repository.js';
import { ProjectRegistryCatalogAdapter } from './project-registry-catalog-adapter.js';

const STEP_ORDER = ['registry', 'graph', 'auth_grants', 'repository'];
const AUTHORITY_FIELDS = [
    'organization_exists',
    'owner_person_exists',
    'organization_entity_exists',
    'owner_has_organization_grant'
];

function errorPayload(error) {
    return {
        code: error?.code || 'PROJECT_PROVISIONING_STEP_FAILED',
        message: error?.message || 'Unknown error',
        ...(error?.details !== undefined ? { details: error.details } : {})
    };
}

function assertOperator(actor) {
    if (!['gm', 'ceo'].includes(String(actor?.role || '').toLowerCase())) {
        const error = new Error('Project Provisioning requires gm or ceo');
        error.code = 'PROJECT_PROVISIONING_FORBIDDEN';
        error.statusCode = 403;
        throw error;
    }
    if (!String(actor?.organizationId || actor?.tenantId || '').trim()) {
        const error = new Error('organizationId is required');
        error.code = 'PROJECT_PROVISIONING_ORGANIZATION_REQUIRED';
        error.statusCode = 409;
        throw error;
    }
}

function approvalBindingError(message, details = {}) {
    const error = new Error(message);
    error.code = 'PROJECT_PROVISIONING_HUMAN_GATE_BINDING_MISMATCH';
    error.statusCode = 409;
    error.details = details;
    return error;
}

function readbackError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = 503;
    error.details = details;
    return error;
}

function assertAuthorityReadback(authority) {
    const missingFields = AUTHORITY_FIELDS.filter((field) => typeof authority?.[field] !== 'boolean');
    if (missingFields.length) {
        throw readbackError(
            'PROJECT_PROVISIONING_AUTHORITY_READBACK_INVALID',
            'Manifest authority verification returned an incomplete result',
            { missing_fields: missingFields }
        );
    }
    return authority;
}

function assertIdentityCollisionReadback(identityCollisions) {
    if (!Array.isArray(identityCollisions)) {
        throw readbackError(
            'PROJECT_PROVISIONING_IDENTITY_COLLISION_READBACK_INVALID',
            'Identity collision verification returned an invalid result',
            { reason: 'result_must_be_array' }
        );
    }
    const invalidRows = identityCollisions
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => (
            !row || typeof row !== 'object' || Array.isArray(row)
            || typeof row.id !== 'string' || !row.id.trim()
        ))
        .map(({ index }) => index);
    if (invalidRows.length) {
        throw readbackError(
            'PROJECT_PROVISIONING_IDENTITY_COLLISION_READBACK_INVALID',
            'Identity collision verification returned an invalid result',
            { invalid_rows: invalidRows }
        );
    }
    return identityCollisions;
}

function canonicalGateSet(value) {
    if (!Array.isArray(value) || value.some((gate) => typeof gate !== 'string')) return null;
    const gates = value.map((gate) => gate.trim());
    if (gates.some((gate) => gate.length === 0)) return null;
    return [...new Set(gates)].sort();
}

function validateApprovalBinding(run) {
    const requiredGates = canonicalGateSet(run?.plan?.required_human_gates);
    if (!requiredGates || requiredGates.length === 0) {
        throw approvalBindingError('The persisted human-gate set is invalid', {
            required_gates: run?.plan?.required_human_gates
        });
    }

    // The three persisted manifest fingerprints (receipt, run, and plan) must
    // also agree with the manifest read back from storage before any write.
    const receipt = run?.human_gate_receipt;
    const runFingerprint = run?.manifest_fingerprint;
    const planFingerprint = run?.plan?.manifest_fingerprint;
    const manifestFingerprint = run?.manifest
        ? fingerprintProjectProvisioningManifest(run.manifest)
        : null;
    const fingerprints = {
        receipt_fingerprint: receipt?.manifest_fingerprint ?? null,
        run_fingerprint: runFingerprint ?? null,
        plan_fingerprint: planFingerprint ?? null,
        manifest_fingerprint: manifestFingerprint
    };
    const persistedFingerprintValues = [runFingerprint, planFingerprint, manifestFingerprint];
    if (
        persistedFingerprintValues.some((fingerprint) => typeof fingerprint !== 'string' || fingerprint.length === 0) ||
        persistedFingerprintValues.some((fingerprint) => fingerprint !== persistedFingerprintValues[0])
    ) {
        throw approvalBindingError('The persisted human-gate fingerprint binding is invalid', {
            fingerprints
        });
    }

    if (!receipt) return { requiredGates, approvedGates: null, fingerprints };

    const fingerprintValues = Object.values(fingerprints);
    if (
        typeof fingerprints.receipt_fingerprint !== 'string' ||
        fingerprints.receipt_fingerprint.length === 0 ||
        fingerprintValues.some((fingerprint) => fingerprint !== fingerprintValues[0])
    ) {
        throw approvalBindingError('The persisted human-gate fingerprint binding is invalid', {
            fingerprints
        });
    }

    const approvedGates = canonicalGateSet(receipt.approved_gates);
    if (!approvedGates) {
        throw approvalBindingError('The persisted approved human-gate set is invalid', {
            approved_gates: receipt.approved_gates
        });
    }
    const missingGates = requiredGates.filter((gate) => !approvedGates.includes(gate));
    const unsupportedGates = approvedGates.filter((gate) => !requiredGates.includes(gate));
    if (
        missingGates.length > 0 ||
        unsupportedGates.length > 0 ||
        approvedGates.length !== requiredGates.length
    ) {
        throw approvalBindingError('The approved human-gate set does not exactly match the plan', {
            required_gates: requiredGates,
            approved_gates: approvedGates,
            missing_gates: missingGates,
            unsupported_gates: unsupportedGates
        });
    }

    return { requiredGates, approvedGates, fingerprints };
}

export class ProjectProvisioningService {
    constructor({
        repository, graphService, authGrantService, repositoryBootstrap = null,
        catalogAdapter = null, now = () => new Date()
    }) {
        this.repository = repository;
        this.graphService = graphService;
        this.authGrantService = authGrantService;
        this.repositoryBootstrap = repositoryBootstrap;
        this.catalogAdapter = catalogAdapter;
        this.now = now;
    }

    async check(actor, input) {
        assertOperator(actor);
        const manifest = normalizeProjectProvisioningManifest(input);
        const organizationId = actor.organizationId || actor.tenantId;
        if (typeof this.repository.verifyManifestAuthority !== 'function') {
            const error = new Error('Manifest authority verification is unavailable');
            error.code = 'PROJECT_PROVISIONING_AUTHORITY_READBACK_UNAVAILABLE';
            error.statusCode = 503;
            throw error;
        }
        if (typeof this.repository.findIdentityCollisions !== 'function') {
            const error = new Error('Identity collision verification is unavailable');
            error.code = 'PROJECT_PROVISIONING_IDENTITY_COLLISION_CHECK_UNAVAILABLE';
            error.statusCode = 503;
            throw error;
        }
        const existing = await this.repository.getProject(manifest.project_code, organizationId);
        const legacyCollisions = this.repository.findProjectCodeCollision
            ? await this.repository.findProjectCodeCollision(
                manifest.project_code, organizationId
            )
            : [];
        const collisions = [
            ...(existing ? [{ field: 'project_code', value: manifest.project_code, source: 'project_registry' }] : []),
            ...legacyCollisions.map((row) => ({ field: 'project_code', value: manifest.project_code, source: row.source }))
        ];
        const authority = assertAuthorityReadback(
            await this.repository.verifyManifestAuthority(manifest, actor)
        );
        for (const field of AUTHORITY_FIELDS) {
            const valid = authority[field];
            if (!valid) collisions.push({ field, value: false, source: 'authority_readback' });
        }
        const identityCollisions = assertIdentityCollisionReadback(
            await this.repository.findIdentityCollisions(manifest, actor)
        );
        collisions.push(...identityCollisions.map((row) => ({
            field: 'display_name', value: manifest.display_name, source: 'graph_entity', entity_id: row.id
        })));
        let repositoryState = { mode: manifest.repository.mode, status: 'not_requested' };
        if (manifest.repository.mode !== 'none') {
            if (!this.repositoryBootstrap?.read) {
                const error = new Error('Repository Bootstrap readback adapter is not configured');
                error.code = 'PROJECT_PROVISIONING_REPOSITORY_READBACK_UNAVAILABLE';
                error.statusCode = 503;
                throw error;
            }
            const repository = await this.repositoryBootstrap.read(manifest.repository, { organizationId });
            repositoryState = repository
                ? { mode: manifest.repository.mode, status: 'exists', repository }
                : { mode: manifest.repository.mode, status: 'missing' };
            if (manifest.repository.mode === 'link_existing' && !repository) {
                collisions.push({ field: 'repository', value: `${manifest.repository.owner}/${manifest.repository.repo}`, source: 'repository_missing' });
            }
            if (manifest.repository.mode === 'create' && repository) {
                collisions.push({ field: 'repository', value: `${manifest.repository.owner}/${manifest.repository.repo}`, source: 'repository_already_exists' });
            }
            if (repository && repository.visibility !== manifest.repository.visibility) {
                collisions.push({ field: 'repository.visibility', value: repository.visibility, source: 'repository_visibility' });
            }
        }
        return {
            ok: collisions.length === 0,
            manifest,
            collisions,
            repository_state: repositoryState,
            authority,
            writes_performed: 0
        };
    }

    async plan(actor, input, { idempotencyKey }) {
        assertOperator(actor);
        const organizationId = actor.organizationId || actor.tenantId;
        if (!String(idempotencyKey || '').trim()) {
            const error = new Error('Idempotency-Key is required');
            error.code = 'PROJECT_PROVISIONING_IDEMPOTENCY_KEY_REQUIRED';
            error.statusCode = 400;
            throw error;
        }
        const normalized = normalizeProjectProvisioningManifest(input);
        const normalizedFingerprint = fingerprintProjectProvisioningManifest(normalized);
        if (this.repository.getRunByIdempotencyKey) {
            const replay = await this.repository.getRunByIdempotencyKey(idempotencyKey, organizationId);
            if (replay) {
                if (replay.manifest_fingerprint !== normalizedFingerprint) {
                    const error = new Error('Idempotency key is already bound to another manifest');
                    error.code = 'PROJECT_PROVISIONING_IDEMPOTENCY_CONFLICT';
                    error.statusCode = 409;
                    throw error;
                }
                return replay;
            }
        }
        const checked = await this.check(actor, input);
        if (!checked.ok) {
            const error = new Error(`Project code collision: ${checked.manifest.project_code}`);
            error.code = 'PROJECT_PROVISIONING_PROJECT_COLLISION';
            error.statusCode = 409;
            error.details = checked.collisions;
            throw error;
        }
        const manifest = checked.manifest;
        const requiredGates = ['manifest_plan_approval'];
        if (manifest.repository.mode === 'create') requiredGates.push('repository_create');
        if (manifest.repository.visibility === 'public') requiredGates.push('public_repository');
        if (manifest.initial_grants.some((grant) => grant.role === 'ceo')) requiredGates.push('broad_grant');
        const plan = {
            schema_version: 'project-provisioning-plan.v1',
            project_code: manifest.project_code,
            manifest_fingerprint: normalizedFingerprint,
            steps: STEP_ORDER.map((name) => ({ name, action: name === 'repository' ? manifest.repository.mode : 'apply' })),
            required_human_gates: requiredGates,
            preflight: {
                authority: checked.authority,
                repository_state: checked.repository_state,
                collisions: checked.collisions
            },
            rollback_boundary: 'Completed steps are retained and resume is forward-only',
            generated_at: this.now().toISOString()
        };
        return this.repository.savePlan({
            idempotencyKey,
            fingerprint: plan.manifest_fingerprint,
            manifest,
            plan,
            actor: { personId: actor.personId || null, role: actor.role, organizationId: actor.organizationId || actor.tenantId }
        });
    }

    async status(actor, runId) {
        assertOperator(actor);
        const organizationId = actor.organizationId || actor.tenantId;
        const run = await this.repository.getRun(runId, organizationId);
        if (!run) {
            const error = new Error(`Unknown provisioning run: ${runId}`);
            error.code = 'PROJECT_PROVISIONING_RUN_NOT_FOUND';
            error.statusCode = 404;
            throw error;
        }
        return run;
    }

    async approve(actor, runId, { approvedGates = [], reviewRef = null } = {}) {
        assertOperator(actor);
        if (actor.authSource !== 'bearer' || !actor.personId) {
            const error = new Error('Human Gate approval requires a signed human Bearer principal');
            error.code = 'PROJECT_PROVISIONING_SIGNED_HUMAN_REQUIRED';
            error.statusCode = 403;
            throw error;
        }
        const organizationId = actor.organizationId || actor.tenantId;
        const run = await this.status(actor, runId);
        const binding = validateApprovalBinding(run);
        const required = binding.requiredGates;
        const approved = canonicalGateSet(approvedGates) || [];
        const missing = required.filter((gate) => !approved.includes(gate));
        const unsupported = approved.filter((gate) => !required.includes(gate));
        if (missing.length || unsupported.length || !String(reviewRef || '').trim()) {
            const error = new Error('Human Gate receipt must approve the exact plan scope');
            error.code = 'PROJECT_PROVISIONING_HUMAN_GATE_SCOPE_MISMATCH';
            error.statusCode = 409;
            error.details = { missing_gates: missing, unsupported_gates: unsupported };
            throw error;
        }
        if (run.human_gate_receipt) return run;
        return this.repository.recordHumanGate(runId, organizationId, {
            approved_gates: approved,
            approved_by: actor.personId,
            review_ref: reviewRef,
            manifest_fingerprint: run.manifest_fingerprint,
            approved_at: this.now().toISOString()
        });
    }

    async apply(actor, runId, { recoverStaleApplying = false } = {}) {
        assertOperator(actor);
        const organizationId = actor.organizationId || actor.tenantId;
        let run = await this.status(actor, runId);
        if (run.state === 'active') return run;
        const binding = validateApprovalBinding(run);
        const recordedGates = binding.approvedGates || [];
        const missingGates = binding.requiredGates.filter((gate) => !recordedGates.includes(gate));
        if (missingGates.length) {
            return this.repository.setRunState(runId, organizationId, 'manual_intervention_required', {
                failure: { code: 'PROJECT_PROVISIONING_HUMAN_GATE_REQUIRED', missing_gates: missingGates }
            });
        }
        run = this.repository.claimRun
            ? await this.repository.claimRun(runId, organizationId, { recoverStaleApplying })
            : await this.repository.setRunState(runId, organizationId, 'applying');
        if (run.state === 'active') return run;
        const executionToken = run.execution_token || null;
        let heartbeatFailure = null;
        const heartbeat = executionToken && this.repository.heartbeatRun
            ? setInterval(() => {
                this.repository.heartbeatRun(runId, organizationId, executionToken)
                    .catch((error) => { heartbeatFailure = error; });
            }, 60_000)
            : null;
        heartbeat?.unref?.();
        const completed = new Set(run.steps.filter((step) => step.state === 'completed').map((step) => step.step_name));
        try {
            for (const stepName of STEP_ORDER) {
                if (completed.has(stepName)) continue;
                if (heartbeatFailure) throw heartbeatFailure;
                await this.repository.setStep(runId, organizationId, stepName, 'applying', { executionToken });
                const receipt = await this.applyStep(stepName, actor, run);
                if (heartbeatFailure) throw heartbeatFailure;
                await this.repository.setStep(runId, organizationId, stepName, 'completed', { receipt, executionToken });
            }
            const receipt = await this.verify(actor, runId);
            if (!receipt.verified) {
                const error = new Error('Project Provisioning readback verification failed');
                error.code = 'PROJECT_PROVISIONING_READBACK_FAILED';
                error.statusCode = 409;
                error.details = receipt.verification_failures;
                throw error;
            }
            return this.repository.setRunState(runId, organizationId, 'active', { receipt, executionToken });
        } catch (error) {
            const current = await this.repository.getRun(runId, organizationId);
            if (executionToken && current?.execution_token !== executionToken) throw error;
            const step = current.steps
                .find((candidate) => candidate.state === 'applying');
            if (step) {
                await this.repository.setStep(
                    runId, organizationId, step.step_name, 'failed', { failure: errorPayload(error), executionToken }
                );
            }
            await this.repository.setRunState(
                runId, organizationId, 'partial_failed', { failure: errorPayload(error), executionToken }
            );
            throw error;
        } finally {
            if (heartbeat) clearInterval(heartbeat);
        }
    }

    async resume(actor, runId, options = {}) {
        const run = await this.status(actor, runId);
        if (!['partial_failed', 'manual_intervention_required', 'applying', 'planned'].includes(run.state)) return run;
        return this.apply(actor, runId, { ...options, recoverStaleApplying: true });
    }

    async applyStep(stepName, actor, run) {
        const manifest = run.manifest;
        const organizationId = actor.organizationId || actor.tenantId;
        if (stepName === 'registry') return this.repository.upsertProject(manifest, { organizationId });
        if (stepName === 'auth_grants') {
            const grants = [];
            for (const grant of manifest.initial_grants) {
                grants.push(await this.authGrantService.addProjectGrant({
                    personId: grant.person_id, role: grant.role, projectCode: manifest.project_code, organizationId
                }));
            }
            return { grants };
        }
        if (stepName === 'repository') {
            if (manifest.repository.mode === 'none') return { mode: 'none', status: 'not_requested' };
            if (!this.repositoryBootstrap) {
                const error = new Error('Repository Bootstrap adapter is not configured');
                error.code = 'PROJECT_PROVISIONING_REPOSITORY_BOOTSTRAP_UNAVAILABLE';
                error.statusCode = 503;
                throw error;
            }
            if (manifest.repository.mode === 'link_existing') {
                return this.repositoryBootstrap.link(manifest.repository, { organizationId });
            }
            return this.repositoryBootstrap.create(manifest.repository, { organizationId });
        }
        const applyGraph = async () => {
            const access = {
                ...actor,
                organizationId,
                projectCodes: [...new Set([...(actor.projectCodes || []), manifest.project_code])],
                role: actor.role
            };
            const snapshot = await this.graphService.exportSnapshot(access, { projectCode: manifest.project_code });
            if (snapshot.entities.some((entity) => entity.id === manifest.project_code)) {
                return { status: 'already_materialized', snapshot_hash: snapshot.snapshot_hash };
            }
            const graphPlan = await this.graphService.planMutations(access, {
                projectCode: manifest.project_code,
                snapshotId: snapshot.snapshot_id,
                idempotencyKey: `project-provisioning:${run.run_id}:graph`,
                reason: 'Project Provisioning Graph materialization',
                operations: [{
                    operation: 'materialize_project_subject',
                    catalog_project_id: manifest.project_code,
                    expected_version: 0
                }]
            });
            const applied = await this.graphService.applyPlan(access, {
                projectCode: manifest.project_code,
                planId: graphPlan.plan_id,
                snapshotHash: graphPlan.snapshot_hash
            });
            const graphReceipt = await this.graphService.getPlanReceipt(access, {
                projectCode: manifest.project_code, planId: graphPlan.plan_id
            });
            const validation = await this.graphService.validate(access, { projectCode: manifest.project_code });
            if (validation?.valid !== true) {
                const error = new Error('Graph validation failed after project materialization');
                error.code = 'PROJECT_PROVISIONING_GRAPH_VALIDATION_FAILED';
                error.statusCode = 409;
                error.details = validation;
                throw error;
            }
            return { plan_id: graphPlan.plan_id, apply: applied, receipt: graphReceipt, validation };
        };
        return this.catalogAdapter
            ? this.catalogAdapter.runForOrganization(organizationId, applyGraph)
            : applyGraph();
    }

    async verify(actor, runId) {
        const run = await this.status(actor, runId);
        const organizationId = actor.organizationId || actor.tenantId;
        const project = await this.repository.getProject(
            run.manifest.project_code, organizationId
        );
        const incomplete = run.steps.filter((step) => step.state !== 'completed').map((step) => step.step_name);
        const failures = [];
        const registryMatches = project
            && project.lifecycle_status === 'active'
            && project.project_code === run.manifest.project_code
            && project.display_name === run.manifest.display_name
            && project.kind === run.manifest.kind
            && project.catalog_version === run.manifest.catalog_version
            && project.session_select === run.manifest.session_select
            && project.organization_entity_id === run.manifest.organization_entity_id
            && project.owner_person_id === run.manifest.owner_person_id;
        if (!registryMatches) {
            failures.push({ layer: 'project_registry', code: 'registry_readback_mismatch' });
        }
        let catalogReadback = null;
        if (this.catalogAdapter) {
            catalogReadback = await this.catalogAdapter.runForOrganization(
                organizationId,
                () => this.catalogAdapter.getProjects()
            );
            const catalogProject = catalogReadback.projects?.find((candidate) => candidate.id === run.manifest.project_code);
            if (catalogReadback.source?.status !== 'loaded') {
                failures.push({
                    layer: 'runtime_catalog',
                    code: 'catalog_readback_unavailable',
                    source_status: catalogReadback.source?.status || 'unknown'
                });
            } else if (!catalogProject
                || catalogProject.name !== run.manifest.display_name
                || catalogProject.session_select !== run.manifest.session_select) {
                failures.push({ layer: 'runtime_catalog', code: 'catalog_readback_mismatch' });
            }
        } else {
            failures.push({ layer: 'runtime_catalog', code: 'catalog_readback_unavailable' });
        }
        const graphAccess = {
            ...actor,
            projectCodes: [...new Set([...(actor.projectCodes || []), run.manifest.project_code])]
        };
        const graphValidation = await (this.catalogAdapter
            ? this.catalogAdapter.runForOrganization(actor.organizationId || actor.tenantId, () => (
                this.graphService.validate(graphAccess, { projectCode: run.manifest.project_code })
            ))
            : this.graphService.validate(graphAccess, { projectCode: run.manifest.project_code }));
        if (graphValidation?.valid !== true) failures.push({ layer: 'graph', code: 'graph_validation_failed' });
        for (const grant of run.manifest.initial_grants) {
            const readback = await this.authGrantService.readProjectGrant?.({
                personId: grant.person_id, role: grant.role, projectCode: run.manifest.project_code,
                organizationId
            });
            if (!readback) failures.push({ layer: 'auth_grants', code: 'grant_readback_missing', person_id: grant.person_id, role: grant.role });
        }
        let repositoryReadback = null;
        if (run.manifest.repository.mode !== 'none') {
            repositoryReadback = await this.repositoryBootstrap?.read(
                run.manifest.repository,
                { organizationId }
            );
            if (!repositoryReadback
                || repositoryReadback.visibility !== run.manifest.repository.visibility
                || repositoryReadback.repo !== run.manifest.repository.repo
                || repositoryReadback.owner !== run.manifest.repository.owner) {
                failures.push({ layer: 'repository', code: 'repository_readback_mismatch' });
            }
        }
        return {
            schema_version: 'project-provisioning-receipt.v1',
            run_id: runId,
            project_code: run.manifest.project_code,
            verified: Boolean(project) && incomplete.length === 0 && failures.length === 0,
            incomplete_steps: incomplete,
            verification_failures: failures,
            graph_validation: graphValidation,
            repository_readback: repositoryReadback,
            project_registry: project,
            runtime_catalog: catalogReadback,
            steps: run.steps.map(({ step_name, state, receipt }) => ({ step_name, state, receipt })),
            verified_at: this.now().toISOString()
        };
    }
}

export function createProjectProvisioningService({ infoSSOTService, configParser = null }) {
    const repository = new PgProjectProvisioningRepository({
        pool: infoSSOTService?.pool,
        infoSSOTService
    });
    const catalog = new ProjectRegistryCatalogAdapter({ repository, fallbackConfigParser: configParser });
    const service = new ProjectProvisioningService({
        repository,
        graphService: new GraphMaintenanceService({ infoSSOTService, configParser: catalog }),
        authGrantService: new AuthGrantService({ pool: infoSSOTService?.pool }),
        repositoryBootstrap: new GitHubRepositoryBootstrap(),
        catalogAdapter: catalog
    });
    service.runtimeCatalog = catalog;
    return service;
}
