#!/usr/bin/env npx tsx

// core/monitoring/brainbase-activity-bridge.ts
import * as fs2 from "fs";
import * as path2 from "path";
import { spawnSync } from "child_process";

// lib/logging/hook-logger.ts
import * as fs from "fs";
import * as path from "path";
function logHookExecution(hookType, action, details) {
  try {
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const dateStr = timestamp.split("T")[0];
    const status = action.toUpperCase();
    const message = details ? `${hookType}: ${details}` : hookType;
    const logMessage = `${timestamp} [${status}] ${message}
`;
    const logsDir = path.join(process.cwd(), ".claude", "output", "logs");
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    const logFileName = hookType.toLowerCase().replace(/([a-z])([A-Z])/g, "$1-$2");
    const logFile = path.join(logsDir, `${logFileName}-${dateStr}.log`);
    fs.appendFileSync(logFile, logMessage);
  } catch (error) {
    console.error(`[Hook Logger Error] ${error}`);
  }
}

// core/monitoring/brainbase-activity-bridge.ts
var PORT_CANDIDATES = [31013, 31014];
var STATE_FILE = path2.join(
  process.cwd(),
  ".claude",
  "hooks",
  "data",
  "activity-bridge",
  "session-state.json"
);
var csrfCache = /* @__PURE__ */ new Map();
var CSRF_TTL = 50 * 60 * 1e3;
var CSRF_CACHE_FILE = path2.join(
  process.cwd(),
  ".claude",
  "hooks",
  "data",
  "activity-bridge",
  "csrf-cache.json"
);
function readCsrfDiskCache() {
  try {
    if (!fs2.existsSync(CSRF_CACHE_FILE)) return {};
    const parsed = JSON.parse(fs2.readFileSync(CSRF_CACHE_FILE, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}
function writeCsrfDiskCache(cache) {
  try {
    fs2.mkdirSync(path2.dirname(CSRF_CACHE_FILE), { recursive: true });
    fs2.writeFileSync(CSRF_CACHE_FILE, JSON.stringify(cache));
  } catch {
  }
}
function invalidateCsrfToken(port) {
  csrfCache.delete(port);
  try {
    const disk = readCsrfDiskCache();
    if (disk[port]) {
      delete disk[port];
      writeCsrfDiskCache(disk);
    }
  } catch {
  }
}
async function getCsrfToken(port, sessionId, forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh) {
    const mem = csrfCache.get(port);
    if (mem && now - mem.fetchedAt < CSRF_TTL) return mem.token;
    const disk = readCsrfDiskCache()[port];
    if (disk && typeof disk.token === "string" && now - disk.fetchedAt < CSRF_TTL) {
      csrfCache.set(port, disk);
      return disk.token;
    }
  }
  try {
    const response = await fetch(`http://localhost:${port}/api/csrf-token`, {
      method: "GET",
      headers: { "X-Session-Id": sessionId },
      signal: AbortSignal.timeout(1e3)
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (typeof data?.token !== "string") return null;
    const entry = { token: data.token, fetchedAt: Date.now() };
    csrfCache.set(port, entry);
    const disk = readCsrfDiskCache();
    disk[port] = entry;
    writeCsrfDiskCache(disk);
    return data.token;
  } catch {
    return null;
  }
}
function ensureDataDir() {
  fs2.mkdirSync(path2.dirname(STATE_FILE), { recursive: true });
}
function sanitizeText(value, maxLen = 160) {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.length > maxLen ? `${collapsed.slice(0, maxLen - 1)}\u2026` : collapsed;
}
function createTurnId() {
  return `claude-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function readState() {
  try {
    if (!fs2.existsSync(STATE_FILE)) {
      return { sessions: {} };
    }
    const parsed = JSON.parse(fs2.readFileSync(STATE_FILE, "utf-8"));
    return {
      sessions: typeof parsed?.sessions === "object" && parsed.sessions ? parsed.sessions : {}
    };
  } catch {
    return { sessions: {} };
  }
}
function writeState(state) {
  ensureDataDir();
  fs2.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
function resolveSessionIdFromEnvironment() {
  const fromEnv = sanitizeText(process.env.BRAINBASE_SESSION_ID, 120);
  if (fromEnv) return fromEnv;
  if (process.env.TMUX) {
    const result = spawnSync("tmux", ["display-message", "-p", "#S"], {
      encoding: "utf-8",
      timeout: 500
    });
    const fromTmux = sanitizeText(result.stdout, 120);
    if (fromTmux) return fromTmux;
  }
  return null;
}
function normalizeComparablePath(value) {
  const text = sanitizeText(value, 1024);
  if (!text) return null;
  try {
    return fs2.realpathSync.native(text);
  } catch {
    return path2.resolve(text);
  }
}
function collectProjectPathCandidates() {
  const candidates = [
    process.env.BRAINBASE_HOOK_ORIGINAL_CWD,
    process.env.CLAUDE_PROJECT_DIR,
    process.env.PWD,
    process.env.INIT_CWD,
    process.cwd()
  ].map(normalizeComparablePath).filter((value) => Boolean(value));
  return Array.from(new Set(candidates));
}
function collectSessionPaths(session) {
  return [
    session.path,
    session.worktree?.path,
    session.lastKnownGoodPath,
    session.summary?.workspacePath,
    session.summary?.currentDirectory
  ].map(normalizeComparablePath).filter((value) => Boolean(value));
}
function timestampValue(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
function rankSessionCandidate(session) {
  const intendedState = typeof session.intendedState === "string" ? session.intendedState : "";
  const stateRank = intendedState === "active" || intendedState === "running" ? 1e15 : 0;
  const updatedAt = Math.max(
    timestampValue(session.updatedAt),
    timestampValue(session.lastAccessedAt),
    timestampValue(session.createdAt)
  );
  return stateRank + updatedAt;
}
async function resolveSessionIdFromProjectPath(port) {
  const projectPaths = collectProjectPathCandidates();
  if (projectPaths.length === 0) return null;
  try {
    const response = await fetch(`http://localhost:${port}/api/state`, {
      method: "GET",
      signal: AbortSignal.timeout(1e3)
    });
    if (!response.ok) return null;
    const data = await response.json();
    const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
    const matches = sessions.filter((session) => typeof session?.id === "string").filter((session) => {
      const sessionPaths = collectSessionPaths(session);
      return sessionPaths.some((sessionPath) => projectPaths.includes(sessionPath));
    }).sort((a, b) => rankSessionCandidate(b) - rankSessionCandidate(a));
    return typeof matches[0]?.id === "string" ? matches[0].id : null;
  } catch {
    return null;
  }
}
async function resolveSessionId(port) {
  return resolveSessionIdFromEnvironment() || await resolveSessionIdFromProjectPath(port);
}
async function isHealthyPort(port) {
  try {
    const response = await fetch(`http://localhost:${port}/api/version`, {
      method: "GET",
      signal: AbortSignal.timeout(300)
    });
    return response.ok;
  } catch {
    return false;
  }
}
async function resolvePort() {
  const envPort = sanitizeText(process.env.BRAINBASE_PORT, 16);
  if (envPort && await isHealthyPort(envPort)) return envPort;
  const portFile = sanitizeText(process.env.BRAINBASE_PORT_FILE, 256) || path2.join(process.env.HOME || "", ".brainbase", "active-port");
  try {
    if (fs2.existsSync(portFile)) {
      const filePort = sanitizeText(fs2.readFileSync(portFile, "utf-8"), 16);
      if (filePort && await isHealthyPort(filePort)) return filePort;
    }
  } catch {
  }
  const fallbackFile = path2.join(process.env.HOME || "", ".brainbase-port");
  try {
    if (fs2.existsSync(fallbackFile)) {
      const filePort = sanitizeText(fs2.readFileSync(fallbackFile, "utf-8"), 16);
      if (filePort && await isHealthyPort(filePort)) return filePort;
    }
  } catch {
  }
  for (const candidate of PORT_CANDIDATES) {
    const port = String(candidate);
    if (await isHealthyPort(port)) return port;
  }
  return envPort || String(process.env.BRAINBASE_FALLBACK_PORT || 31013);
}
async function postReportActivity(port, payload, csrfToken) {
  const headers = {
    "Content-Type": "application/json",
    "X-Session-Id": payload.sessionId
  };
  if (csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }
  try {
    return await fetch(`http://localhost:${port}/api/sessions/report_activity`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(1e3)
    });
  } catch {
    return null;
  }
}
async function postActivity(port, payload) {
  const csrfToken = await getCsrfToken(port, payload.sessionId);
  const response = await postReportActivity(port, payload, csrfToken);
  if (response && response.status === 403) {
    invalidateCsrfToken(port);
    const freshToken = await getCsrfToken(port, payload.sessionId, true);
    if (freshToken) {
      await postReportActivity(port, payload, freshToken);
    }
  }
}
async function withContext(hookType, action, fn) {
  const port = await resolvePort();
  if (!port) {
    logHookExecution(hookType, `${action}-skip`, "brainbase port \u3092\u89E3\u6C7A\u3067\u304D\u307E\u305B\u3093");
    return;
  }
  const sessionId = await resolveSessionId(port);
  if (!sessionId) {
    logHookExecution(hookType, `${action}-skip`, "BRAINBASE_SESSION_ID \u3092\u89E3\u6C7A\u3067\u304D\u307E\u305B\u3093");
    return;
  }
  const state = readState();
  await fn({ sessionId, port, state });
}
var WAITING_NOTIFICATION_TYPES = /* @__PURE__ */ new Set([
  "permission_prompt",
  "elicitation_dialog"
]);
function isWaitingNotification(notificationType, message) {
  const t = (notificationType || "").toLowerCase();
  if (WAITING_NOTIFICATION_TYPES.has(t)) return true;
  if (t === "idle_prompt" || t === "auth_success" || t.startsWith("elicitation_")) {
    return false;
  }
  const m = (message || "").toLowerCase();
  return [
    "permission",
    "approve",
    "waiting for your input",
    "needs your",
    "choose",
    "select an option",
    "\u3092\u9078",
    "\u8A31\u53EF",
    "\u8FD4\u7B54",
    "\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044"
  ].some((marker) => m.includes(marker));
}
async function notifyClaudeWaiting(rawPayload) {
  await withContext("Notification", "activity-bridge-notification", async ({ sessionId, port, state }) => {
    let payload = {};
    try {
      payload = JSON.parse(rawPayload || process.env.CLAUDE_NOTIFICATION || "{}");
    } catch {
      payload = {};
    }
    const notificationType = sanitizeText(
      payload.notification_type ?? payload.notificationType ?? payload.type,
      64
    );
    const message = sanitizeText(payload.message, 160);
    logHookExecution(
      "Notification",
      "activity-bridge-notification",
      `${sessionId}:type=${notificationType || "?"}:waiting=${isWaitingNotification(notificationType, message)}:msg=${message || ""}`
    );
    if (!isWaitingNotification(notificationType, message)) return;
    const now = Date.now();
    const entry = state.sessions[sessionId] || {};
    let turnId = entry.activeTurnId;
    if (!turnId) {
      turnId = createTurnId();
      await postActivity(port, {
        sessionId,
        status: "working",
        reportedAt: now,
        lifecycle: "turn_started",
        eventType: "claude/notification-bootstrap",
        turnId,
        activityKind: "task_started",
        taskBrief: entry.lastPrompt || null,
        currentStep: "\u4F5C\u696D\u3092\u958B\u59CB"
      });
    }
    await postActivity(port, {
      sessionId,
      status: "working",
      reportedAt: now,
      lifecycle: "heartbeat",
      eventType: "claude/notification-waiting",
      turnId,
      activityKind: "waiting_input",
      taskBrief: entry.lastPrompt || null,
      currentStep: "\u30E6\u30FC\u30B6\u30FC\u8FD4\u7B54\u5F85\u3061",
      latestEvidence: message
    });
    state.sessions[sessionId] = {
      activeTurnId: turnId,
      lastPrompt: entry.lastPrompt,
      startedAt: entry.startedAt || now
    };
    writeState(state);
  });
}

// hooks/notification/activity-bridge.ts
function readStdin() {
  return new Promise((resolve2) => {
    if (process.stdin.isTTY) {
      resolve2("");
      return;
    }
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve2(data));
    process.stdin.on("error", () => resolve2(data));
    setTimeout(() => resolve2(data), 800);
  });
}
async function main() {
  try {
    const payload = await readStdin();
    await notifyClaudeWaiting(payload || process.argv[2] || "");
    process.exit(0);
  } catch (error) {
    console.error(
      "\u274C Activity bridge(Notification) \u5B9F\u884C\u30A8\u30E9\u30FC:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(0);
  }
}
if (process.argv[1] === import.meta.url.replace("file://", "")) {
  main().catch((error) => {
    console.error("\u274C \u30D5\u30C3\u30AF\u5B9F\u884C\u30A8\u30E9\u30FC:", error);
    process.exit(0);
  });
}
