// @ts-check
import { getCodexAppServerThreadId } from '../../services/codex-app-server-session-state.js';

export function shouldStartCodexAppServerSession(engine, requested) {
    return engine === 'codex' && requested === true;
}

export async function waitForCodexAppServerSessionMetadata(controller, sessionId, {
    timeoutMs = 5000,
    intervalMs = 100
} = {}) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
        const session = controller?._getSessionById?.(sessionId)
            || controller?.stateStore?.get?.()?.sessions?.find((entry) => entry?.id === sessionId)
            || null;
        const threadId = getCodexAppServerThreadId(session, session?.engine);
        if (threadId) {
            return { session, threadId };
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    throw new Error(`Codex App Server metadata was not persisted for ${sessionId}`);
}
