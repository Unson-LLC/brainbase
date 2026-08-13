const TOKYO_OFFSET_MS = 9 * 60 * 60 * 1000;
const PRIORITY = Object.freeze({ dead_letter: 0, missing_receipt: 1, blocked_receipt: 2 });

function asDate(value, fieldName) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) throw new Error(`${fieldName} must be a valid date`);
    return date;
}

function scheduledAtFor(expectation, now) {
    if (expectation.timezone !== 'Asia/Tokyo') {
        throw new Error(`Unsupported routine timezone: ${expectation.timezone}`);
    }
    const localNow = new Date(now.getTime() + TOKYO_OFFSET_MS);
    const localScheduled = new Date(localNow);
    localScheduled.setUTCHours(expectation.schedule.hour, expectation.schedule.minute, 0, 0);

    if (expectation.schedule.kind === 'daily') {
        if (localScheduled.getTime() > localNow.getTime()) {
            localScheduled.setUTCDate(localScheduled.getUTCDate() - 1);
        }
    } else if (expectation.schedule.kind === 'weekly') {
        const daysSinceSchedule = (localNow.getUTCDay() - expectation.schedule.day_of_week + 7) % 7;
        localScheduled.setUTCDate(localScheduled.getUTCDate() - daysSinceSchedule);
        if (localScheduled.getTime() > localNow.getTime()) {
            localScheduled.setUTCDate(localScheduled.getUTCDate() - 7);
        }
    } else {
        throw new Error(`Unsupported routine schedule kind: ${expectation.schedule.kind}`);
    }

    return new Date(localScheduled.getTime() - TOKYO_OFFSET_MS);
}

function isBlockedReceipt(receipt) {
    return ['blocked', 'failed', 'waiting_human'].includes(receipt.source_status)
        || ['no_data', 'unconfirmed'].includes(receipt.evidence_state);
}

function normalizeArtifactName(value) {
    return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function missingRequiredArtifacts(expectation, receipt) {
    const evidenceRefs = Array.isArray(receipt.evidence_refs) ? receipt.evidence_refs : [];
    return expectation.required_artifacts.filter((requiredArtifact) => !evidenceRefs.some((evidence) => {
        if (evidence?.kind !== 'artifact_ref') return false;
        if (normalizeArtifactName(evidence.label) === normalizeArtifactName(requiredArtifact)) return true;
        if (requiredArtifact === 'routine_summary') {
            return /(?:^|[/:_-])routine(?:[/:_-])summary(?:$|[/:_-])/.test(String(evidence.ref || '').toLowerCase())
                || /(?:^|[/:_-])summary(?:$|[/:_-])/.test(String(evidence.ref || '').toLowerCase());
        }
        return false;
    }));
}

function exceptionOverdueMs(exceptionItem, now) {
    const reference = exceptionItem.grace_deadline_at
        || exceptionItem.finished_at
        || exceptionItem.created_at;
    return reference ? Math.max(0, now.getTime() - asDate(reference, 'exception timestamp').getTime()) : 0;
}

export class RoutineLivenessService {
    constructor({
        expectations,
        runReceiptQueryService,
        listDeadLetters = async () => [],
        now = () => new Date()
    }) {
        if (!Array.isArray(expectations)) throw new Error('expectations must be an array');
        if (!runReceiptQueryService?.listHistory) throw new Error('runReceiptQueryService.listHistory is required');
        this.expectations = expectations;
        this.runReceiptQueryService = runReceiptQueryService;
        this.listDeadLetters = listDeadLetters;
        this.now = now;
    }

    async listExceptions({ limit = 3 } = {}) {
        const now = asDate(this.now(), 'now');
        const deadLetters = await this.listDeadLetters();
        const deadLettersByAutomation = new Map();
        for (const item of deadLetters) {
            if (!item?.automation_id || deadLettersByAutomation.has(item.automation_id)) continue;
            deadLettersByAutomation.set(item.automation_id, item);
        }

        const exceptions = [];
        for (const expectation of this.expectations) {
            const scheduledAt = scheduledAtFor(expectation, now);
            const graceDeadline = new Date(scheduledAt.getTime() + expectation.grace_minutes * 60 * 1000);
            const deadLetter = deadLettersByAutomation.get(expectation.automation_id);
            if (deadLetter) {
                exceptions.push({
                    code: 'dead_letter',
                    automation_id: expectation.automation_id,
                    created_at: deadLetter.created_at,
                    path: deadLetter.path,
                    scheduled_at: scheduledAt.toISOString(),
                    grace_deadline_at: graceDeadline.toISOString()
                });
            }

            const history = await this.runReceiptQueryService.listHistory({
                projectId: expectation.project_id,
                sourceType: expectation.source_type,
                sourceIdentity: expectation.automation_id,
                limit: 1
            });
            const latest = history?.items?.[0];
            const latestFinishedAt = latest?.finished_at ? asDate(latest.finished_at, 'receipt.finished_at') : null;
            const receiptForSchedule = latest && latestFinishedAt >= scheduledAt ? latest : null;

            if (!receiptForSchedule) {
                if (now.getTime() > graceDeadline.getTime()) {
                    exceptions.push({
                        code: 'missing_receipt',
                        automation_id: expectation.automation_id,
                        scheduled_at: scheduledAt.toISOString(),
                        grace_deadline_at: graceDeadline.toISOString()
                    });
                }
                continue;
            }

            const missingArtifacts = missingRequiredArtifacts(expectation, receiptForSchedule);
            if (isBlockedReceipt(receiptForSchedule) || missingArtifacts.length > 0) {
                exceptions.push({
                    code: 'blocked_receipt',
                    automation_id: expectation.automation_id,
                    source_status: receiptForSchedule.source_status,
                    evidence_state: receiptForSchedule.evidence_state,
                    ...(missingArtifacts.length > 0 ? { missing_required_artifacts: missingArtifacts } : {}),
                    finished_at: receiptForSchedule.finished_at,
                    scheduled_at: scheduledAt.toISOString(),
                    grace_deadline_at: graceDeadline.toISOString()
                });
            }
        }

        return exceptions
            .map((item) => ({ item, overdueMs: exceptionOverdueMs(item, now) }))
            .sort((a, b) => PRIORITY[a.item.code] - PRIORITY[b.item.code]
                || b.overdueMs - a.overdueMs
                || a.item.automation_id.localeCompare(b.item.automation_id))
            .slice(0, Math.max(0, limit))
            .map(({ item }) => item);
    }
}
