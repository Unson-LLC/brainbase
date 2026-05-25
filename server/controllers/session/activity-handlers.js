import { createBrainbaseActivityRawLedgerRecord } from '../../services/session-core/activity-raw-ledger-adapter.js';

function indexRuntimeInventoryBySessionId(inventory) {
    const entries = new Map();
    for (const session of inventory?.sessions || []) {
        if (!session?.sessionId) continue;
        entries.set(session.sessionId, {
            runtimePresence: session.runtimePresence || 'cold',
            rssKb: Number(session.rssKb || 0),
            processCount: Number(session.processCount || 0),
            processesByCategory: session.processesByCategory || {}
        });
    }
    return entries;
}

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

    // Short TTL cache for getRuntimeInventory(): the inventory aggregates
    // process/RSS info across all sessions and is the bottleneck inside
    // GET /api/sessions/ui-summaries (VibePro story-session-switch-performance
    // measured 1.3s p95). It rarely changes within a single session-switch
    // burst, so caching for 3s coalesces the typical 5-10 calls a switch fires.
    const RUNTIME_INVENTORY_CACHE_TTL_MS = 3000;
    let runtimeInventoryCacheExpiresAt = 0;
    let runtimeInventoryCachePromise = null;
    async function getRuntimeInventoryCached() {
        if (typeof controller.runtimeQuery?.getRuntimeInventory !== 'function') {
            return null;
        }
        if (runtimeInventoryCachePromise && Date.now() < runtimeInventoryCacheExpiresAt) {
            return runtimeInventoryCachePromise;
        }
        runtimeInventoryCacheExpiresAt = Date.now() + RUNTIME_INVENTORY_CACHE_TTL_MS;
        runtimeInventoryCachePromise = (async () => {
            try {
                return await controller.runtimeQuery.getRuntimeInventory();
            } catch (error) {
                console.warn('[runtime-inventory] Failed to include inventory in UI summaries:', error);
                runtimeInventoryCachePromise = null;
                runtimeInventoryCacheExpiresAt = 0;
                return null;
            }
        })();
        return runtimeInventoryCachePromise;
    }

    controller.getUiSummaries = async (req, res) => {
        const state = controller.stateStore.get();
        const requestedIds = typeof req.query.ids === 'string' && req.query.ids.trim()
            ? req.query.ids.split(',').map((id) => id.trim()).filter(Boolean)
            : null;
        const sessions = (state.sessions || []).filter((session) => {
            if (!requestedIds) return true;
            return requestedIds.includes(session.id);
        });

        let runtimeInventoryBySessionId = new Map();
        const cachedInventory = await getRuntimeInventoryCached();
        if (cachedInventory) {
            runtimeInventoryBySessionId = indexRuntimeInventoryBySessionId(cachedInventory);
        }

        const entries = await Promise.all(
            sessions.map(async (session) => {
                const summary = {
                    ...await controller._getCachedSessionUiSummary(session),
                    runtimeInventory: runtimeInventoryBySessionId.get(session.id) || {
                        runtimePresence: 'cold',
                        rssKb: 0,
                        processCount: 0,
                        processesByCategory: {}
                    }
                };
                return [session.id, summary];
            })
        );

        res.json(Object.fromEntries(entries));
    };
}
