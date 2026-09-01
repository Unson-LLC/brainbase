import { describe, expect, it, vi } from 'vitest';
import { ProjectProvisioningService } from '../../../server/services/project-provisioning/project-provisioning-service.js';

const actor = { role: 'gm', personId: 'person_owner', organizationId: 'unson', projectCodes: [], authSource: 'bearer' };
const manifest = {
    schema_version: 'project-provisioning.v1', project_code: 'growin-ai', display_name: 'Growin AI',
    kind: 'client', catalog_version: 1, session_select: true,
    organization_entity_id: 'org_unson', owner_person_id: 'person_owner',
    initial_grants: [{ person_id: 'person_owner', role: 'gm' }],
    repository: { mode: 'link_existing', owner: 'Unson-LLC', repo: 'growin-project' }
};

class MemoryRepository {
    constructor({ authority = {}, identityCollisions = [] } = {}) {
        this.projects = new Map(); this.runs = new Map(); this.keys = new Map();
        this.authority = {
            organization_exists: true,
            owner_person_exists: true,
            organization_entity_exists: true,
            owner_has_organization_grant: true,
            ...authority
        };
        this.identityCollisions = identityCollisions;
    }
    async getProject(code) { return this.projects.get(code) || null; }
    async verifyManifestAuthority() { return structuredClone(this.authority); }
    async findIdentityCollisions() { return structuredClone(this.identityCollisions); }
    async savePlan(input) {
        const key = `${input.actor.organizationId}:${input.idempotencyKey}`;
        const existingId = this.keys.get(key);
        if (existingId) {
            const existing = this.runs.get(existingId);
            if (existing.manifest_fingerprint !== input.fingerprint) {
                const error = new Error('conflict'); error.code = 'PROJECT_PROVISIONING_IDEMPOTENCY_CONFLICT'; error.statusCode = 409; throw error;
            }
            return structuredClone(existing);
        }
        const run = {
            run_id: `run_${this.runs.size + 1}`, idempotency_key: input.idempotencyKey,
            manifest_fingerprint: input.fingerprint, manifest: input.manifest, plan: input.plan, state: 'planned',
            steps: input.plan.steps.map((step) => ({ step_name: step.name, state: 'pending', attempt: 0 }))
        };
        run.organization_id = input.actor.organizationId;
        this.runs.set(run.run_id, run); this.keys.set(key, run.run_id); return structuredClone(run);
    }
    async getRunByIdempotencyKey(key, organizationId) {
        const id = this.keys.get(`${organizationId}:${key}`);
        return id ? this.getRun(id, organizationId) : null;
    }
    async getRun(id, organizationId) {
        const run = this.runs.get(id);
        return run?.organization_id === organizationId ? structuredClone(run) : null;
    }
    async setRunState(id, organizationId, state, payload = {}) {
        const run = this.runs.get(id); Object.assign(run, { state, ...payload }); return structuredClone(run);
    }
    async claimRun(id, organizationId) { return this.setRunState(id, organizationId, 'applying'); }
    async recordHumanGate(id, _organizationId, receipt) {
        const run = this.runs.get(id);
        if (run.human_gate_receipt) throw new Error('human gate receipt is immutable');
        run.human_gate_receipt = receipt;
        return structuredClone(run);
    }
    async setStep(id, _organizationId, name, state, payload = {}) {
        const step = this.runs.get(id).steps.find((item) => item.step_name === name);
        Object.assign(step, { state, ...payload, attempt: step.attempt + 1 });
    }
    async upsertProject(input) {
        const row = {
            project_code: input.project_code, display_name: input.display_name,
            catalog_version: input.catalog_version, lifecycle_status: 'active',
            session_select: input.session_select, kind: input.kind,
            organization_entity_id: input.organization_entity_id,
            owner_person_id: input.owner_person_id
        };
        this.projects.set(input.project_code, row); return row;
    }
}

function createHarness({ failGrantOnce = false, authority, identityCollisions = [], graphEntities = [] } = {}) {
    const repository = new MemoryRepository({ authority, identityCollisions });
    const graphCalls = [];
    const graphService = {
        listAccessibleProjectCodes: vi.fn(async (access) => (
            access.projectCodes.filter((code) => code !== 'aitle')
        )),
        exportSnapshot: vi.fn(async () => { graphCalls.push('exportSnapshot'); return { snapshot_id: 'snap_1', snapshot_hash: 'hash_1', entities: structuredClone(graphEntities) }; }),
        planMutations: vi.fn(async () => { graphCalls.push('planMutations'); return { plan_id: 'gplan_1', snapshot_hash: 'hash_1' }; }),
        applyPlan: vi.fn(async () => { graphCalls.push('applyPlan'); return { receipt_id: 'apply_1' }; }),
        getPlanReceipt: vi.fn(async () => { graphCalls.push('getPlanReceipt'); return { receipts: [{ id: 'apply_1' }] }; }),
        validate: vi.fn(async () => { graphCalls.push('validate'); return { valid: true }; })
    };
    let failed = false;
    const authGrantService = {
        addProjectGrant: vi.fn(async () => {
            if (failGrantOnce && !failed) { failed = true; throw new Error('temporary grant failure'); }
            return { id: 'grant_1', project_codes: ['growin-ai'] };
        }),
        readProjectGrant: vi.fn(async () => ({ id: 'grant_1', project_codes: ['growin-ai'] }))
    };
    const createdRepositories = new Map();
    const repositoryKey = (input) => `${input.owner}/${input.repo}`;
    const repositoryBootstrap = {
        read: vi.fn(async (repositoryInput) => createdRepositories.get(repositoryKey(repositoryInput))
            || (repositoryInput.mode === 'create' ? null : { ...repositoryInput, visibility: repositoryInput.visibility })),
        link: vi.fn(async (repositoryInput) => ({ ...repositoryInput, status: 'verified' })),
        create: vi.fn(async (repositoryInput) => {
            const receipt = { ...repositoryInput, status: 'created_verified' };
            createdRepositories.set(repositoryKey(repositoryInput), receipt);
            return receipt;
        })
    };
    const catalogAdapter = {
        runForOrganization: vi.fn(async (_organizationId, callback) => callback()),
        getProjects: vi.fn(async () => ({
            source: { status: 'loaded', mode: 'registry_merged' },
            projects: Array.from(repository.projects.values()).map((project) => ({
                id: project.project_code,
                name: project.display_name,
                session_select: project.session_select
            }))
        }))
    };
    return {
        repository, graphService, graphCalls, authGrantService, repositoryBootstrap, catalogAdapter,
        service: new ProjectProvisioningService({ repository, graphService, authGrantService, repositoryBootstrap, catalogAdapter })
    };
}

describe('ProjectProvisioningService', () => {
    it('checkは書き込みを行わない', async () => {
        const { service, repository } = createHarness();
        await expect(service.check(actor, manifest)).resolves.toMatchObject({ ok: true, writes_performed: 0 });
        expect(repository.runs.size).toBe(0);
        expect(repository.projects.size).toBe(0);
    });

    it.each([
        ['organization', 'organization_exists'],
        ['cross-organization graph entity', 'organization_entity_exists'],
        ['owner', 'owner_person_exists'],
        ['organization grant', 'owner_has_organization_grant']
    ])('authority readbackが%s不在を拒否する', async (_label, field) => {
        const { service } = createHarness({ authority: { [field]: false } });

        const result = await service.check(actor, manifest);

        expect(result.ok).toBe(false);
        expect(result.authority[field]).toBe(false);
        expect(result.collisions).toContainEqual({
            field,
            value: false,
            source: 'authority_readback'
        });
    });

    it('display nameのGraph identity collisionを拒否する', async () => {
        const { service } = createHarness({
            identityCollisions: [{ id: 'existing-display', entity_type: 'project' }]
        });

        const result = await service.check(actor, manifest);

        expect(result.ok).toBe(false);
        expect(result.collisions).toContainEqual({
            field: 'display_name',
            value: manifest.display_name,
            source: 'graph_entity',
            entity_id: 'existing-display'
        });
    });

    it('authority readback依存が欠ける場合はfail closedする', async () => {
        const { service, repository } = createHarness();
        repository.verifyManifestAuthority = undefined;

        await expect(service.check(actor, manifest)).rejects.toMatchObject({
            code: 'PROJECT_PROVISIONING_AUTHORITY_READBACK_UNAVAILABLE',
            statusCode: 503
        });
    });

    it('identity collision readback依存が欠ける場合はfail closedする', async () => {
        const { service, repository } = createHarness();
        repository.findIdentityCollisions = undefined;

        await expect(service.check(actor, manifest)).rejects.toMatchObject({
            code: 'PROJECT_PROVISIONING_IDENTITY_COLLISION_CHECK_UNAVAILABLE',
            statusCode: 503
        });
    });

    it('authority readbackが不完全な場合はfail closedする', async () => {
        const { service, repository } = createHarness();
        repository.verifyManifestAuthority = vi.fn(async () => ({ organization_exists: true }));

        await expect(service.check(actor, manifest)).rejects.toMatchObject({
            code: 'PROJECT_PROVISIONING_AUTHORITY_READBACK_INVALID',
            statusCode: 503
        });
    });

    it('identity collision readbackが配列でない場合はfail closedする', async () => {
        const { service, repository } = createHarness();
        repository.findIdentityCollisions = vi.fn(async () => ({ rows: [] }));

        await expect(service.check(actor, manifest)).rejects.toMatchObject({
            code: 'PROJECT_PROVISIONING_IDENTITY_COLLISION_READBACK_INVALID',
            statusCode: 503
        });
    });

    it('同じidempotency keyを同じrunへreplayする', async () => {
        const { service } = createHarness();
        const first = await service.plan(actor, manifest, { idempotencyKey: 'growin-1' });
        const second = await service.plan(actor, manifest, { idempotencyKey: 'growin-1' });
        expect(second.run_id).toBe(first.run_id);
    });

    it('別organizationからrunを参照できない', async () => {
        const { service } = createHarness();
        const plan = await service.plan(actor, manifest, { idempotencyKey: 'growin-tenant' });
        await expect(service.status({ ...actor, organizationId: 'other-org' }, plan.run_id))
            .rejects.toMatchObject({ code: 'PROJECT_PROVISIONING_RUN_NOT_FOUND' });
    });

    it('partial_failedから完了stepを保持してresumeする', async () => {
        const { service, graphService } = createHarness({ failGrantOnce: true });
        const plan = await service.plan(actor, manifest, { idempotencyKey: 'growin-2' });
        await service.approve(actor, plan.run_id, {
            approvedGates: ['manifest_plan_approval'], reviewRef: 'review-baseline'
        });
        await expect(service.apply(actor, plan.run_id)).rejects.toThrow('temporary grant failure');
        await expect(service.status(actor, plan.run_id)).resolves.toMatchObject({ state: 'partial_failed' });
        const resumed = await service.resume(actor, plan.run_id);
        expect(resumed.state).toBe('active');
        expect(graphService.applyPlan).toHaveBeenCalledTimes(1);
        expect(resumed.receipt.verified).toBe(true);
    });

    it('repository createはHuman Gateなしで止まる', async () => {
        const { service } = createHarness();
        const plan = await service.plan(actor, { ...manifest, repository: { mode: 'create', owner: 'Unson-LLC', repo: 'new-project' } }, { idempotencyKey: 'growin-3' });
        const result = await service.apply(actor, plan.run_id);
        expect(result.state).toBe('manual_intervention_required');
        expect(result.failure.missing_gates).toContain('repository_create');
        expect(result.failure.missing_gates).toContain('manifest_plan_approval');
    });

    it('public repository planはrequired Human Gateを正確に宣言する', async () => {
        const { service } = createHarness();
        const publicManifest = {
            ...manifest,
            repository: { mode: 'create', owner: 'Unson-LLC', repo: 'new-public-project', visibility: 'public' }
        };

        const plan = await service.plan(actor, publicManifest, { idempotencyKey: 'growin-public-gates' });

        expect(plan.plan.required_human_gates).toEqual([
            'manifest_plan_approval', 'repository_create', 'public_repository'
        ]);
    });

    it('public repository gateが欠けた状態では外部書き込みを行わない', async () => {
        const { service, repository, graphService, authGrantService, repositoryBootstrap } = createHarness();
        const publicManifest = {
            ...manifest,
            repository: { mode: 'create', owner: 'Unson-LLC', repo: 'new-public-project', visibility: 'public' }
        };
        const plan = await service.plan(actor, publicManifest, { idempotencyKey: 'growin-public-missing-gate' });

        await expect(service.approve(actor, plan.run_id, {
            approvedGates: ['manifest_plan_approval', 'repository_create'], reviewRef: 'growin-public-incomplete'
        })).rejects.toMatchObject({ code: 'PROJECT_PROVISIONING_HUMAN_GATE_SCOPE_MISMATCH' });
        const result = await service.apply(actor, plan.run_id);

        expect(result).toMatchObject({
            state: 'manual_intervention_required',
            failure: {
                missing_gates: ['manifest_plan_approval', 'public_repository', 'repository_create']
            }
        });
        expect(repository.projects.size).toBe(0);
        expect(graphService.applyPlan).not.toHaveBeenCalled();
        expect(authGrantService.addProjectGrant).not.toHaveBeenCalled();
        expect(repositoryBootstrap.create).not.toHaveBeenCalled();
    });

    it('link_existingでもManifestとPlanの承認前は一切書き込まない', async () => {
        const { service, repository, graphService, authGrantService, repositoryBootstrap } = createHarness();
        const plan = await service.plan(actor, manifest, { idempotencyKey: 'growin-baseline-gate' });

        const result = await service.apply(actor, plan.run_id);

        expect(result).toMatchObject({
            state: 'manual_intervention_required',
            failure: { missing_gates: ['manifest_plan_approval'] }
        });
        expect(repository.projects.size).toBe(0);
        expect(graphService.applyPlan).not.toHaveBeenCalled();
        expect(authGrantService.addProjectGrant).not.toHaveBeenCalled();
        expect(repositoryBootstrap.link).not.toHaveBeenCalled();
    });

    it('Human Gate承認後のpartial failureは承認Receiptを再利用してresumeする', async () => {
        const { service } = createHarness({ failGrantOnce: true });
        const createManifest = {
            ...manifest,
            repository: { mode: 'create', owner: 'Unson-LLC', repo: 'new-project' }
        };
        const plan = await service.plan(actor, createManifest, { idempotencyKey: 'growin-4' });
        await service.approve(actor, plan.run_id, {
            approvedGates: ['manifest_plan_approval', 'repository_create'], reviewRef: 'review-1'
        });
        await expect(service.apply(actor, plan.run_id)).rejects.toThrow('temporary grant failure');

        const resumed = await service.resume(actor, plan.run_id);

        expect(resumed.state).toBe('active');
        expect(resumed.human_gate_receipt.review_ref).toBe('review-1');
    });

    it('承認後にrun fingerprintが改変された場合は最初の書き込み前に停止する', async () => {
        const { service, repository, graphService, authGrantService, repositoryBootstrap } = createHarness();
        const plan = await service.plan(actor, manifest, { idempotencyKey: 'growin-run-fingerprint-mutation' });
        await service.approve(actor, plan.run_id, {
            approvedGates: ['manifest_plan_approval'], reviewRef: 'review-fingerprint-run'
        });
        repository.runs.get(plan.run_id).manifest_fingerprint = 'tampered-run-fingerprint';
        const claimRun = vi.spyOn(repository, 'claimRun');

        await expect(service.apply(actor, plan.run_id)).rejects.toMatchObject({
            code: 'PROJECT_PROVISIONING_HUMAN_GATE_BINDING_MISMATCH'
        });
        expect(claimRun).not.toHaveBeenCalled();
        expect(repository.projects.size).toBe(0);
        expect(graphService.applyPlan).not.toHaveBeenCalled();
        expect(authGrantService.addProjectGrant).not.toHaveBeenCalled();
        expect(repositoryBootstrap.link).not.toHaveBeenCalled();
    });

    it('承認後にplan fingerprintが改変された場合は最初の書き込み前に停止する', async () => {
        const { service, repository, graphService, authGrantService, repositoryBootstrap } = createHarness();
        const plan = await service.plan(actor, manifest, { idempotencyKey: 'growin-plan-fingerprint-mutation' });
        await service.approve(actor, plan.run_id, {
            approvedGates: ['manifest_plan_approval'], reviewRef: 'review-fingerprint-plan'
        });
        repository.runs.get(plan.run_id).plan.manifest_fingerprint = 'tampered-plan-fingerprint';
        const claimRun = vi.spyOn(repository, 'claimRun');

        await expect(service.resume(actor, plan.run_id)).rejects.toMatchObject({
            code: 'PROJECT_PROVISIONING_HUMAN_GATE_BINDING_MISMATCH'
        });
        expect(claimRun).not.toHaveBeenCalled();
        expect(repository.projects.size).toBe(0);
        expect(graphService.applyPlan).not.toHaveBeenCalled();
        expect(authGrantService.addProjectGrant).not.toHaveBeenCalled();
        expect(repositoryBootstrap.link).not.toHaveBeenCalled();
    });

    it('承認Receiptのmanifest fingerprintが改変された場合はapplyの最初の書き込み前に停止する', async () => {
        const { service, repository, graphService, authGrantService, repositoryBootstrap } = createHarness();
        const plan = await service.plan(actor, manifest, { idempotencyKey: 'growin-receipt-fingerprint-mutation' });
        await service.approve(actor, plan.run_id, {
            approvedGates: ['manifest_plan_approval'], reviewRef: 'review-fingerprint-receipt'
        });
        repository.runs.get(plan.run_id).human_gate_receipt.manifest_fingerprint = 'tampered-receipt-fingerprint';
        const claimRun = vi.spyOn(repository, 'claimRun');

        await expect(service.apply(actor, plan.run_id)).rejects.toMatchObject({
            code: 'PROJECT_PROVISIONING_HUMAN_GATE_BINDING_MISMATCH'
        });
        expect(claimRun).not.toHaveBeenCalled();
        expect(repository.projects.size).toBe(0);
        expect(graphService.applyPlan).not.toHaveBeenCalled();
        expect(authGrantService.addProjectGrant).not.toHaveBeenCalled();
        expect(repositoryBootstrap.link).not.toHaveBeenCalled();
    });

    it('承認Receiptのapproved gate集合が改変された場合はresumeの最初の書き込み前に停止する', async () => {
        const { service, repository, graphService, authGrantService, repositoryBootstrap } = createHarness();
        const plan = await service.plan(actor, manifest, { idempotencyKey: 'growin-receipt-gate-mutation' });
        await service.approve(actor, plan.run_id, {
            approvedGates: ['manifest_plan_approval'], reviewRef: 'review-gates-receipt'
        });
        repository.runs.get(plan.run_id).human_gate_receipt.approved_gates = [];
        const claimRun = vi.spyOn(repository, 'claimRun');

        await expect(service.resume(actor, plan.run_id)).rejects.toMatchObject({
            code: 'PROJECT_PROVISIONING_HUMAN_GATE_BINDING_MISMATCH'
        });
        expect(claimRun).not.toHaveBeenCalled();
        expect(repository.projects.size).toBe(0);
        expect(graphService.applyPlan).not.toHaveBeenCalled();
        expect(authGrantService.addProjectGrant).not.toHaveBeenCalled();
        expect(repositoryBootstrap.link).not.toHaveBeenCalled();
    });

    it('承認後にrequired gate集合が改変された場合は最初の書き込み前に停止する', async () => {
        const { service, repository, graphService, authGrantService, repositoryBootstrap } = createHarness();
        const plan = await service.plan(actor, manifest, { idempotencyKey: 'growin-gate-set-mutation' });
        await service.approve(actor, plan.run_id, {
            approvedGates: ['manifest_plan_approval'], reviewRef: 'review-gate-set'
        });
        repository.runs.get(plan.run_id).plan.required_human_gates = [
            'manifest_plan_approval', 'unexpected_gate'
        ];
        const claimRun = vi.spyOn(repository, 'claimRun');

        await expect(service.apply(actor, plan.run_id)).rejects.toMatchObject({
            code: 'PROJECT_PROVISIONING_HUMAN_GATE_BINDING_MISMATCH'
        });
        expect(claimRun).not.toHaveBeenCalled();
        expect(repository.projects.size).toBe(0);
        expect(graphService.applyPlan).not.toHaveBeenCalled();
        expect(authGrantService.addProjectGrant).not.toHaveBeenCalled();
        expect(repositoryBootstrap.link).not.toHaveBeenCalled();
    });

    it('Human GateはBearer認証とPlan完全一致scopeを要求する', async () => {
        const { service } = createHarness();
        const plan = await service.plan(actor, {
            ...manifest,
            repository: { mode: 'create', owner: 'Unson-LLC', repo: 'new-project', visibility: 'public' }
        }, { idempotencyKey: 'growin-gate-scope' });

        await expect(service.approve({ ...actor, authSource: 'insecure_header' }, plan.run_id, {
            approvedGates: ['manifest_plan_approval', 'repository_create', 'public_repository'], reviewRef: 'review-2'
        })).rejects.toMatchObject({ code: 'PROJECT_PROVISIONING_SIGNED_HUMAN_REQUIRED' });
        await expect(service.approve(actor, plan.run_id, {
            approvedGates: ['repository_create'], reviewRef: 'review-2'
        })).rejects.toMatchObject({ code: 'PROJECT_PROVISIONING_HUMAN_GATE_SCOPE_MISMATCH' });
    });

    it('実読戻しが欠ける場合はactiveへ遷移しない', async () => {
        const { service, authGrantService } = createHarness();
        authGrantService.readProjectGrant.mockResolvedValueOnce(null);
        const plan = await service.plan(actor, manifest, { idempotencyKey: 'growin-readback' });
        await service.approve(actor, plan.run_id, {
            approvedGates: ['manifest_plan_approval'], reviewRef: 'review-readback'
        });

        await expect(service.apply(actor, plan.run_id)).rejects.toMatchObject({
            code: 'PROJECT_PROVISIONING_READBACK_FAILED'
        });
        await expect(service.status(actor, plan.run_id)).resolves.toMatchObject({ state: 'partial_failed' });
    });

    it('runtime catalogの読戻しが欠ける場合はactiveへ遷移しない', async () => {
        const { service, catalogAdapter } = createHarness();
        catalogAdapter.getProjects.mockResolvedValueOnce({
            source: { status: 'unavailable', mode: 'legacy_fallback' },
            projects: [{
                id: manifest.project_code,
                name: manifest.display_name,
                session_select: manifest.session_select
            }]
        });
        const plan = await service.plan(actor, manifest, { idempotencyKey: 'growin-catalog-readback' });
        await service.approve(actor, plan.run_id, {
            approvedGates: ['manifest_plan_approval'], reviewRef: 'review-catalog-readback'
        });

        const applyFailure = await service.apply(actor, plan.run_id).then(
            () => null,
            (error) => error
        );
        expect(applyFailure).toMatchObject({ code: 'PROJECT_PROVISIONING_READBACK_FAILED' });
        expect(applyFailure.details).toContainEqual({
            layer: 'runtime_catalog',
            code: 'catalog_readback_unavailable',
            source_status: 'unavailable'
        });
        await expect(service.status(actor, plan.run_id)).resolves.toMatchObject({ state: 'partial_failed' });
    });

    it('Graphの正式ライフサイクル順とReceiptをstepへ保存する', async () => {
        const { service, repository, graphCalls } = createHarness();
        const plan = await service.plan(actor, manifest, { idempotencyKey: 'growin-graph-order' });
        await service.approve(actor, plan.run_id, {
            approvedGates: ['manifest_plan_approval'], reviewRef: 'review-graph'
        });

        await service.apply(actor, plan.run_id);

        expect(graphCalls.slice(0, 5)).toEqual([
            'exportSnapshot', 'planMutations', 'applyPlan', 'getPlanReceipt', 'validate'
        ]);
        const stored = repository.runs.get(plan.run_id);
        expect(stored.steps.find((step) => step.step_name === 'graph').receipt).toMatchObject({
            plan_id: 'gplan_1', receipt: { receipts: [{ id: 'apply_1' }] }
        });
    });

    it('同一組織の別scopeにある完全一致Project subjectを再利用する', async () => {
        const existingSubject = {
            id: manifest.project_code,
            entity_type: 'project',
            project_code: 'brainbase',
            lifecycle_status: 'active',
            version: 3,
            payload: {
                name: manifest.display_name,
                catalog_project_id: manifest.project_code,
                catalog_version: manifest.catalog_version,
                source_ref: `project-catalog:${manifest.project_code}@${manifest.catalog_version}`
            }
        };
        const { service, repository, graphService } = createHarness({ graphEntities: [existingSubject] });
        const scopedActor = { ...actor, projectCodes: ['brainbase', 'aitle'] };
        const plan = await service.plan(scopedActor, manifest, { idempotencyKey: 'growin-existing-subject' });
        await service.approve(scopedActor, plan.run_id, {
            approvedGates: ['manifest_plan_approval'], reviewRef: 'review-existing-subject'
        });

        await service.apply(scopedActor, plan.run_id);

        expect(graphService.exportSnapshot).toHaveBeenCalledWith(expect.objectContaining({
            projectCodes: expect.arrayContaining(['brainbase', 'aitle', manifest.project_code])
        }), {
            projectCode: manifest.project_code,
            includeProjectCodes: ['brainbase']
        });
        expect(graphService.planMutations).not.toHaveBeenCalled();
        expect(repository.runs.get(plan.run_id).steps.find((step) => step.step_name === 'graph').receipt).toMatchObject({
            status: 'already_materialized', project_code: 'brainbase', entity_version: 3
        });
    });

    it('同一IDでもCatalog identityが一致しないProject subjectは拒否する', async () => {
        const { service } = createHarness({ graphEntities: [{
            id: manifest.project_code,
            entity_type: 'project',
            project_code: 'brainbase',
            lifecycle_status: 'active',
            version: 1,
            payload: { name: 'Different project', catalog_project_id: manifest.project_code, catalog_version: 1 }
        }] });
        const scopedActor = { ...actor, projectCodes: ['brainbase'] };
        const plan = await service.plan(scopedActor, manifest, { idempotencyKey: 'growin-conflicting-subject' });
        await service.approve(scopedActor, plan.run_id, {
            approvedGates: ['manifest_plan_approval'], reviewRef: 'review-conflicting-subject'
        });

        await expect(service.apply(scopedActor, plan.run_id)).rejects.toMatchObject({
            code: 'PROJECT_PROVISIONING_GRAPH_IDENTITY_CONFLICT'
        });
        await expect(service.status(scopedActor, plan.run_id)).resolves.toMatchObject({
            state: 'partial_failed',
            failure: expect.objectContaining({ message: 'Existing Graph project subject does not match the Project Catalog identity' })
        });
    });
});
