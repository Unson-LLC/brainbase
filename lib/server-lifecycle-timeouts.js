export const HTTP_SERVER_CLOSE_TIMEOUT_MS = 5_000;

// Must exceed the HTTP close timeout so graceful shutdown can release
// persistent single-writer ownership before the old process is killed.
export const PREVIOUS_SERVER_GRACE_PERIOD_MS = 10_000;
