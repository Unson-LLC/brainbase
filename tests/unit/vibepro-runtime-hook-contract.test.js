import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_VIBEPRO_SOURCE_COMMIT,
  EXPECTED_VIBEPRO_VERSION,
  prepareWithCanonicalRuntime,
  queryCanonicalIdentity,
  sanitizeHookEnvironment,
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
  it("pins the currently published canonical runtime identity", () => {
    expect(EXPECTED_VIBEPRO_VERSION).toBe("0.2.0-beta.18");
    expect(EXPECTED_VIBEPRO_SOURCE_COMMIT)
      .toBe("2ff03db8045bceee47d3dad3da10695103ce91a1");
  });

  it("accepts only the pinned immutable npm identity", () => {
    expect(validateRuntimeIdentity(trustedIdentity()).identity_digest).toBe("a".repeat(64));
  });

  it("rejects the superseded beta.5 runtime identity", () => {
    expect(() => validateRuntimeIdentity(trustedIdentity({
      package: { exact_version: "0.2.0-beta.5" },
      source_git: {
        commit: "5e19da4a890a6ae607241d40bbbb438dae6f5124",
        dirty: false,
        origin_main_relation: "published",
      },
    }))).toThrow(/runtime_mismatch/);
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

  it("does not leak Git hook repository selectors into the canonical runtime", () => {
    expect(sanitizeHookEnvironment({
      PATH: "/usr/bin",
      GIT_DIR: ".git",
      GIT_WORK_TREE: "/tmp/caller",
      GIT_INDEX_FILE: "/tmp/caller-index",
    })).toEqual({ PATH: "/usr/bin" });

    let childOptions;
    const runner = (_launcher, _args, options) => {
      childOptions = options;
      return { status: 0, stdout: JSON.stringify(trustedIdentity()), stderr: "" };
    };
    queryCanonicalIdentity(process.cwd(), runner);
    expect(Object.keys(childOptions.env).some((name) => name.startsWith("GIT_"))).toBe(false);
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
