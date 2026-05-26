const START_METHODS = new Set([
  'turn/started',
  'task_started'
]);

const THREAD_START_METHODS = new Set([
  'thread/started'
]);

const COMPLETE_METHODS = new Set([
  'turn/completed',
  'task_complete',
  'codex/event/task_complete',
  'user-input-requested',
  'user_input_requested',
  'request-user-input',
  'request_input',
  'waiting-for-user-input',
  'waiting_for_user_input',
  'turn/failed',
  'turn/interrupted',
  'error',
  'codex/event/error'
]);

function normalizeString(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

export function buildActivityReportFailureWarning({ port, pathname, method, reason } = {}) {
  return `[codex-app-repl] activity report failed ${method || 'POST'} http://localhost:${port}${pathname}: ${reason || 'request failed'}\n`;
}

export function createActivityReportFailureWarner(write) {
  const reportedFailures = new Set();
  return function warnPostFailure(port, pathname, method, reason) {
    const normalizedMethod = method || 'POST';
    const key = `${normalizedMethod}:${port}:${pathname}`;
    if (reportedFailures.has(key)) return false;
    reportedFailures.add(key);
    write(buildActivityReportFailureWarning({
      port,
      pathname,
      method: normalizedMethod,
      reason
    }));
    return true;
  };
}

export function resolveAppServerTurnId(params = {}, fallbackTurnId = null) {
  return normalizeString(params.turnId)
    || normalizeString(params.turn_id)
    || normalizeString(params.turn?.id)
    || normalizeString(params.task?.turnId)
    || normalizeString(params.task?.turn_id)
    || normalizeString(fallbackTurnId)
    || null;
}

export function resolveAppServerThreadId(params = {}, fallbackThreadId = null) {
  return normalizeString(params.threadId)
    || normalizeString(params.thread_id)
    || normalizeString(params.thread?.id)
    || normalizeString(params.turn?.threadId)
    || normalizeString(params.turn?.thread_id)
    || normalizeString(params.turn?.thread?.id)
    || normalizeString(params.task?.threadId)
    || normalizeString(params.task?.thread_id)
    || normalizeString(fallbackThreadId)
    || null;
}

export function classifyAppServerNotification(method) {
  const normalized = normalizeString(method);
  if (THREAD_START_METHODS.has(normalized)) {
    return {
      supported: true,
      status: 'done',
      lifecycle: 'thread_started',
      activityKind: 'task_completed',
      currentStep: 'Codex App Serverのスレッドを準備'
    };
  }
  if (START_METHODS.has(normalized)) {
    return {
      supported: true,
      status: 'working',
      lifecycle: 'turn_started',
      activityKind: 'task_started',
      currentStep: 'Codex App Serverで作業開始'
    };
  }
  if (COMPLETE_METHODS.has(normalized)) {
    return {
      supported: true,
      status: 'done',
      lifecycle: 'turn_completed',
      activityKind: 'task_completed',
      currentStep: 'Codex App Serverのターンが完了'
    };
  }
  return {
    supported: false,
    reason: 'unsupported_method'
  };
}

export function buildActivityReportPayload({
  sessionId,
  method,
  params = {},
  reportedAt = Date.now(),
  fallbackTurnId = null
} = {}) {
  const resolvedSessionId = normalizeString(sessionId);
  if (!resolvedSessionId) {
    return { mutates: false, reason: 'missing_session_id' };
  }

  const classification = classifyAppServerNotification(method);
  if (!classification.supported) {
    return { mutates: false, reason: classification.reason, method };
  }

  const turnId = resolveAppServerTurnId(params, fallbackTurnId);
  return {
    mutates: true,
    payload: {
      sessionId: resolvedSessionId,
      status: classification.status,
      reportedAt,
      lifecycle: classification.lifecycle,
      eventType: method,
      ...(turnId ? { turnId } : {}),
      activityKind: classification.activityKind,
      currentStep: classification.currentStep,
      latestEvidence: 'codex app-server notification'
    }
  };
}

export function buildCodexAppServerStatePatch({
  sessionId,
  method,
  params = {},
  reportedAt = Date.now(),
  fallbackThreadId = null,
  fallbackTurnId = null
} = {}) {
  const resolvedSessionId = normalizeString(sessionId);
  if (!resolvedSessionId) {
    return { mutates: false, reason: 'missing_session_id' };
  }

  const classification = classifyAppServerNotification(method);
  if (!classification.supported) {
    return { mutates: false, reason: classification.reason, method };
  }

  const threadId = resolveAppServerThreadId(params, fallbackThreadId);
  const turnId = resolveAppServerTurnId(params, fallbackTurnId);
  const reportedAtIso = new Date(reportedAt).toISOString();
  const lifecycle = classification.lifecycle;
  const status = classification.status;
  const activeTurnId = lifecycle === 'turn_started' ? turnId : null;

  return {
    mutates: true,
    sessionId: resolvedSessionId,
    patch: {
      codexAppServer: {
        source: 'codex_app_server',
        ...(threadId ? { threadId } : {}),
        activeTurnId,
        lastTurnId: turnId || null,
        lifecycle,
        status,
        lastEventType: method,
        updatedAt: reportedAtIso,
        restore: threadId
          ? {
              strategy: 'codex_app_server_thread',
              threadId,
              updatedAt: reportedAtIso
            }
          : undefined
      }
    }
  };
}
