export function buildDirectLaunchDecision({
    port,
    canonicalPort = 31013,
    startedByStartJs = false,
    allowDirectServer = false,
    testMode = false,
    isWorktree = false
} = {}) {
    const normalizedPort = Number(port);
    const normalizedCanonicalPort = Number(canonicalPort);
    const isCanonicalPort = normalizedPort === normalizedCanonicalPort;

    if (!isCanonicalPort || startedByStartJs || allowDirectServer || testMode || isWorktree) {
        return { allowed: true, reason: 'allowed' };
    }

    return {
        allowed: false,
        reason: 'direct_canonical_server_blocked',
        message: `Direct server.js launch on canonical port ${normalizedCanonicalPort} is blocked. Use start.js or set BRAINBASE_ALLOW_DIRECT_SERVER=1 for development.`
    };
}

export function assertAllowedServerEntrypoint(options = {}) {
    const decision = buildDirectLaunchDecision(options);
    if (decision.allowed) return decision;

    const error = new Error(decision.message);
    error.code = decision.reason;
    throw error;
}
