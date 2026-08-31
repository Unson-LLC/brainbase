#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const EXPECTED_VIBEPRO_VERSION = "0.2.0-beta.17";
export const EXPECTED_VIBEPRO_SOURCE_COMMIT = "1c3bebb6824d79c8e49ef66c9271c61c35c7cd29";
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

function invokeVibePro(args, cwd, runner = spawnSync) {
  const result = runner(CANONICAL_VIBEPRO_LAUNCHER, args, {
    cwd,
    env: sanitizeHookEnvironment(),
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
  throw new Error("usage: vibepro-runtime-contract.mjs <identity|pr-prepare> [--cwd <repo>] [--base <ref>]");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`[vibepro-runtime-contract] ${error.message}\n`);
    process.exit(1);
  });
}
