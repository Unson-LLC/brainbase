import { createBrainbaseActivityRawLedgerRecord } from '../../services/session-core/activity-raw-ledger-adapter.js';

export function installActivityHandlers(controller) {
    controller.reportActivity = async (req, res) => {
        const {
            sessionId,
            status,
            reportedAt,
            lifecycle,
            eventType,
            turnId,
            activityKind,
            taskBrief,
            assistantSnippet,
            currentStep,
            latestEvidence,
            actorPersonId,
            actorExternalId,
            workspace,
            channelId,
            projectCode,
            permissionSnapshot
        } = req.body;
        if (!sessionId || !status) {
            return res.status(400).json({ error: 'Missing sessionId or status' });
        }
        if (status !== 'working' && status !== 'done') {
            return res.status(400).json({ error: 'Invalid status' });
        }

        const activityMetadata = {
            lifecycle,
            eventType,
            turnId,
            activityKind,
            taskBrief,
            assistantSnippet,
            currentStep,
            latestEvidence,
            actorPersonId,
            actorExternalId,
            workspace,
            channelId,
            projectCode,
            permissionSnapshot
        };
        const rawLedgerRecord = createBrainbaseActivityRawLedgerRecord({
            sessionId,
            status,
            reportedAt,
            metadata: activityMetadata
        });

        controller.activity.reportActivity(sessionId, status, reportedAt, {
            lifecycle,
            eventType,
            turnId,
            activityKind,
            taskBrief,
            assistantSnippet,
            currentStep,
            latestEvidence
        });
        res.json({ success: true, rawLedgerRecord });
    };

    controller.getStatus = (req, res) => {
        res.json(controller.activity.getSessionStatus());
    };

    controller.clearDone = (req, res) => {
        const { id } = req.params;
        if (!id) {
            return res.status(400).json({ error: 'Session ID is required' });
        }

        controller.activity.clearDoneStatus(id);
        res.json({ success: true });
    };

    controller.getUiSummaries = async (req, res) => {
        const state = controller.stateStore.get();
        const requestedIds = typeof req.query.ids === 'string' && req.query.ids.trim()
            ? req.query.ids.split(',').map((id) => id.trim()).filter(Boolean)
            : null;
        const sessions = (state.sessions || []).filter((session) => {
            if (!requestedIds) return true;
            return requestedIds.includes(session.id);
        });

        const entries = await Promise.all(
            sessions.map(async (session) => {
                const summary = await controller._getCachedSessionUiSummary(session);
                return [session.id, summary];
            })
        );

        res.json(Object.fromEntries(entries));
    };
}
