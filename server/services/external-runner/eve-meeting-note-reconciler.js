// @ts-check

const DEFAULT_INTERVAL_MS = 300000;
const MEETING_NOTE_TOOL_NAME = 'record_meeting_note_generation';
const MEETING_CANDIDATES_TOOL_NAME = 'record_meeting_candidates';
const RECONCILER_ACTOR = Object.freeze({
    authSource: 'internal',
    sub: 'eve_meeting_note_reconciler',
    person_id: 'internal_api'
});

function nowIso() {
    return new Date().toISOString();
}

function parseDurationMs(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function extractToolCallsByName(events, toolName) {
    const calls = [];
    for (const event of Array.isArray(events) ? events : []) {
        if (event?.type !== 'actions.requested') continue;
        const actions = Array.isArray(event.data?.actions) ? event.data.actions : [];
        for (const action of actions) {
            if (action?.kind !== 'tool-call' || action.toolName !== toolName) continue;
            if (!action.input || typeof action.input !== 'object') continue;
            calls.push({ call_id: action.callId || null, input: action.input });
        }
    }
    return calls;
}

/**
 * Extracts every `record_meeting_note_generation` tool-call request from an
 * Eve session event stream. The tool-call input carries the generated note
 * (org/project/run refs, source_text_hash, note.title/body) even when the
 * Eve-side tool execution failed, so this is the pull-side source of truth.
 */
export function extractMeetingNoteToolCalls(events) {
    return extractToolCallsByName(events, MEETING_NOTE_TOOL_NAME);
}

/**
 * Extracts every `record_meeting_candidates` tool-call request from an Eve
 * session event stream. The input carries the LLM-generated task/decision/
 * follow-up candidates (org/project/run refs, source_text_hash, candidate
 * arrays) staged in the same session that produced the meeting note.
 */
export function extractMeetingCandidatesToolCalls(events) {
    return extractToolCallsByName(events, MEETING_CANDIDATES_TOOL_NAME);
}

/**
 * Classifies where an Eve session currently is, based on the terminal-most
 * event of the replayed stream. `parked` means the agent finished its turn
 * and is waiting for the next user message: no further tool calls will
 * arrive without new input, so a parked session without a note is final.
 */
export function classifySessionStreamPhase(events) {
    const list = Array.isArray(events) ? events : [];
    for (let index = list.length - 1; index >= 0; index -= 1) {
        switch (list[index]?.type) {
            case 'session.waiting':
                return 'parked';
            case 'session.completed':
                return 'completed';
            case 'session.failed':
            case 'turn.failed':
                return 'failed';
            case 'turn.started':
            case 'message.received':
                // A turn began after any earlier park: the session resumed.
                return 'in_progress';
            default:
                break;
        }
    }
    return 'in_progress';
}

/**
 * Pull-based reconciler closing the Eve meeting-note loop.
 *
 * Eve (Vercel) cannot POST back to this Mac-local Brainbase instance, so the
 * dispatch run stays `running`/`await_eve_result` after the agent generates
 * the note. This worker polls the Eve session stream for each pending
 * dispatch run, extracts the generated note from the
 * `record_meeting_note_generation` tool-call input, verifies it against the
 * `run.metadata.meeting_note_generation` handoff (run_id + source_text_hash),
 * and records it through the local note-generation contract
 * (`workflowService.recordMeetingNoteGeneration`).
 */
export class EveMeetingNoteReconciler {
    constructor({
        workflowService,
        eveSessionClient,
        repository = null,
        config = {},
        clock = nowIso,
        logger = console
    }) {
        if (!workflowService) throw new Error('workflowService is required');
        this.workflowService = workflowService;
        this.eveSessionClient = eveSessionClient || workflowService.eveSessionClient || null;
        this.repository = repository || workflowService.repository;
        this.clock = clock;
        this.logger = logger;
        this.config = {
            enabled: config.enabled !== false,
            interval_ms: parseDurationMs(config.interval_ms ?? config.intervalMs, DEFAULT_INTERVAL_MS),
            immediate: config.immediate === true
        };
        this._scheduleTimer = null;
        this._runPromise = null;
    }

    isConfigured() {
        return Boolean(this.eveSessionClient?.isConfigured?.());
    }

    listPendingDispatchRuns() {
        this.repository.reload?.();
        return this.repository.listRuns({ limit: null })
            .filter((run) => run.env === 'eve')
            .filter((run) => run.status === 'running')
            .filter((run) => run.metadata?.meeting_note_generation?.run_id)
            .filter((run) => run.metadata?.runner?.session_id);
    }

    async runOnce() {
        if (this._runPromise) return this._runPromise;
        this._runPromise = (async () => {
            const summary = {
                ran_at: this.clock(),
                configured: this.isConfigured(),
                checked: 0,
                recorded: 0,
                already_recorded: 0,
                blocked: 0,
                pending: 0,
                errors: []
            };
            if (!summary.configured) return summary;
            const runs = this.listPendingDispatchRuns();
            for (const run of runs) {
                summary.checked += 1;
                try {
                    const outcome = await this.reconcileRun(run);
                    this._markRuntimeRecovered(run);
                    if (outcome.status === 'recorded') summary.recorded += 1;
                    else if (outcome.status === 'already_recorded') summary.already_recorded += 1;
                    else if (outcome.status === 'blocked') summary.blocked += 1;
                    else summary.pending += 1;
                } catch (error) {
                    const errorMessage = error?.message || String(error);
                    if (error?.code !== 'EVE_SESSION_STREAM_READ_FAILED') {
                        this._markRuntimeFailure(run, errorMessage);
                    }
                    summary.errors.push({
                        run_id: run.id,
                        error: errorMessage
                    });
                    this.logger.warn?.(`[eve-note-reconciler] run ${run.id} failed: ${errorMessage}`);
                }
            }
            return summary;
        })();
        try {
            return await this._runPromise;
        } finally {
            this._runPromise = null;
        }
    }

    async reconcileRun(dispatchRun) {
        const meetingNoteGeneration = dispatchRun.metadata?.meeting_note_generation || {};
        const sessionId = dispatchRun.metadata?.runner?.session_id;
        const ingestRunId = meetingNoteGeneration.run_id;
        const noteAlreadyGenerated = this._targetAlreadyGenerated(ingestRunId);
        let events;
        try {
            events = await this.eveSessionClient.readSessionStream({ sessionId });
        } catch (error) {
            const errorMessage = error?.message || String(error);
            this._markStreamReadFailure(dispatchRun, errorMessage);
            const streamError = new Error(errorMessage);
            streamError.code = 'EVE_SESSION_STREAM_READ_FAILED';
            streamError.cause = error;
            throw streamError;
        }
        this._markStreamReadRecovered(dispatchRun);
        const phase = classifySessionStreamPhase(events);

        if (noteAlreadyGenerated) {
            const candidatesResult = await this._recordCandidatesBestEffort(dispatchRun, {
                events,
                meetingNoteGeneration,
                sessionId,
                ingestRunId
            });
            if (phase === 'in_progress' && candidatesResult.status !== 'recorded') {
                this._markCandidateWait(dispatchRun, {
                    phase,
                    reason: 'awaiting_candidates_after_note',
                    candidates: candidatesResult
                });
                return {
                    status: 'pending',
                    run_id: dispatchRun.id,
                    phase,
                    candidates: candidatesResult
                };
            }
            if (candidatesResult.status === 'failed') {
                const blocked = this._blockCandidateWriteBack(dispatchRun, {
                    phase,
                    candidates: candidatesResult
                });
                return {
                    status: blocked ? 'blocked' : 'pending',
                    run_id: dispatchRun.id,
                    phase,
                    candidates: candidatesResult
                };
            }
            this._closeDispatchRun(dispatchRun, {
                status: 'success',
                reason: 'already_recorded',
                message: 'Meeting note was already recorded on the ingest run; closing the Eve dispatch run',
                candidates: candidatesResult
            });
            return {
                status: 'already_recorded',
                run_id: dispatchRun.id,
                candidates: candidatesResult
            };
        }

        const noteCalls = extractMeetingNoteToolCalls(events);
        const matching = noteCalls.filter((call) => (
            call.input.source_text_hash === meetingNoteGeneration.source_text_hash
            && (!call.input.run_id || call.input.run_id === ingestRunId)
            && typeof call.input.note?.body === 'string'
            && call.input.note.body.trim() !== ''
        ));
        const noteCall = matching.at(-1) || null;

        if (noteCall) {
            try {
                await this.workflowService.recordMeetingNoteGeneration({
                    org_id: dispatchRun.org_id,
                    project_id: dispatchRun.project_id,
                    run_id: ingestRunId,
                    source_text_hash: meetingNoteGeneration.source_text_hash,
                    note: {
                        ...(typeof noteCall.input.note.title === 'string' ? { title: noteCall.input.note.title } : {}),
                        body: noteCall.input.note.body
                    },
                    runner: { type: 'eve', session_id: sessionId }
                }, { ...RECONCILER_ACTOR });
            } catch (error) {
                // Validation/not-found failures are permanent for this dispatch
                // (e.g. the draft's source_text_hash diverged after a re-ingest,
                // or the ingest run was deleted): retrying every tick can never
                // succeed, so surface the run instead of polling it forever.
                if (error?.statusCode === 400 || error?.statusCode === 404) {
                    const blocked = this._blockDispatchRun(dispatchRun, {
                        phase: 'record_rejected',
                        reason: 'record_failed_permanent',
                        record_error: error?.message || String(error),
                        record_state_transition: error?.details?.state_transition || null
                    });
                    return { status: blocked ? 'blocked' : 'pending', run_id: dispatchRun.id, phase: 'record_rejected' };
                }
                throw error;
            }
            // Record LLM candidates staged in the same session. A missing or
            // mismatched call is optional, but a matching call that fails to write
            // must remain operator-visible instead of being reported as success.
            const candidatesResult = await this._recordCandidatesBestEffort(dispatchRun, {
                events,
                meetingNoteGeneration,
                sessionId,
                ingestRunId
            });
            if (phase === 'in_progress' && candidatesResult.status !== 'recorded') {
                this._markCandidateWait(dispatchRun, {
                    phase,
                    reason: 'awaiting_candidates_after_note',
                    note_call_id: noteCall.call_id,
                    candidates: candidatesResult
                });
                return {
                    status: 'pending',
                    run_id: dispatchRun.id,
                    phase,
                    note_call_id: noteCall.call_id,
                    candidates: candidatesResult
                };
            }
            if (candidatesResult.status === 'failed') {
                const blocked = this._blockCandidateWriteBack(dispatchRun, {
                    phase,
                    note_call_id: noteCall.call_id,
                    candidates: candidatesResult
                });
                return {
                    status: blocked ? 'blocked' : 'pending',
                    run_id: dispatchRun.id,
                    phase,
                    note_call_id: noteCall.call_id,
                    candidates: candidatesResult
                };
            }
            this._closeDispatchRun(dispatchRun, {
                status: 'success',
                reason: 'note_reconciled',
                message: 'Eve session meeting note reconciled into the meeting_note_draft output',
                note_call_id: noteCall.call_id,
                candidates: candidatesResult
            });
            return {
                status: 'recorded',
                run_id: dispatchRun.id,
                note_call_id: noteCall.call_id,
                candidates: candidatesResult
            };
        }

        if (phase === 'in_progress') {
            return { status: 'pending', run_id: dispatchRun.id, phase };
        }

        // The session reached a boundary (parked / completed / failed) without a
        // usable note tool-call: no further output will arrive without operator
        // input, so surface the run instead of polling it forever.
        const blocked = this._blockDispatchRun(dispatchRun, {
            phase,
            mismatched_note_calls: noteCalls.length - matching.length
        });
        return { status: blocked ? 'blocked' : 'pending', run_id: dispatchRun.id, phase };
    }

    // Records the LLM candidates from the same session stream, if present.
    // Deliberately returns write errors instead of throwing so the note remains
    // recorded while the caller can surface candidate recovery to an operator.
    async _recordCandidatesBestEffort(dispatchRun, { events, meetingNoteGeneration, sessionId, ingestRunId }) {
        const candidateCalls = extractMeetingCandidatesToolCalls(events);
        const matching = candidateCalls.filter((call) => (
            call.input.org_id === dispatchRun.org_id
            && call.input.project_id === dispatchRun.project_id
            && call.input.run_id === ingestRunId
            && call.input.source_text_hash === meetingNoteGeneration.source_text_hash
        ));
        const mismatchedCandidateCalls = candidateCalls.length - matching.length;
        const candidateCall = matching.at(-1) || null;
        if (!candidateCall) {
            return { status: 'no_candidate_call', mismatched_candidate_calls: mismatchedCandidateCalls };
        }
        try {
            const result = await this.workflowService.recordMeetingCandidates({
                org_id: dispatchRun.org_id,
                project_id: dispatchRun.project_id,
                run_id: ingestRunId,
                source_text_hash: meetingNoteGeneration.source_text_hash,
                task_candidates: candidateCall.input.task_candidates,
                decision_candidates: candidateCall.input.decision_candidates,
                follow_up_draft: candidateCall.input.follow_up_draft,
                runner: { type: 'eve', session_id: sessionId }
            }, { ...RECONCILER_ACTOR });
            return {
                status: 'recorded',
                call_id: candidateCall.call_id,
                updated: result?.meeting_candidates?.updated || null,
                mismatched_candidate_calls: mismatchedCandidateCalls
            };
        } catch (error) {
            this.logger.warn?.(`[eve-note-reconciler] candidate write-back for run ${dispatchRun.id} failed: ${error?.message || error}`);
            return {
                status: 'failed',
                call_id: candidateCall.call_id,
                error: error?.message || String(error),
                mismatched_candidate_calls: mismatchedCandidateCalls
            };
        }
    }

    _targetAlreadyGenerated(ingestRunId) {
        if (!ingestRunId) return false;
        const output = this.repository.listOutputs(ingestRunId)
            .find((candidate) => candidate.metadata?.output_key === 'meeting_note_draft');
        return output?.payload?.generation_status === 'brainbase_generated';
    }

    // Re-reads the run after the awaits so a concurrent writer (e.g. the
    // external-runner push ingest) is neither clobbered with a stale metadata
    // snapshot nor overwritten after it already closed the run.
    _freshRunningRun(dispatchRun) {
        const fresh = this.repository.getRun(dispatchRun.id);
        if (!fresh || fresh.status !== 'running') return null;
        return fresh;
    }

    _reconcilerDiagnostics(run) {
        const previous = run?.metadata?.eve_note_reconciler || {};
        return [
            'last_poll_failed_at',
            'last_poll_error',
            'poll_failure_count',
            'last_poll_recovered_at',
            'last_runtime_failed_at',
            'last_runtime_error',
            'runtime_failure_count',
            'last_runtime_recovered_at'
        ].reduce((diagnostics, key) => {
            if (previous[key] !== undefined) diagnostics[key] = previous[key];
            return diagnostics;
        }, {});
    }

    _markStreamReadFailure(dispatchRun, errorMessage) {
        const fresh = this._freshRunningRun(dispatchRun);
        if (!fresh) return false;
        const failedAt = this.clock();
        const previous = fresh.metadata?.eve_note_reconciler || {};
        const pollFailureCount = Number(previous.poll_failure_count || 0) + 1;
        this.repository.updateRun(fresh.id, {
            message: `Eve session stream read failed; retrying automatically: ${errorMessage}`,
            metadata: {
                ...(fresh.metadata || {}),
                eve_note_reconciler: {
                    ...previous,
                    status: 'retrying',
                    reason: 'session_stream_read_failed',
                    last_poll_failed_at: failedAt,
                    last_poll_error: String(errorMessage).slice(0, 500),
                    poll_failure_count: pollFailureCount
                }
            }
        });
        this._writeReconcilerAudit(dispatchRun, 'workflow.meeting_pack.eve_session_stream.read_failed', {
            reason: 'session_stream_read_failed',
            poll_failed_at: failedAt,
            poll_error: String(errorMessage).slice(0, 500),
            poll_failure_count: pollFailureCount,
            ingest_run_id: dispatchRun.metadata?.meeting_note_generation?.run_id || null
        });
        return true;
    }

    _markStreamReadRecovered(dispatchRun) {
        const fresh = this._freshRunningRun(dispatchRun);
        const previous = fresh?.metadata?.eve_note_reconciler;
        if (
            !fresh
            || previous?.status !== 'retrying'
            || previous?.reason !== 'session_stream_read_failed'
            || !previous.last_poll_error
        ) return false;
        const recoveredAt = this.clock();
        this.repository.updateRun(fresh.id, {
            message: 'Eve session stream recovered; waiting for the meeting result',
            metadata: {
                ...(fresh.metadata || {}),
                eve_note_reconciler: {
                    ...previous,
                    status: 'polling',
                    reason: 'awaiting_eve_result',
                    last_poll_recovered_at: recoveredAt
                }
            }
        });
        this._writeReconcilerAudit(dispatchRun, 'workflow.meeting_pack.eve_session_stream.recovered', {
            reason: 'session_stream_recovered',
            poll_recovered_at: recoveredAt,
            poll_failure_count: previous.poll_failure_count || 1,
            ingest_run_id: dispatchRun.metadata?.meeting_note_generation?.run_id || null
        });
        return true;
    }

    _markRuntimeFailure(dispatchRun, errorMessage) {
        const fresh = this._freshRunningRun(dispatchRun);
        if (!fresh) return false;
        const failedAt = this.clock();
        const previous = fresh.metadata?.eve_note_reconciler || {};
        const runtimeFailureCount = Number(previous.runtime_failure_count || 0) + 1;
        this.repository.updateRun(fresh.id, {
            message: `Eve meeting result reconciliation failed; retrying automatically: ${errorMessage}`,
            metadata: {
                ...(fresh.metadata || {}),
                eve_note_reconciler: {
                    ...previous,
                    status: 'retrying',
                    reason: 'reconcile_runtime_failed',
                    last_runtime_failed_at: failedAt,
                    last_runtime_error: String(errorMessage).slice(0, 500),
                    runtime_failure_count: runtimeFailureCount
                }
            }
        });
        this._writeReconcilerAudit(dispatchRun, 'workflow.meeting_pack.eve_reconcile.failed', {
            reason: 'reconcile_runtime_failed',
            runtime_failed_at: failedAt,
            runtime_error: String(errorMessage).slice(0, 500),
            runtime_failure_count: runtimeFailureCount,
            ingest_run_id: dispatchRun.metadata?.meeting_note_generation?.run_id || null
        });
        return true;
    }

    _markRuntimeRecovered(dispatchRun) {
        const fresh = this.repository.getRun(dispatchRun.id);
        const previous = fresh?.metadata?.eve_note_reconciler;
        if (!fresh || !previous?.last_runtime_error || !previous.last_runtime_failed_at) return false;
        if (
            previous.last_runtime_recovered_at
            && previous.last_runtime_recovered_at >= previous.last_runtime_failed_at
        ) return false;
        const recoveredAt = this.clock();
        this.repository.updateRun(fresh.id, {
            metadata: {
                ...(fresh.metadata || {}),
                eve_note_reconciler: {
                    ...previous,
                    last_runtime_recovered_at: recoveredAt
                }
            }
        });
        this._writeReconcilerAudit(dispatchRun, 'workflow.meeting_pack.eve_reconcile.recovered', {
            reason: 'reconcile_runtime_recovered',
            runtime_recovered_at: recoveredAt,
            runtime_failure_count: previous.runtime_failure_count || 1,
            ingest_run_id: dispatchRun.metadata?.meeting_note_generation?.run_id || null
        });
        return true;
    }

    _markCandidateWait(dispatchRun, { phase, reason, note_call_id = null, candidates }) {
        const fresh = this._freshRunningRun(dispatchRun);
        if (!fresh) return false;
        const observedAt = this.clock();
        this.repository.updateRun(fresh.id, {
            message: 'Meeting note recorded; waiting for Eve meeting candidates from the active session',
            metadata: {
                ...(fresh.metadata || {}),
                eve_note_reconciler: {
                    ...this._reconcilerDiagnostics(fresh),
                    reconciled_at: observedAt,
                    reason,
                    session_phase: phase,
                    ...(note_call_id ? { note_call_id } : {}),
                    candidates
                }
            }
        });
        return true;
    }

    _closeDispatchRun(dispatchRun, { status, reason, message, note_call_id = null, candidates = null }) {
        const fresh = this._freshRunningRun(dispatchRun);
        if (!fresh) return false;
        const finishedAt = this.clock();
        this.repository.updateRun(fresh.id, {
            status,
            closure_state: 'closed',
            human_waiting: false,
            action_required: 'none',
            message,
            finished_at: finishedAt,
            metadata: {
                ...(fresh.metadata || {}),
                eve_note_reconciler: {
                    ...this._reconcilerDiagnostics(fresh),
                    reconciled_at: finishedAt,
                    reason,
                    ...(note_call_id ? { note_call_id } : {}),
                    ...(candidates ? { candidates } : {})
                }
            }
        });
        this._writeReconcilerAudit(dispatchRun, 'workflow.meeting_pack.note_generation.reconciled', {
            reason,
            note_call_id,
            ...(candidates ? { candidates } : {}),
            ingest_run_id: dispatchRun.metadata?.meeting_note_generation?.run_id || null
        });
    }

    _blockCandidateWriteBack(dispatchRun, { phase, note_call_id = null, candidates }) {
        const fresh = this._freshRunningRun(dispatchRun);
        if (!fresh) return false;
        const finishedAt = this.clock();
        this.repository.updateRun(fresh.id, {
            status: 'blocked',
            closure_state: 'open',
            human_waiting: true,
            action_required: 'operator_review_eve_candidates',
            message: `Meeting note recorded, but Eve candidate write-back failed: ${candidates.error}`,
            finished_at: finishedAt,
            metadata: {
                ...(fresh.metadata || {}),
                eve_note_reconciler: {
                    ...this._reconcilerDiagnostics(fresh),
                    reconciled_at: finishedAt,
                    reason: 'candidate_writeback_failed',
                    session_phase: phase,
                    ...(note_call_id ? { note_call_id } : {}),
                    candidates
                }
            }
        });
        this._writeReconcilerAudit(dispatchRun, 'workflow.meeting_pack.candidates.reconcile_blocked', {
            reason: 'candidate_writeback_failed',
            session_phase: phase,
            note_call_id,
            candidates,
            ingest_run_id: dispatchRun.metadata?.meeting_note_generation?.run_id || null
        });
        return true;
    }

    _blockDispatchRun(dispatchRun, {
        phase,
        mismatched_note_calls = 0,
        reason = 'session_ended_without_note',
        record_error = null,
        record_state_transition = null
    }) {
        const fresh = this._freshRunningRun(dispatchRun);
        if (!fresh) return false;
        const finishedAt = this.clock();
        const message = reason === 'record_failed_permanent'
            ? `Meeting note write-back was rejected permanently: ${record_error}`
            : `Eve session ended (${phase}) without a matching record_meeting_note_generation call`;
        // Match the operator-attention convention of the existing eve
        // timeout-recovery runs: human_waiting + open closure keep the run on
        // the companion approval attention surface until an operator acts.
        this.repository.updateRun(fresh.id, {
            status: 'blocked',
            closure_state: 'open',
            human_waiting: true,
            action_required: 'operator_review_eve_session',
            message,
            finished_at: finishedAt,
            metadata: {
                ...(fresh.metadata || {}),
                eve_note_reconciler: {
                    ...this._reconcilerDiagnostics(fresh),
                    reconciled_at: finishedAt,
                    reason,
                    session_phase: phase,
                    mismatched_note_calls,
                    ...(record_error ? { record_error, record_state_transition } : {})
                }
            }
        });
        this._writeReconcilerAudit(dispatchRun, 'workflow.meeting_pack.note_generation.reconcile_blocked', {
            reason,
            session_phase: phase,
            mismatched_note_calls,
            ...(record_error ? { record_error, record_state_transition } : {}),
            ingest_run_id: dispatchRun.metadata?.meeting_note_generation?.run_id || null
        });
        return true;
    }

    _writeReconcilerAudit(dispatchRun, action, after) {
        this.repository.writeAuditLog({
            workspace_id: dispatchRun.workspace_id,
            org_id: dispatchRun.org_id || null,
            project_id: dispatchRun.project_id,
            actor_id: RECONCILER_ACTOR.sub,
            action,
            target_type: 'workflow_run',
            target_id: dispatchRun.id,
            after: {
                eve_session_id: dispatchRun.metadata?.runner?.session_id || null,
                ...after
            }
        });
    }

    startScheduledReconcile(options = {}) {
        const config = {
            ...this.config,
            ...options,
            interval_ms: parseDurationMs(options.interval_ms ?? options.intervalMs, this.config.interval_ms)
        };
        if (!config.enabled) return { started: false, reason: 'disabled' };
        if (!this.isConfigured()) return { started: false, reason: 'eve_not_configured' };
        if (this._scheduleTimer) return { started: false, reason: 'already_started' };
        this.config = config;
        const runTick = () => {
            void this.runOnce().catch((error) => {
                this.logger.warn?.(`[eve-note-reconciler] scheduled run failed: ${error?.message || error}`);
            });
        };
        this._scheduleTimer = setInterval(runTick, config.interval_ms);
        this._scheduleTimer.unref?.();
        if (config.immediate) runTick();
        return { started: true, interval_ms: config.interval_ms };
    }

    stopScheduledReconcile() {
        if (!this._scheduleTimer) return { stopped: false, reason: 'not_started' };
        clearInterval(this._scheduleTimer);
        this._scheduleTimer = null;
        return { stopped: true };
    }
}

export function createEveMeetingNoteReconcilerConfigFromEnv(env = process.env) {
    return {
        enabled: env.BRAINBASE_EVE_NOTE_RECONCILER_ENABLED !== '0',
        interval_ms: env.BRAINBASE_EVE_NOTE_RECONCILER_INTERVAL_MS,
        immediate: env.BRAINBASE_EVE_NOTE_RECONCILER_IMMEDIATE === '1'
    };
}
