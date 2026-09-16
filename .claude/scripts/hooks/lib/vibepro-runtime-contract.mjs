#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildRepositoryTargetHandoff } from "../../../../scripts/repository-target-handoff.mjs";

export const EXPECTED_VIBEPRO_VERSION = "0.2.0-beta.24";
export const EXPECTED_VIBEPRO_SOURCE_COMMIT = "ebaa940a5894e26ad817c4af4c61a5a9f0d99983";
export const CANONICAL_VIBEPRO_LAUNCHER = path.join(homedir(), ".local", "bin", "vibepro");

export function sanitizeHookEnvironment(env = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !name.startsWith("GIT_")),
  );
}

export function validateRuntimeIdentity(identity) {
  const failures = [];
  if (!identity || typeof identity !== "object") failures.push("runtime identity is missing");
  if (identity?.package?.exact_version !== EXPECTED_VIBEPRO_VERSION) {
    failures.push(`expected exact version ${EXPECTED_VIBEPRO_VERSION}`);
  }
  if (identity?.source_kind !== "npm_package") failures.push("source kind must be npm_package");
  if (identity?.release_manifest?.status !== "valid") failures.push("release manifest must be valid");
  if (identity?.source_git?.commit !== EXPECTED_VIBEPRO_SOURCE_COMMIT) {
    failures.push(`expected source commit ${EXPECTED_VIBEPRO_SOURCE_COMMIT}`);
  }
  if (identity?.source_git?.dirty !== false) failures.push("runtime must be clean");
  if (identity?.source_git?.origin_main_relation !== "published") {
    failures.push("origin relation must be published");
  }
  if (identity?.integrity?.status !== "trusted") failures.push("integrity status must be trusted");
  if (typeof identity?.identity_digest !== "string" || identity.identity_digest.length !== 64) {
    failures.push("identity digest must be a SHA-256 hex digest");
  }
  if (failures.length > 0) throw new Error(`runtime_mismatch: ${failures.join("; ")}`);
  return identity;
}

export function parseJsonOutput(stdout, label) {
  const value = String(stdout ?? "").trim();
  if (!value) throw new Error(`${label} produced no JSON output`);
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`${label} produced invalid JSON: ${error.message}`);
  }
}

function invokeVibePro(args, cwd, runner = spawnSync, envPatch = {}) {
  const result = runner(CANONICAL_VIBEPRO_LAUNCHER, args, {
    cwd,
    env: { ...sanitizeHookEnvironment(), ...envPatch },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120000,
  });
  if (result.error) throw new Error(`canonical VibePro failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim().slice(0, 1000);
    throw new Error(`canonical VibePro exited ${result.status}: ${detail}`);
  }
  return parseJsonOutput(result.stdout, `vibepro ${args.join(" ")}`);
}

export function queryCanonicalIdentity(cwd, runner = spawnSync) {
  return validateRuntimeIdentity(invokeVibePro(["runtime", "identity", "--json"], cwd, runner));
}

export function checkPushTarget(cwd, repository, pushUrl, runner = spawnSync) {
  const handoff = buildRepositoryTargetHandoff({ repository, cwd });
  if (typeof pushUrl !== "string" || !pushUrl || pushUrl.startsWith("-") || pushUrl.includes("\0")) {
    throw new Error("Gitが渡す送信先URLが必要です。");
  }
  const failure = "送信先を照合できません。対応するVibeProと変更先の指定を確認してください。";
  let result;
  try {
    result = runner(CANONICAL_VIBEPRO_LAUNCHER,
      ["guard", "target", ".", "--push-url", pushUrl, "--json"], {
        cwd: handoff.cwd,
        env: { ...sanitizeHookEnvironment(), ...handoff.env },
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000,
      });
  } catch { throw new Error(failure); }
  if (result.error || result.status !== 0) throw new Error(failure);
  let receipt;
  try { receipt = JSON.parse(result.stdout); } catch { throw new Error(failure); }
  if (receipt?.schema_version !== "repository-target-v1" || receipt.repository !== repository || receipt.status !== "matched") {
    throw new Error(failure);
  }
  return receipt;
}

// External write entrypoint. Caller must already have permission to create/push the PR.
export function createWithCanonicalRuntime(cwd, repository, runner = spawnSync) {
  const handoff = buildRepositoryTargetHandoff({ repository, cwd });
  queryCanonicalIdentity(cwd, runner);
  // Capability probe only: this URL is not evidence of the actual Git destination.
  // VibePro pr create and pre-push independently check the actual remote URL.
  checkPushTarget(cwd, repository, `https://github.com/${repository}.git`, runner);
  return invokeVibePro([...handoff.args, "--json"], handoff.cwd, runner, handoff.env);
}

export function prepareWithCanonicalRuntime(cwd, base = "origin/develop", runner = spawnSync) {
  const identity = queryCanonicalIdentity(cwd, runner);
  const result = invokeVibePro(["pr", "prepare", ".", "--base", base, "--json"], cwd, runner);
  const preparationIdentity = validateRuntimeIdentity(result?.runtime_identity);
  if (preparationIdentity.identity_digest !== identity.identity_digest) {
    throw new Error("runtime_mismatch: pr prepare identity digest differs from preflight identity");
  }
  return { identity, result };
}

function readOption(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const cwd = path.resolve(readOption(args, "--cwd", process.cwd()));
  const base = readOption(args, "--base", "origin/develop");
  if (command === "pr-create") {
    const repositoryOptions = args.filter(arg => arg === "--repo");
    if (repositoryOptions.length !== 1) throw new Error("変更先の --repo を一つ指定してください。");
    process.stdout.write(`${JSON.stringify(createWithCanonicalRuntime(cwd, readOption(args, "--repo")))}\n`);
    return;
  }
  if (command === "push-target") {
    const result = checkPushTarget(cwd, process.env.VIBEPRO_EXPECTED_REPOSITORY, readOption(args, "--push-url"));
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (command === "identity") {
    const runtimeIdentity = queryCanonicalIdentity(cwd);
    process.stdout.write(`${JSON.stringify({
      schema_version: "1.0.0",
      canonical_invocation: CANONICAL_VIBEPRO_LAUNCHER,
      expected_version: EXPECTED_VIBEPRO_VERSION,
      expected_source_commit: EXPECTED_VIBEPRO_SOURCE_COMMIT,
      runtime_identity: runtimeIdentity,
    })}\n`);
    return;
  }
  if (command === "pr-prepare") {
    const { identity, result } = prepareWithCanonicalRuntime(cwd, base);
    process.stdout.write(`${JSON.stringify({
      schema_version: "1.0.0",
      canonical_invocation: CANONICAL_VIBEPRO_LAUNCHER,
      runtime_identity: identity,
      pr_prepare: result,
    })}\n`);
    return;
  }
  throw new Error("usage: vibepro-runtime-contract.mjs <identity|pr-prepare|pr-create|push-target> [--cwd <repo>] [--base <ref>] [--repo <owner/name>] [--push-url <url>]");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`[vibepro-runtime-contract] ${error.message}\n`);
    process.exit(1);
  });
}
