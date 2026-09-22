import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = resolve("scripts/cloudflare-profile.mjs");
const accountId = "11111111111111111111111111111111";

async function fixture(options: { whoamiAccount?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "cloudflare-profile-"));
  const profiles = join(root, "profiles");
  const calls = join(root, "calls.jsonl");
  const wrangler = join(root, "fake-wrangler.mjs");
  await mkdir(profiles);
  await writeFile(
    join(profiles, "unson.json"),
    JSON.stringify({ wranglerProfile: "unson", accountId, wranglerBin: wrangler }),
  );
  await writeFile(
    wrangler,
    `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args: process.argv.slice(2), env: {
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  token: process.env.CLOUDFLARE_API_TOKEN ?? null
} }) + "\\n");
if (process.argv.includes("whoami")) console.log("account ${options.whoamiAccount ?? accountId}");
`,
  );
  await chmod(wrangler, 0o755);
  return { root, profiles, calls };
}

function invoke(profiles: string, args: string[], extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: profiles,
    encoding: "utf8",
    env: {
      ...process.env,
      BRAINBASE_CLOUDFLARE_PROFILE_DIR: profiles,
      ...extraEnv,
    },
  });
}

describe("cloudflare-profile", () => {
  it("passes the selected native profile and account while removing inherited tokens", async () => {
    const context = await fixture();
    const result = invoke(
      context.profiles,
      ["unson", "--", "deployments", "list"],
      { CLOUDFLARE_API_TOKEN: "must-not-leak" },
    );

    expect(result.status).toBe(0);
    const call = JSON.parse((await readFile(context.calls, "utf8")).trim());
    expect(call.args).toEqual(["--profile", "unson", "deployments", "list"]);
    expect(call.env).toEqual({ accountId, token: null });
  });

  it("rejects a conflicting account before Wrangler starts", async () => {
    const context = await fixture();
    const config = join(context.root, "wrangler.toml");
    await writeFile(config, `account_id = "22222222222222222222222222222222"\n`);

    const result = invoke(context.profiles, ["unson", "--", "deploy", "--config", config]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("account mismatch");
    await expect(readFile(context.calls, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an account declaration it cannot verify", async () => {
    const context = await fixture();
    const config = join(context.root, "wrangler.toml");
    await writeFile(config, `account_id = env.CLOUDFLARE_ACCOUNT_ID\n`);

    const result = invoke(context.profiles, ["unson", "--", "deploy", "--config", config]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot verify account_id");
    await expect(readFile(context.calls, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("runs named-profile login without writing credentials to the profile", async () => {
    const context = await fixture();
    const result = invoke(context.profiles, ["unson", "login"]);

    expect(result.status).toBe(0);
    const call = JSON.parse((await readFile(context.calls, "utf8")).trim());
    expect(call.args).toEqual(["auth", "create", "unson"]);
  });

  it("doctor verifies that the authenticated profile can see the expected account", async () => {
    const context = await fixture();
    const result = invoke(context.profiles, ["unson", "doctor"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("authentication: available");
    expect(result.stdout).toContain("account: ...111111");
    expect(result.stdout).not.toContain(accountId);
  });

  it("doctor fails when named authentication cannot see the expected account", async () => {
    const context = await fixture({ whoamiAccount: "33333333333333333333333333333333" });
    const result = invoke(context.profiles, ["unson", "doctor"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("cannot see the expected Cloudflare account");
  });

  it("rejects credential fields in a local profile", async () => {
    const context = await fixture();
    await writeFile(
      join(context.profiles, "unson.json"),
      JSON.stringify({
        wranglerProfile: "unson",
        accountId,
        apiToken: "do-not-store-this",
      }),
    );

    const result = invoke(context.profiles, ["unson", "doctor"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("credentials are not allowed");
    expect(result.stderr).not.toContain("do-not-store-this");
  });

  it("rejects an attempt to override the wrapper-owned profile", async () => {
    const context = await fixture();
    const result = invoke(context.profiles, ["unson", "--", "whoami", "--profile", "other"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("wrapper owns profile selection");
  });
});
