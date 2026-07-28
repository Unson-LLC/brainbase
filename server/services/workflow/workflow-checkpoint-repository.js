const WORKFLOW_CHECKPOINT_SCOPE = 'workflow-task-materialization';

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function checkpointError(code, message, status = 503, details = {}) {
    const error = new Error(message);
    error.name = 'WorkflowCheckpointError';
    error.code = code;
    error.status = status;
    error.statusCode = status;
    error.details = details;
    return error;
}

function assertFingerprint(record, fingerprint) {
    if (!record) {
        throw checkpointError(
            'workflow_checkpoint_not_found',
            'Workflow checkpoint was not found',
            409
        );
    }
    if (record.fingerprint !== fingerprint) {
        throw checkpointError(
            'idempotency_conflict',
            'Workflow checkpoint key was reused with different input',
            409
        );
    }
}

function normalizeRow(row) {
    if (!row) return null;
    return {
        ...row,
        authorization_snapshot: clone(row.authorization_snapshot || {}),
        recovery_checkpoint: clone(row.recovery_checkpoint || {}),
        result_json: clone(row.result_json)
    };
}

export class InMemoryWorkflowCheckpointRepository {
    constructor() {
        this.records = new Map();
        this.nextId = 1;
    }

    async prepare({ operationKey, fingerprint, authorizationSnapshot, recoveryCheckpoint }) {
        const existing = this.records.get(operationKey);
        if (existing) {
            assertFingerprint(existing, fingerprint);
            return normalizeRow(existing);
        }
        const now = new Date().toISOString();
        const record = {
            id: this.nextId++,
            scope: WORKFLOW_CHECKPOINT_SCOPE,
            operation_key: operationKey,
            fingerprint,
            state: 'prepared',
            result_json: null,
            authorization_snapshot: clone(authorizationSnapshot || {}),
            recovery_checkpoint: clone(recoveryCheckpoint || {}),
            created_at: now,
            updated_at: now
        };
        this.records.set(operationKey, record);
        return normalizeRow(record);
    }

    async saveMaterialization({ operationKey, fingerprint, materialization, recoveryCheckpoint }) {
        const record = this.records.get(operationKey);
        assertFingerprint(record, fingerprint);
        record.result_json = clone(materialization);
        record.recovery_checkpoint = clone(recoveryCheckpoint);
        record.updated_at = new Date().toISOString();
        return normalizeRow(record);
    }

    async markCompleted({ operationKey, fingerprint, recoveryCheckpoint }) {
        const record = this.records.get(operationKey);
        assertFingerprint(record, fingerprint);
        record.state = 'completed';
        record.recovery_checkpoint = clone(recoveryCheckpoint);
        record.updated_at = new Date().toISOString();
        return normalizeRow(record);
    }

    async get(operationKey) {
        return normalizeRow(this.records.get(operationKey));
    }

    async list({ runId = null, humanStepId = null } = {}) {
        return [...this.records.values()]
            .filter((record) => !runId || record.recovery_checkpoint?.workflow_run_id === runId)
            .filter((record) => !humanStepId || record.recovery_checkpoint?.human_step_id === humanStepId)
            .map(normalizeRow);
    }
}

export class PostgresWorkflowCheckpointRepository {
    constructor({ operationRepository = null } = {}) {
        this.operationRepository = operationRepository;
        this.pool = operationRepository?.pool || null;
        this.writerToken = operationRepository?.writerToken || null;
    }

    assertConfigured() {
        if (!this.pool || !this.writerToken || !this.operationRepository) {
            throw checkpointError(
                'workflow_checkpoint_unavailable',
                'Workflow checkpoint coordination database is not configured'
            );
        }
    }

    async assertWriter() {
        this.assertConfigured();
        await this.operationRepository.assertWriter();
    }

    async _withWriterTransaction(callback) {
        this.assertConfigured();
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await this.operationRepository.assertWriter(client);
            const result = await callback(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async prepare({ operationKey, fingerprint, authorizationSnapshot, recoveryCheckpoint }) {
        return this._withWriterTransaction(async (client) => {
            const inserted = await client.query(
                `INSERT INTO canonical_task_operations (
                    scope, operation_key, fingerprint, state, writer_token,
                    authorization_snapshot, recovery_checkpoint
                 ) VALUES ($1, $2, $3, 'prepared', $4, $5::jsonb, $6::jsonb)
                 ON CONFLICT (scope, operation_key) DO NOTHING
                 RETURNING id, scope, operation_key, fingerprint, state, result_json,
                           authorization_snapshot, recovery_checkpoint, created_at, updated_at`,
                [
                    WORKFLOW_CHECKPOINT_SCOPE,
                    operationKey,
                    fingerprint,
                    this.writerToken,
                    JSON.stringify(authorizationSnapshot || {}),
                    JSON.stringify(recoveryCheckpoint || {})
                ]
            );
            if (inserted.rowCount) return normalizeRow(inserted.rows[0]);

            const existing = await client.query(
                `SELECT id, scope, operation_key, fingerprint, state, result_json,
                        authorization_snapshot, recovery_checkpoint, created_at, updated_at
                 FROM canonical_task_operations
                 WHERE scope = $1 AND operation_key = $2 FOR UPDATE`,
                [WORKFLOW_CHECKPOINT_SCOPE, operationKey]
            );
            const record = normalizeRow(existing.rows[0]);
            assertFingerprint(record, fingerprint);
            return record;
        });
    }

    async saveMaterialization({ operationKey, fingerprint, materialization, recoveryCheckpoint }) {
        return this._withWriterTransaction(async (client) => {
            const result = await client.query(
                `UPDATE canonical_task_operations
                 SET state = 'prepared', writer_token = $4, result_json = $5::jsonb,
                     recovery_checkpoint = $6::jsonb, error_json = NULL, updated_at = NOW()
                 WHERE scope = $1 AND operation_key = $2 AND fingerprint = $3
                 RETURNING id, scope, operation_key, fingerprint, state, result_json,
                           authorization_snapshot, recovery_checkpoint, created_at, updated_at`,
                [
                    WORKFLOW_CHECKPOINT_SCOPE,
                    operationKey,
                    fingerprint,
                    this.writerToken,
                    JSON.stringify(materialization),
                    JSON.stringify(recoveryCheckpoint)
                ]
            );
            if (result.rowCount) return normalizeRow(result.rows[0]);
            throw checkpointError(
                'workflow_checkpoint_update_failed',
                'Workflow materialization checkpoint could not be saved',
                409
            );
        });
    }

    async markCompleted({ operationKey, fingerprint, recoveryCheckpoint }) {
        return this._withWriterTransaction(async (client) => {
            const result = await client.query(
                `UPDATE canonical_task_operations
                 SET state = 'completed', writer_token = $4, recovery_checkpoint = $5::jsonb,
                     error_json = NULL, updated_at = NOW()
                 WHERE scope = $1 AND operation_key = $2 AND fingerprint = $3
                 RETURNING id, scope, operation_key, fingerprint, state, result_json,
                           authorization_snapshot, recovery_checkpoint, created_at, updated_at`,
                [
                    WORKFLOW_CHECKPOINT_SCOPE,
                    operationKey,
                    fingerprint,
                    this.writerToken,
                    JSON.stringify(recoveryCheckpoint)
                ]
            );
            if (result.rowCount) return normalizeRow(result.rows[0]);
            throw checkpointError(
                'workflow_checkpoint_update_failed',
                'Workflow checkpoint completion could not be saved',
                409
            );
        });
    }

    async get(operationKey) {
        this.assertConfigured();
        const result = await this.pool.query(
            `SELECT id, scope, operation_key, fingerprint, state, result_json,
                    authorization_snapshot, recovery_checkpoint, created_at, updated_at
             FROM canonical_task_operations
             WHERE scope = $1 AND operation_key = $2`,
            [WORKFLOW_CHECKPOINT_SCOPE, operationKey]
        );
        return normalizeRow(result.rows[0]);
    }

    async list({ runId = null, humanStepId = null } = {}) {
        this.assertConfigured();
        const values = [WORKFLOW_CHECKPOINT_SCOPE];
        const filters = ['scope = $1'];
        if (runId) {
            values.push(runId);
            filters.push(`recovery_checkpoint->>'workflow_run_id' = $${values.length}`);
        }
        if (humanStepId) {
            values.push(humanStepId);
            filters.push(`recovery_checkpoint->>'human_step_id' = $${values.length}`);
        }
        const result = await this.pool.query(
            `SELECT id, scope, operation_key, fingerprint, state, result_json,
                    authorization_snapshot, recovery_checkpoint, created_at, updated_at
             FROM canonical_task_operations
             WHERE ${filters.join(' AND ')}
             ORDER BY id ASC`,
            values
        );
        return result.rows.map(normalizeRow);
    }
}

export { WORKFLOW_CHECKPOINT_SCOPE, checkpointError };
