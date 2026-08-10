import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_VIBEPRO_SOURCE_COMMIT,
  EXPECTED_VIBEPRO_VERSION,
  prepareWithCanonicalRuntime,
  validateRuntimeIdentity,
} from "../../.claude/scripts/hooks/lib/vibepro-runtime-contract.mjs";

function trustedIdentity(overrides = {}) {
  return {
    source_kind: "npm_package",
    package: { exact_version: EXPECTED_VIBEPRO_VERSION },
    release_manifest: { status: "valid" },
    source_git: {
      commit: EXPECTED_VIBEPRO_SOURCE_COMMIT,
      dirty: false,
      origin_main_relation: "published",
    },
    integrity: { status: "trusted" },
    identity_digest: "a".repeat(64),
    ...overrides,
  };
}

describe("VibePro canonical runtime hook contract", () => {
  it("accepts only the pinned immutable npm identity", () => {
    expect(validateRuntimeIdentity(trustedIdentity()).identity_digest).toBe("a".repeat(64));
  });

  it("rejects a behind and dirty Git development checkout", () => {
    expect(() => validateRuntimeIdentity(trustedIdentity({
      source_kind: "git_checkout",
      source_git: {
        commit: "37418424323eb8574168ca026f40d7dde93004d5",
        dirty: true,
        origin_main_relation: "behind",
      },
      integrity: { status: "blocked" },
    }))).toThrow(/runtime_mismatch/);
  });

  it("rejects a pr prepare result created by a different runtime identity", () => {
    const preflight = trustedIdentity();
    const prepared = trustedIdentity({ identity_digest: "b".repeat(64) });
    const runner = (_launcher, args) => ({
      status: 0,
      stdout: JSON.stringify(args[0] === "runtime"
        ? preflight
        : { runtime_identity: prepared }),
      stderr: "",
    });
    expect(() => prepareWithCanonicalRuntime(process.cwd(), "origin/develop", runner))
      .toThrow(/identity digest differs/);
  });

  it("wires both push hooks through the shared validator without the old source checkout", async () => {
    const root = process.cwd();
    const [shellHook, claudeHook] = await Promise.all([
      readFile(path.join(root, ".husky/pre-push"), "utf8"),
      readFile(path.join(root, ".claude/scripts/hooks/pre-tool-use/git-push-gate.ts"), "utf8"),
    ]);
    for (const hook of [shellHook, claudeHook]) {
      expect(hook).toContain("vibepro-runtime-contract.mjs");
      expect(hook).not.toContain("/Users/ksato/workspace/code/vibepro/bin/vibepro.js");
      expect(hook).not.toContain("gate_dag");
    }
  });
});
