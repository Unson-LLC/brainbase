#!/usr/bin/env npx tsx

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { logHookExecution } from "../../lib/logging/hook-logger.js";

type ActivityKind =
  | "task_started"
  | "reasoning"
  | "running_command"
  | "editing_file"
  | "waiting_input"
  | "task_completed";

interface ReportPayload {
  sessionId: string;
  status: "working" | "done";
  reportedAt: number;
  lifecycle: "turn_started" | "heartbeat" | "turn_completed";
  eventType: string;
  turnId: string;
  activityKind: ActivityKind;
  taskBrief?: string | null;
  assistantSnippet?: string | null;
  currentStep?: string | null;
  latestEvidence?: string | null;
}

interface SessionStateEntry {
  activeTurnId?: string;
  lastPrompt?: string;
  startedAt?: number;
}

interface StateFileData {
  sessions: Record<string, SessionStateEntry>;
}

interface OutputResponse {
  output?: string;
  hasChoices?: boolean;
}

const PORT_CANDIDATES = [31013, 31014];
const STATE_FILE = path.join(
  process.cwd(),
  ".claude",
  "hooks",
  "data",
  "activity-bridge",
  "session-state.json",
);

// CSRF token cache: port -> { token, fetchedAt }
const csrfCache = new Map<string, { token: string; fetchedAt: number }>();
const CSRF_TTL = 50 * 60 * 1000; // 50分（サーバー側1時間TTLより短め）

async function getCsrfToken(port: string, sessionId: string): Promise<string | null> {
  const cached = csrfCache.get(port);
  if (cached && Date.now() - cached.fetchedAt < CSRF_TTL) {
    return cached.token;
  }
  try {
    const response = await fetch(`http://localhost:${port}/api/csrf-token`, {
      method: "GET",
      headers: { "X-Session-Id": sessionId },
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return null;
    const data = await response.json() as { token?: string };
    if (typeof data?.token !== "string") return null;
    csrfCache.set(port, { token: data.token, fetchedAt: Date.now() });
    return data.token;
  } catch {
    return null;
  }
}

function ensureDataDir() {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
}

function sanitizeText(value: unknown, maxLen = 160): string | null {
  if (typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  return collapsed.length > maxLen ? `${collapsed.slice(0, maxLen - 1)}…` : collapsed;
}

function createTurnId(): string {
  return `claude-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readState(): StateFileData {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      return { sessions: {} };
    }
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    return {
      sessions: typeof parsed?.sessions === "object" && parsed.sessions ? parsed.sessions : {},
    };
  } catch {
    return { sessions: {} };
  }
}

function writeState(state: StateFileData) {
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function resolveSessionId(): string | null {
  const fromEnv = sanitizeText(process.env.BRAINBASE_SESSION_ID, 120);
  if (fromEnv) return fromEnv;
  if (process.env.TMUX) {
    const result = spawnSync("tmux", ["display-message", "-p", "#S"], {
      encoding: "utf-8",
      timeout: 500,
    });
    const fromTmux = sanitizeText(result.stdout, 120);
    if (fromTmux) return fromTmux;
  }
  return null;
}

async function isHealthyPort(port: string): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${port}/api/version`, {
      method: "GET",
      signal: AbortSignal.timeout(300),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function resolvePort(): Promise<string | null> {
  const envPort = sanitizeText(process.env.BRAINBASE_PORT, 16);
  if (envPort && (await isHealthyPort(envPort))) return envPort;

  const portFile = sanitizeText(process.env.BRAINBASE_PORT_FILE, 256)
    || path.join(process.env.HOME || "", ".brainbase", "active-port");
  try {
    if (fs.existsSync(portFile)) {
      const filePort = sanitizeText(fs.readFileSync(portFile, "utf-8"), 16);
      if (filePort && (await isHealthyPort(filePort))) return filePort;
    }
  } catch {
    // ignore
  }

  const fallbackFile = path.join(process.env.HOME || "", ".brainbase-port");
  try {
    if (fs.existsSync(fallbackFile)) {
      const filePort = sanitizeText(fs.readFileSync(fallbackFile, "utf-8"), 16);
      if (filePort && (await isHealthyPort(filePort))) return filePort;
    }
  } catch {
    // ignore
  }

  for (const candidate of PORT_CANDIDATES) {
    const port = String(candidate);
    if (await isHealthyPort(port)) return port;
  }
  return envPort || String(process.env.BRAINBASE_FALLBACK_PORT || 31013);
}

async function postActivity(port: string, payload: ReportPayload): Promise<void> {
  const csrfToken = await getCsrfToken(port, payload.sessionId);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Session-Id": payload.sessionId,
  };
  if (csrfToken) {
    headers["X-CSRF-Token"] = csrfToken;
  }
  await fetch(`http://localhost:${port}/api/sessions/report_activity`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(1000),
  });
}

async function getSessionOutput(port: string, sessionId: string): Promise<OutputResponse> {
  try {
    const response = await fetch(
      `http://localhost:${port}/api/sessions/${encodeURIComponent(sessionId)}/output`,
      {
        method: "GET",
        signal: AbortSignal.timeout(1000),
      },
    );
    if (!response.ok) {
      return {};
    }
    return (await response.json()) as OutputResponse;
  } catch {
    return {};
  }
}

function derivePostToolActivity(rawInput: string | undefined): {
  activityKind: ActivityKind;
  currentStep: string;
  latestEvidence: string | null;
  skillName?: string;
} {
  try {
    const input = JSON.parse(rawInput || "{}");
    const tool = sanitizeText(input?.tool, 32) || "unknown";
    if (tool === "Bash") {
      const command = sanitizeText(input?.parameters?.command, 120);
      return {
        activityKind: "running_command",
        currentStep: "コマンドを実行中",
        latestEvidence: command,
      };
    }
    if (tool === "Edit" || tool === "Write" || tool === "MultiEdit") {
      const filePath = sanitizeText(input?.parameters?.file_path, 120);
      return {
        activityKind: "editing_file",
        currentStep: "ファイルを更新中",
        latestEvidence: filePath,
      };
    }
    if (tool === "Read") {
      const filePath = sanitizeText(input?.parameters?.file_path, 120);
      return {
        activityKind: "reasoning",
        currentStep: "情報を確認中",
        latestEvidence: filePath,
      };
    }
    if (tool === "Skill") {
      const skillName = sanitizeText(input?.parameters?.skill, 80) || undefined;
      return {
        activityKind: "reasoning",
        currentStep: skillName ? `Skill ${skillName} を実行中` : "Skill を実行中",
        latestEvidence: skillName || null,
        skillName,
      };
    }
  } catch {
    // ignore parse failures and fall back to generic heartbeat
  }

  return {
    activityKind: "reasoning",
    currentStep: "考え中",
    latestEvidence: null,
  };
}

async function recordSkillUsage(
  port: string,
  sessionId: string,
  skillName: string,
  turnId: string,
): Promise<void> {
  try {
    const csrfToken = await getCsrfToken(port, sessionId);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Session-Id": sessionId,
    };
    if (csrfToken) {
      headers["X-CSRF-Token"] = csrfToken;
    }
    await fetch(`http://localhost:${port}/api/learning/usage`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        skill_name: skillName,
        session_id: sessionId,
        turn_id: turnId,
        outcome: "completed",
      }),
      signal: AbortSignal.timeout(1000),
    });
  } catch {
    // skill usage logging is best-effort; never fail the hook
  }
}

function looksLikeWaitingForInput(output: string, hasChoices: boolean): boolean {
  if (hasChoices) return true;
  const tail = output
    .split("\n")
    .slice(-20)
    .join("\n")
    .toLowerCase();
  if (!tail.trim()) return false;
  return [
    "enter to select",
    "waiting for your input",
    "what would you like",
    "which option",
    "choose an option",
    "should i",
    "how would you like",
    "どれにしますか",
    "どうしますか",
    "選んで",
    "選択してください",
    "確認しますか",
    "続けますか",
    "入力してください",
  ].some((marker) => tail.includes(marker));
}

function extractAssistantSnippet(output: string): string | null {
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  return sanitizeText(lines.slice(-3).join(" "), 160);
}

async function withContext(
  hookType: string,
  action: string,
  fn: (context: { sessionId: string; port: string; state: StateFileData }) => Promise<void>,
) {
  const sessionId = resolveSessionId();
  if (!sessionId) {
    logHookExecution(hookType, `${action}-skip`, "BRAINBASE_SESSION_ID を解決できません");
    return;
  }
  const port = await resolvePort();
  if (!port) {
    logHookExecution(hookType, `${action}-skip`, `brainbase port を解決できません: ${sessionId}`);
    return;
  }
  const state = readState();
  await fn({ sessionId, port, state });
}

export async function startClaudeTurn(userPrompt: string | undefined): Promise<void> {
  await withContext("UserPromptSubmit", "activity-bridge-start", async ({ sessionId, port, state }) => {
    const entry = state.sessions[sessionId] || {};
    const now = Date.now();

    if (entry.activeTurnId) {
      await postActivity(port, {
        sessionId,
        status: "done",
        reportedAt: now,
        lifecycle: "turn_completed",
        eventType: "claude/implicit-turn-abandoned",
        turnId: entry.activeTurnId,
        activityKind: "task_completed",
        taskBrief: entry.lastPrompt || null,
      });
    }

    const turnId = createTurnId();
    const taskBrief = sanitizeText(userPrompt, 160);
    await postActivity(port, {
      sessionId,
      status: "working",
      reportedAt: now,
      lifecycle: "turn_started",
      eventType: "claude/user-prompt-submit",
      turnId,
      activityKind: "task_started",
      taskBrief,
      currentStep: "作業を開始",
    });

    state.sessions[sessionId] = {
      activeTurnId: turnId,
      lastPrompt: taskBrief || undefined,
      startedAt: now,
    };
    writeState(state);
    logHookExecution("UserPromptSubmit", "activity-bridge-start", `${sessionId}:${turnId}`);
  });
}

export async function heartbeatClaudeTurn(rawToolInput?: string): Promise<void> {
  await withContext("PostToolUse", "activity-bridge-heartbeat", async ({ sessionId, port, state }) => {
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
        eventType: "claude/post-tool-bootstrap",
        turnId,
        activityKind: "task_started",
        taskBrief: entry.lastPrompt || null,
        currentStep: "作業を開始",
      });
    }

    const activity = derivePostToolActivity(rawToolInput);
    await postActivity(port, {
      sessionId,
      status: "working",
      reportedAt: now,
      lifecycle: "heartbeat",
      eventType: "claude/post-tool-use",
      turnId,
      activityKind: activity.activityKind,
      taskBrief: entry.lastPrompt || null,
      currentStep: activity.currentStep,
      latestEvidence: activity.latestEvidence,
    });

    if (activity.skillName) {
      await recordSkillUsage(port, sessionId, activity.skillName, turnId);
    }

    state.sessions[sessionId] = {
      activeTurnId: turnId,
      lastPrompt: entry.lastPrompt,
      startedAt: entry.startedAt || now,
    };
    writeState(state);
    logHookExecution("PostToolUse", "activity-bridge-heartbeat", `${sessionId}:${turnId}:${activity.activityKind}`);
  });
}

export async function completeClaudeTurn(): Promise<void> {
  await withContext("Stop", "activity-bridge-complete", async ({ sessionId, port, state }) => {
    const now = Date.now();
    const entry = state.sessions[sessionId] || {};
    const turnId = entry.activeTurnId || createTurnId();
    const outputResult = await getSessionOutput(port, sessionId);
    const output = typeof outputResult.output === "string" ? outputResult.output : "";
    const hasChoices = Boolean(outputResult.hasChoices);
    const waiting = looksLikeWaitingForInput(output, hasChoices);
    const assistantSnippet = extractAssistantSnippet(output);

    await postActivity(port, {
      sessionId,
      status: "done",
      reportedAt: now,
      lifecycle: "turn_completed",
      eventType: waiting ? "waiting_for_user_input" : "turn/completed",
      turnId,
      activityKind: waiting ? "waiting_input" : "task_completed",
      taskBrief: entry.lastPrompt || null,
      assistantSnippet,
      currentStep: waiting ? "ユーザー入力待ち" : "作業完了",
    });

    delete state.sessions[sessionId];
    writeState(state);
    logHookExecution("Stop", "activity-bridge-complete", `${sessionId}:${turnId}:${waiting ? "waiting" : "done"}`);
  });
}
