#!/usr/bin/env npx tsx

import { createServer } from "http";
import * as fs from "fs";
import * as path from "path";
import {
  completeClaudeTurn,
  heartbeatClaudeTurn,
  startClaudeTurn,
} from "../core/monitoring/brainbase-activity-bridge.js";

interface ReportRecord {
  sessionId: string;
  status: string;
  lifecycle: string;
  eventType: string;
  turnId: string;
  activityKind?: string;
}

interface TestResult {
  name: string;
  success: boolean;
  detail: string;
}

const reports: ReportRecord[] = [];
const results: TestResult[] = [];
const repoRoot = process.cwd();
const sessionId = "session-claude-activity-test";
const stateFile = path.join(
  repoRoot,
  ".claude",
  "hooks",
  "data",
  "activity-bridge",
  "session-state.json",
);

fs.rmSync(path.dirname(stateFile), { recursive: true, force: true });

const server = createServer((req, res) => {
  if (!req.url) {
    res.statusCode = 404;
    res.end();
    return;
  }

  if (req.url === "/api/version") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.url === "/api/state") {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      sessions: [{
        id: sessionId,
        path: repoRoot,
        worktree: { path: repoRoot },
        intendedState: "active",
        updatedAt: "2026-04-19T00:00:00.000Z",
      }],
    }));
    return;
  }

  if (req.url === "/api/sessions/report_activity" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      reports.push(JSON.parse(body));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  if (req.url === `/api/sessions/${sessionId}/output`) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      output: "1. Continue\n2. Stop\nEnter to select (1-2):",
      hasChoices: true,
    }));
    return;
  }

  res.statusCode = 404;
  res.end();
});

async function run() {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  const port = String(address.port);
  const env = {
    ...process.env,
    BRAINBASE_PORT: port,
    BRAINBASE_SESSION_ID: "",
    BRAINBASE_HOOK_ORIGINAL_CWD: repoRoot,
    CLAUDE_PROJECT_DIR: repoRoot,
    CLAUDE_USER_PROMPT: "一覧の色の不具合を確認して",
    TMUX: "",
  };

  Object.assign(process.env, env);
  await startClaudeTurn(env.CLAUDE_USER_PROMPT);

  const startReport = reports.at(-1);
  results.push({
    name: "UserPromptSubmit starts working turn",
    success: Boolean(startReport
      && startReport.status === "working"
      && startReport.lifecycle === "turn_started"
      && startReport.activityKind === "task_started"),
    detail: JSON.stringify(startReport || null),
  });

  await heartbeatClaudeTurn("{\"tool\":\"Bash\",\"parameters\":{\"command\":\"npm test\"}}");
  const heartbeatReport = reports.at(-1);
  results.push({
    name: "PostToolUse sends heartbeat",
    success: Boolean(heartbeatReport
      && heartbeatReport.status === "working"
      && heartbeatReport.lifecycle === "heartbeat"
      && heartbeatReport.activityKind === "running_command"),
    detail: JSON.stringify(heartbeatReport || null),
  });

  await completeClaudeTurn();
  const stopReport = reports.at(-1);
  results.push({
    name: "Stop maps choices to waiting_input",
    success: Boolean(stopReport
      && stopReport.status === "done"
      && stopReport.lifecycle === "turn_completed"
      && stopReport.activityKind === "waiting_input"),
    detail: JSON.stringify(stopReport || null),
  });

  const remainingState = fs.existsSync(stateFile)
    ? JSON.parse(fs.readFileSync(stateFile, "utf-8"))
    : { sessions: {} };
  results.push({
    name: "State file clears active turn on stop",
    success: Object.keys(remainingState.sessions || {}).length === 0,
    detail: JSON.stringify(remainingState),
  });

  const failed = results.filter((result) => !result.success);
  for (const result of results) {
    console.log(`${result.success ? "✅" : "❌"} ${result.name}`);
    if (!result.success) {
      console.log(result.detail);
    }
  }
  server.closeAllConnections?.();
  server.close();
  if (failed.length > 0) {
    process.exit(1);
  }
  process.exit(0);
}

run().catch((error) => {
  console.error(error);
  server.close();
  process.exit(1);
});
