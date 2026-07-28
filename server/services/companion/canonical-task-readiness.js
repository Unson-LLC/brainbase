export class CanonicalTaskReadinessError extends Error {
    constructor(code = 'canonical_task_mutation_not_ready', message = 'Canonical Task mutation is not ready') {
        super(message);
        this.name = 'CanonicalTaskReadinessError';
        this.code = code;
        this.status = 503;
    }
}

export class CanonicalTaskReadiness {
    constructor({ operationRepository = null, manifestHash = null, schemaVersion = null, sourceHead = null } = {}) {
        this.operationRepository = operationRepository;
        this.expected = { manifestHash, schemaVersion, sourceHead };
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

    async initialize() {
        this.close('readiness_not_verified');
        if (!this.operationRepository) {
            this.close('coordination_repository_unavailable');
            return { ready: false, reason: this.reason };
        }
        try {
            await this.operationRepository.claimWriter({ sourceHead: this.expected.sourceHead });
            return await this.refresh({ allowWriterRebind: true });
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
