export class CanonicalTaskReadinessError extends Error {
    constructor(code = 'canonical_task_mutation_not_ready', message = 'Canonical Task mutation is not ready') {
        super(message);
        this.name = 'CanonicalTaskReadinessError';
        this.code = code;
        this.status = 503;
    }
}

export class CanonicalTaskReadiness {
    constructor({
        operationRepository = null,
        manifestHash = null,
        schemaVersion = null,
        sourceHead = null,
        sourceHeadRebindGuard = null,
        logger = console
    } = {}) {
        this.operationRepository = operationRepository;
        this.expected = { manifestHash, schemaVersion, sourceHead };
        this.sourceHeadRebindGuard = sourceHeadRebindGuard;
        this.logger = logger;
        this.ready = false;
        this.reason = 'readiness_not_verified';
        this.evidence = null;
    }

    open(evidence = null) {
        this.ready = true;
        this.reason = null;
        this.evidence = evidence;
    }

    close(reason = 'readiness_disabled') {
        this.ready = false;
        this.reason = reason;
        this.evidence = null;
    }

    matches(row) {
        return Boolean(
            row?.ready
            && row.writer_token === this.operationRepository.writerToken
            && row.manifest_hash === this.expected.manifestHash
            && row.schema_version === this.expected.schemaVersion
            && row.source_head === this.expected.sourceHead
            && row.evidence_hash
        );
    }

    async refresh({ allowWriterRebind = false } = {}) {
        const row = await this.operationRepository.reconcileReadiness({
            manifestHash: this.expected.manifestHash,
            schemaVersion: this.expected.schemaVersion,
            sourceHead: this.expected.sourceHead,
            allowWriterRebind
        });
        if (!this.matches(row)) {
            this.close(row?.ready ? 'persisted_readiness_mismatch' : (row?.reason || 'persisted_readiness_missing'));
            return { ready: false, reason: this.reason };
        }
        this.open({
            evidence_hash: row.evidence_hash,
            evidence_path: row.evidence_path,
            updated_at: row.updated_at
        });
        return { ready: true, evidence: this.evidence };
    }

    // Readiness rows are blessed for one source_head. When a deploy restarts the
    // process on a newer HEAD, mutation stays fail-closed unless the guard proves
    // no canonical-task-relevant path changed between the blessed head and ours.
    async attemptSourceHeadRebind() {
        if (!this.sourceHeadRebindGuard || typeof this.operationRepository.rebindReadinessSourceHead !== 'function') {
            return false;
        }
        const row = await this.operationRepository.readReadiness();
        const rebindCandidate = Boolean(
            row?.ready
            && row.manifest_hash === this.expected.manifestHash
            && row.schema_version === this.expected.schemaVersion
            && row.evidence_hash
            && row.source_head
            && row.source_head !== this.expected.sourceHead
        );
        if (!rebindCandidate) return false;
        const verdict = await this.sourceHeadRebindGuard({
            fromHead: row.source_head,
            toHead: this.expected.sourceHead
        });
        if (!verdict?.allowed) {
            this.logger?.warn?.(
                `[canonical-task] source_head rebind refused (${verdict?.reason || 'unknown'}): `
                + `${row.source_head} -> ${this.expected.sourceHead}`
                + (verdict?.changedPaths?.length ? ` changed=${verdict.changedPaths.join(',')}` : '')
            );
            return false;
        }
        await this.operationRepository.rebindReadinessSourceHead({
            manifestHash: this.expected.manifestHash,
            schemaVersion: this.expected.schemaVersion,
            fromHead: row.source_head,
            toHead: this.expected.sourceHead
        });
        this.logger?.warn?.(
            `[canonical-task] readiness source_head rebound after guarded diff check: `
            + `${row.source_head} -> ${this.expected.sourceHead}`
        );
        return true;
    }

    async initialize() {
        this.close('readiness_not_verified');
        if (!this.operationRepository) {
            this.close('coordination_repository_unavailable');
            return { ready: false, reason: this.reason };
        }
        try {
            await this.operationRepository.claimWriter({ sourceHead: this.expected.sourceHead });
            const result = await this.refresh({ allowWriterRebind: true });
            if (result.ready || this.reason !== 'persisted_readiness_mismatch') return result;
            if (await this.attemptSourceHeadRebind()) {
                return await this.refresh({ allowWriterRebind: true });
            }
            return result;
        } catch (error) {
            this.close(error?.code || 'readiness_reconcile_failed');
            return { ready: false, reason: this.reason, error };
        }
    }

    async assertMutationReady() {
        try {
            await this.refresh({ allowWriterRebind: false });
        } catch (error) {
            this.close(error?.code || 'readiness_reconcile_failed');
        }
        if (!this.ready) {
            const error = new CanonicalTaskReadinessError();
            error.details = { reason: this.reason };
            throw error;
        }
    }
}
