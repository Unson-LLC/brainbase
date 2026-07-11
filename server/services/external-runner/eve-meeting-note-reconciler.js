// @ts-check

const DEFAULT_INTERVAL_MS = 300000;
const MEETING_NOTE_TOOL_NAME = 'record_meeting_note_generation';
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

/**
 * Extracts every `record_meeting_note_generation` tool-call request from an
 * Eve session event stream. The tool-call input carries the generated note
 * (org/project/run refs, source_text_hash, note.title/body) even when the
 * Eve-side tool execution failed, so this is the pull-side source of truth.
 */
export function extractMeetingNoteToolCalls(events) {
    const calls = [];
    for (const event of Array.isArray(events) ? events : []) {
        if (event?.type !== 'actions.requested') continue;
        const actions = Array.isArray(event.data?.actions) ? event.data.actions : [];
        for (const action of actions) {
            if (action?.kind !== 'tool-call' || action.toolName !== MEETING_NOTE_TOOL_NAME) continue;
            if (!action.input || typeof action.input !== 'object') continue;
            calls.push({ call_id: action.callId || null, input: action.input });
        }
    }
    return calls;
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
                    if (outcome.status === 'recorded') summary.recorded += 1;
                    else if (outcome.status === 'already_recorded') summary.already_recorded += 1;
                    else if (outcome.status === 'blocked') summary.blocked += 1;
                    else summary.pending += 1;
                } catch (error) {
                    summary.errors.push({
                        run_id: run.id,
                        error: error?.message || String(error)
                    });
                    this.logger.warn?.(`[eve-note-reconciler] run ${run.id} failed: ${error?.message || error}`);
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

        if (this._targetAlreadyGenerated(ingestRunId)) {
            this._closeDispatchRun(dispatchRun, {
                status: 'success',
                reason: 'already_recorded',
                message: 'Meeting note was already recorded on the ingest run; closing the Eve dispatch run'
            });
            return { status: 'already_recorded', run_id: dispatchRun.id };
        }

        const events = await this.eveSessionClient.readSessionStream({ sessionId });
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
            this._closeDispatchRun(dispatchRun, {
                status: 'success',
                reason: 'note_reconciled',
                message: 'Eve session meeting note reconciled into the meeting_note_draft output',
                note_call_id: noteCall.call_id
            });
            return { status: 'recorded', run_id: dispatchRun.id, note_call_id: noteCall.call_id };
        }

        const phase = classifySessionStreamPhase(events);
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

    _closeDispatchRun(dispatchRun, { status, reason, message, note_call_id = null }) {
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
                    reconciled_at: finishedAt,
                    reason,
                    ...(note_call_id ? { note_call_id } : {})
                }
            }
        });
        this._writeReconcilerAudit(dispatchRun, 'workflow.meeting_pack.note_generation.reconciled', {
            reason,
            note_call_id,
            ingest_run_id: dispatchRun.metadata?.meeting_note_generation?.run_id || null
        });
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
