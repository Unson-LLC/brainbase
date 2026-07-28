function canonicalTaskOperationError(code, message, status = 503, details = {}) {
    const error = new Error(message);
    error.name = 'CanonicalTaskOperationError';
    error.code = code;
    error.status = status;
    error.details = details;
    return error;
}

export class CanonicalTaskOperationRepository {
    constructor({
        pool = null,
        writerToken = null,
        processIdentity = null,
        operationWaitTimeoutMs = 5000,
        operationPollIntervalMs = 10
    } = {}) {
        this.pool = pool;
        this.writerToken = writerToken;
        this.processIdentity = processIdentity;
        this.operationWaitTimeoutMs = operationWaitTimeoutMs;
        this.operationPollIntervalMs = operationPollIntervalMs;
        this.writerClaimed = false;
    }

    async waitForCompletedOperation({ scope, operationKey, fingerprint }) {
        const deadline = Date.now() + this.operationWaitTimeoutMs;
        while (Date.now() <= deadline) {
            await this.assertWriter();
            const existing = await this.pool.query(
                `SELECT fingerprint, state, result_json, error_json, writer_token
                 FROM canonical_task_operations
                 WHERE scope = $1 AND operation_key = $2`,
                [scope, operationKey]
            );
            const row = existing.rows[0];
            if (!row || row.fingerprint !== fingerprint) {
                throw canonicalTaskOperationError(
                    'idempotency_conflict',
                    'Idempotency key was reused with different input',
                    409
                );
            }
            if (row.state === 'completed') return row.result_json;
            if (row.state === 'failed') {
                throw canonicalTaskOperationError(
                    'canonical_task_operation_failed',
                    'Concurrent Canonical Task operation failed',
                    503,
                    { cause: row.error_json || null }
                );
            }
            await new Promise(resolve => setTimeout(resolve, this.operationPollIntervalMs));
        }
        throw canonicalTaskOperationError(
            'canonical_task_operation_timeout',
            'Timed out waiting for the concurrent Canonical Task operation',
            503
        );
    }

    assertConfigured() {
        if (!this.pool || !this.writerToken) {
            throw canonicalTaskOperationError(
                'canonical_task_coordination_unavailable',
                'Canonical Task coordination database is not configured'
            );
        }
    }

    async claimWriter({ sourceHead } = {}) {
        this.assertConfigured();
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `INSERT INTO canonical_task_writer (
                    singleton_id, writer_token, process_identity, source_head, claimed_at, updated_at
                 ) VALUES (TRUE, $1, $2::jsonb, $3, NOW(), NOW())
                 ON CONFLICT (singleton_id) DO NOTHING`,
                [this.writerToken, JSON.stringify(this.processIdentity || {}), sourceHead || null]
            );
            const current = await client.query(
                `SELECT writer_token, process_identity, source_head
                 FROM canonical_task_writer
                 WHERE singleton_id = TRUE
                 FOR UPDATE`
            );
            const row = current.rows[0];
            if (!row || row.writer_token !== this.writerToken) {
                throw canonicalTaskOperationError(
                    'canonical_task_writer_unavailable',
                    'Canonical Task writer is owned by another process',
                    503,
                    { active_writer: row?.process_identity || null, source_head: row?.source_head || null }
                );
            }
            const claimed = await client.query(
                `UPDATE canonical_task_writer
                 SET process_identity = $2::jsonb, source_head = $3, updated_at = NOW()
                 WHERE singleton_id = TRUE AND writer_token = $1
                 RETURNING writer_token, process_identity, source_head`,
                [this.writerToken, JSON.stringify(this.processIdentity || {}), sourceHead || null]
            );
            await client.query('COMMIT');
            this.writerClaimed = true;
            return claimed.rows[0] || row;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async assertWriter(client = this.pool) {
        this.assertConfigured();
        const result = await client.query(
            `SELECT 1 FROM canonical_task_writer
             WHERE singleton_id = TRUE AND writer_token = $1`,
            [this.writerToken]
        );
        if (!result.rowCount) {
            this.writerClaimed = false;
            throw canonicalTaskOperationError(
                'canonical_task_writer_unavailable',
                'This process does not own the Canonical Task writer token'
            );
        }
    }

    async readReadiness() {
        this.assertConfigured();
        const result = await this.pool.query(
            `SELECT ready, writer_token, manifest_hash, schema_version, source_head,
                    evidence_hash, evidence_path, reason, updated_at
             FROM canonical_task_readiness
             WHERE singleton_id = TRUE`
        );
        return result.rows[0] || null;
    }

    async reconcileReadiness({ manifestHash, schemaVersion, sourceHead, allowWriterRebind = false } = {}) {
        this.assertConfigured();
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const writer = await client.query(
                `SELECT writer_token FROM canonical_task_writer
                 WHERE singleton_id = TRUE FOR UPDATE`
            );
            if (!writer.rowCount || writer.rows[0].writer_token !== this.writerToken) {
                throw canonicalTaskOperationError(
                    'canonical_task_writer_unavailable',
                    'This process does not own the Canonical Task writer token'
                );
            }

            const readiness = await client.query(
                `SELECT ready, writer_token, manifest_hash, schema_version, source_head,
                        evidence_hash, evidence_path, reason, updated_at
                 FROM canonical_task_readiness
                 WHERE singleton_id = TRUE
                 FOR UPDATE`
            );
            let row = readiness.rows[0] || null;
            const releaseMatches = Boolean(
                row?.ready
                && row.manifest_hash === manifestHash
                && row.schema_version === schemaVersion
                && row.source_head === sourceHead
                && row.evidence_hash
            );
            if (allowWriterRebind && releaseMatches && row.writer_token !== this.writerToken) {
                const rebound = await client.query(
                    `UPDATE canonical_task_readiness
                     SET writer_token = $1, updated_at = NOW()
                     WHERE singleton_id = TRUE
                     RETURNING ready, writer_token, manifest_hash, schema_version, source_head,
                               evidence_hash, evidence_path, reason, updated_at`,
                    [this.writerToken]
                );
                row = rebound.rows[0] || row;
            }
            await client.query('COMMIT');
            return row;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    async releaseWriter() {
        if (!this.pool || !this.writerToken || !this.writerClaimed) return false;
        const result = await this.pool.query(
            `DELETE FROM canonical_task_writer
             WHERE singleton_id = TRUE AND writer_token = $1`,
            [this.writerToken]
        );
        this.writerClaimed = false;
        return result.rowCount === 1;
    }

    async execute({ scope, operationKey, fingerprint, recover = null, run }) {
        this.assertConfigured();
        await this.assertWriter();
        let shouldRecover = false;
        let waitForExisting = false;
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await this.assertWriter(client);
            const inserted = await client.query(
                `INSERT INTO canonical_task_operations (scope, operation_key, fingerprint, state, writer_token)
                 VALUES ($1, $2, $3, 'running', $4)
                 ON CONFLICT (scope, operation_key) DO NOTHING
                 RETURNING id`,
                [scope, operationKey, fingerprint, this.writerToken]
            );
            if (!inserted.rowCount) {
                const existing = await client.query(
                    `SELECT fingerprint, state, result_json, writer_token FROM canonical_task_operations
                     WHERE scope = $1 AND operation_key = $2 FOR UPDATE`,
                    [scope, operationKey]
                );
                const row = existing.rows[0];
                if (row?.fingerprint !== fingerprint) {
                    throw canonicalTaskOperationError(
                        'idempotency_conflict',
                        'Idempotency key was reused with different input',
                        409
                    );
                }
                if (row?.state === 'completed') {
                    await client.query('COMMIT');
                    return row.result_json;
                }
                if (row?.state === 'failed') {
                    await client.query(
                        `UPDATE canonical_task_operations
                         SET state = 'running', writer_token = $3, error_json = NULL, updated_at = NOW()
                         WHERE scope = $1 AND operation_key = $2 AND state = 'failed'`,
                        [scope, operationKey, this.writerToken]
                    );
                    shouldRecover = typeof recover === 'function';
                    await client.query('COMMIT');
                } else if (
                    row?.state === 'running'
                    && row.writer_token
                    && row.writer_token !== this.writerToken
                    && typeof recover === 'function'
                ) {
                    const reclaimed = await client.query(
                        `UPDATE canonical_task_operations
                         SET writer_token = $3, updated_at = NOW()
                         WHERE scope = $1 AND operation_key = $2
                           AND state = 'running' AND writer_token = $4`,
                        [scope, operationKey, this.writerToken, row.writer_token]
                    );
                    if (reclaimed.rowCount !== 1) {
                        throw canonicalTaskOperationError(
                            'canonical_task_operation_in_progress',
                            'Canonical Task operation is already in progress',
                            409
                        );
                    }
                    shouldRecover = true;
                    await client.query('COMMIT');
                } else {
                    waitForExisting = true;
                    await client.query('COMMIT');
                }
            } else {
                await client.query('COMMIT');
            }
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

        if (waitForExisting) {
            return this.waitForCompletedOperation({ scope, operationKey, fingerprint });
        }

        try {
            const recovery = shouldRecover ? await recover() : null;
            const result = recovery?.recovered ? recovery.result : await run();
            await this.assertWriter();
            await this.pool.query(
                `UPDATE canonical_task_operations
                 SET state = 'completed', result_json = $3::jsonb, updated_at = NOW()
                 WHERE scope = $1 AND operation_key = $2 AND writer_token = $4`,
                [scope, operationKey, JSON.stringify(result), this.writerToken]
            );
            return result;
        } catch (error) {
            await this.pool.query(
                `UPDATE canonical_task_operations
                 SET state = 'failed', error_json = $3::jsonb, updated_at = NOW()
                 WHERE scope = $1 AND operation_key = $2 AND writer_token = $4`,
                [scope, operationKey, JSON.stringify({ code: error?.code || null, message: error?.message || String(error) }), this.writerToken]
            ).catch(() => {});
            throw error;
        }
    }

    async executePreparedDelete({
        operationKey,
        versionClaimKey,
        fingerprint,
        versionFingerprint,
        principalNamespace,
        prepare,
        findTask,
        removeTask
    }) {
        this.assertConfigured();
        await this.assertWriter();

        const existing = await this.pool.query(
            `SELECT fingerprint, state, result_json, authorization_snapshot
             FROM canonical_task_operations
             WHERE scope = 'task-delete' AND operation_key = $1`,
            [operationKey]
        );
        if (existing.rowCount) {
            const row = existing.rows[0];
            if (row.fingerprint !== fingerprint) {
                throw canonicalTaskOperationError(
                    'idempotency_conflict',
                    'Idempotency key was reused with different input',
                    409
                );
            }
            if (row.state === 'completed') return row.result_json;
            if (row.state !== 'prepared') {
                throw canonicalTaskOperationError(
                    'canonical_task_operation_in_progress',
                    'Canonical Task delete operation is already in progress',
                    409
                );
            }
            return this.completePreparedDelete({ operationKey, versionClaimKey, row, findTask, removeTask });
        }

        const versionClaim = await this.pool.query(
            `SELECT authorization_snapshot
             FROM canonical_task_operations
             WHERE scope = 'task-version' AND operation_key = $1`,
            [versionClaimKey]
        );
        if (versionClaim.rowCount
            && versionClaim.rows[0]?.authorization_snapshot?.principal_namespace === principalNamespace) {
            throw canonicalTaskOperationError(
                'version_conflict',
                'Task version was already claimed by another operation',
                409
            );
        }

        const prepared = await prepare();
        const authorizationSnapshot = {
            ...prepared.authorizationSnapshot,
            principal_namespace: principalNamespace
        };
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await this.assertWriter(client);
            const claimed = await client.query(
                `INSERT INTO canonical_task_operations (
                    scope, operation_key, fingerprint, state, writer_token,
                    result_json, authorization_snapshot, recovery_checkpoint
                 ) VALUES ('task-version', $1, $2, 'prepared', $3, $4::jsonb, $5::jsonb, $6::jsonb)
                 ON CONFLICT (scope, operation_key) DO NOTHING
                 RETURNING id`,
                [
                    versionClaimKey,
                    versionFingerprint,
                    this.writerToken,
                    JSON.stringify(prepared.result),
                    JSON.stringify(authorizationSnapshot),
                    JSON.stringify({ phase: 'prepared', task_present: true })
                ]
            );
            if (!claimed.rowCount) {
                throw canonicalTaskOperationError(
                    'version_conflict',
                    'Task version was already claimed by another operation',
                    409
                );
            }
            const intent = await client.query(
                `INSERT INTO canonical_task_operations (
                    scope, operation_key, fingerprint, state, writer_token,
                    result_json, authorization_snapshot, recovery_checkpoint
                 ) VALUES ('task-delete', $1, $2, 'prepared', $3, $4::jsonb, $5::jsonb, $6::jsonb)
                 ON CONFLICT (scope, operation_key) DO NOTHING
                 RETURNING id`,
                [
                    operationKey,
                    fingerprint,
                    this.writerToken,
                    JSON.stringify(prepared.result),
                    JSON.stringify(authorizationSnapshot),
                    JSON.stringify({ phase: 'prepared', task_present: true, version_claim_key: versionClaimKey })
                ]
            );
            if (!intent.rowCount) {
                throw canonicalTaskOperationError(
                    'canonical_task_operation_in_progress',
                    'Canonical Task delete operation is already in progress',
                    409
                );
            }
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }

        return this.completePreparedDelete({
            operationKey,
            versionClaimKey,
            row: {
                fingerprint,
                result_json: prepared.result,
                authorization_snapshot: authorizationSnapshot
            },
            findTask,
            removeTask
        });
    }

    async completePreparedDelete({ operationKey, versionClaimKey, row, findTask, removeTask }) {
        await this.assertWriter();
        const task = await findTask();
        if (task) await removeTask(task);

        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await this.assertWriter(client);
            const completed = await client.query(
                `UPDATE canonical_task_operations
                 SET state = 'completed', writer_token = $3,
                     recovery_checkpoint = $4::jsonb, error_json = NULL, updated_at = NOW()
                 WHERE scope = 'task-delete' AND operation_key = $1
                   AND fingerprint = $2 AND state = 'prepared'`,
                [
                    operationKey,
                    row.fingerprint,
                    this.writerToken,
                    JSON.stringify({ phase: 'completed', task_present: false, version_claim_key: versionClaimKey })
                ]
            );
            if (!completed.rowCount) {
                const replay = await client.query(
                    `SELECT fingerprint, state, result_json
                     FROM canonical_task_operations
                     WHERE scope = 'task-delete' AND operation_key = $1 FOR UPDATE`,
                    [operationKey]
                );
                if (replay.rows[0]?.fingerprint !== row.fingerprint || replay.rows[0]?.state !== 'completed') {
                    throw canonicalTaskOperationError(
                        'canonical_task_operation_in_progress',
                        'Canonical Task delete completion could not be claimed',
                        409
                    );
                }
                await client.query('COMMIT');
                return replay.rows[0].result_json;
            }
            await client.query(
                `UPDATE canonical_task_operations
                 SET state = 'completed', writer_token = $2,
                     recovery_checkpoint = $3::jsonb, error_json = NULL, updated_at = NOW()
                 WHERE scope = 'task-version' AND operation_key = $1 AND state = 'prepared'`,
                [
                    versionClaimKey,
                    this.writerToken,
                    JSON.stringify({ phase: 'completed', task_present: false, delete_operation_key: operationKey })
                ]
            );
            await client.query('COMMIT');
            return row.result_json;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }
}

export { canonicalTaskOperationError };
