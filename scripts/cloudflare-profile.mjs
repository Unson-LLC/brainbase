#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const PROFILE_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const FORBIDDEN_PROFILE_KEYS = new Set([
  "apiToken",
  "apiKey",
  "email",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_EMAIL",
]);
const AUTH_ENV_KEYS = [
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_API_KEY",
  "CLOUDFLARE_EMAIL",
  "CF_API_TOKEN",
  "CF_API_KEY",
  "CF_API_EMAIL",
];

function usage() {
  return `Usage:
  cloudflare-profile <alias> login
  cloudflare-profile <alias> doctor [--config <path>]
  cloudflare-profile <alias> -- <wrangler arguments...>

Profiles: ~/.brainbase/cloudflare/profiles/<alias>.json
Override directory with BRAINBASE_CLOUDFLARE_PROFILE_DIR.`;
}

function fail(message) {
  console.error(`cloudflare-profile: ${message}`);
  process.exitCode = 1;
}

function profilePath(alias) {
  const directory = process.env.BRAINBASE_CLOUDFLARE_PROFILE_DIR
    ? resolve(process.env.BRAINBASE_CLOUDFLARE_PROFILE_DIR)
    : join(homedir(), ".brainbase", "cloudflare", "profiles");
  return join(directory, `${alias}.json`);
}

async function loadProfile(alias) {
  if (!PROFILE_NAME.test(alias)) {
    throw new Error(`invalid profile alias: ${alias ?? "(missing)"}`);
  }

  const path = profilePath(alias);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`profile not found: ${path}`);
    }
    throw new Error(`cannot read profile ${path}: ${error.message}`);
  }

  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`profile must be a JSON object: ${path}`);
  }
  for (const key of Object.keys(parsed)) {
    if (FORBIDDEN_PROFILE_KEYS.has(key)) {
      throw new Error(`credentials are not allowed in profile files (${key})`);
    }
  }
  if (!PROFILE_NAME.test(parsed.wranglerProfile ?? "")) {
    throw new Error("wranglerProfile is required and must be a safe profile name");
  }
  if (typeof parsed.accountId !== "string" || !/^[a-f0-9]{32}$/i.test(parsed.accountId)) {
    throw new Error("accountId is required and must be a 32-character Cloudflare Account ID");
  }
  if (parsed.wranglerBin !== undefined && typeof parsed.wranglerBin !== "string") {
    throw new Error("wranglerBin must be a string when provided");
  }

  return { ...parsed, path };
}

function configFromArgs(args) {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--config" || value === "-c") {
      if (!args[index + 1]) throw new Error(`${value} requires a path`);
      return args[index + 1];
    }
    if (value.startsWith("--config=")) return value.slice("--config=".length);
  }
  return undefined;
}

async function defaultConfig() {
  for (const name of ["wrangler.jsonc", "wrangler.json", "wrangler.toml"]) {
    const candidate = resolve(name);
    try {
      await access(candidate, constants.R_OK);
      return candidate;
    } catch {
      // Try the next conventional name.
    }
  }
  return undefined;
}

function declaredAccountIds(source) {
  const ids = new Set();
  const patterns = [
    /(?:^|\n)\s*account_id\s*=\s*["']([a-f0-9]{32})["']/gi,
    /["']account_id["']\s*:\s*["']([a-f0-9]{32})["']/gi,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) ids.add(match[1].toLowerCase());
  }
  return [...ids];
}

async function validateConfig(profile, requestedPath) {
  const path = requestedPath ? resolve(requestedPath) : await defaultConfig();
  if (!path) return undefined;

  let source;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`cannot read Wrangler config ${path}: ${error.message}`);
  }
  const expected = profile.accountId.toLowerCase();
  const declared = declaredAccountIds(source);
  if (/\baccount_id\b/i.test(source) && declared.length === 0) {
    throw new Error(`cannot verify account_id in ${basename(path)}; use a quoted literal Account ID`);
  }
  const mismatches = declared.filter((id) => id !== expected);
  if (mismatches.length > 0) {
    throw new Error(
      `account mismatch: ${basename(path)} declares an account other than profile '${profile.wranglerProfile}'`,
    );
  }
  return path;
}

function safeEnvironment(profile) {
  const environment = { ...process.env, CLOUDFLARE_ACCOUNT_ID: profile.accountId };
  for (const key of AUTH_ENV_KEYS) delete environment[key];
  return environment;
}

function wranglerBinary(profile) {
  return profile.wranglerBin || process.env.BRAINBASE_WRANGLER_BIN || "wrangler";
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: options.env,
      stdio: options.capture ? ["inherit", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (options.capture) {
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    child.on("error", reject);
    child.on("close", (code, signal) => resolvePromise({ code, signal, stdout, stderr }));
  });
}

async function runWrangler(profile, args, options = {}) {
  const result = await run(wranglerBinary(profile), args, {
    ...options,
    env: safeEnvironment(profile),
  });
  if (result.signal) throw new Error(`Wrangler terminated by signal ${result.signal}`);
  return result;
}

async function main() {
  const [alias, action, ...rest] = process.argv.slice(2);
  if (!alias || !action || ["-h", "--help", "help"].includes(alias)) {
    console.log(usage());
    return;
  }

  const profile = await loadProfile(alias);
  if (action === "login") {
    if (rest.length > 0) throw new Error("login does not accept additional arguments");
    const result = await runWrangler(profile, ["auth", "create", profile.wranglerProfile]);
    if (result.code !== 0) throw new Error(`Wrangler login failed with exit code ${result.code}`);
    return;
  }

  if (action === "doctor") {
    const config = await validateConfig(profile, configFromArgs(rest));
    const result = await runWrangler(
      profile,
      ["--profile", profile.wranglerProfile, "whoami"],
      { capture: true },
    );
    if (result.code !== 0) throw new Error("Wrangler named authentication is unavailable");
    if (!result.stdout.toLowerCase().includes(profile.accountId.toLowerCase())) {
      throw new Error("authenticated profile cannot see the expected Cloudflare account");
    }
    console.log(`profile: ${alias}`);
    console.log(`wrangler profile: ${profile.wranglerProfile}`);
    console.log(`account: ...${profile.accountId.slice(-6)}`);
    console.log(`config: ${config ?? "none (account selected by environment)"}`);
    console.log("authentication: available");
    return;
  }

  if (action !== "--") throw new Error(`unknown action: ${action}\n${usage()}`);
  if (rest.length === 0) throw new Error("Wrangler arguments are required after --");
  if (rest.some((value) => value === "--profile" || value.startsWith("--profile="))) {
    throw new Error("do not pass --profile; the wrapper owns profile selection");
  }
  await validateConfig(profile, configFromArgs(rest));
  const result = await runWrangler(profile, ["--profile", profile.wranglerProfile, ...rest]);
  if (result.code !== 0) process.exitCode = result.code;
}

main().catch((error) => fail(error.message));
