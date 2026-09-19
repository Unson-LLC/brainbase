import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: [
    "story-codex-appserver-session-create-contract.spec.ts",
    "story-inline-session-creation-pr-gate.spec.ts",
    "story-nocodb-task-start-retirement.spec.js",
  ],
  outputDir: "../../var/test-results/project-provisioning",
  workers: 1,
  reporter: [["list"]],
  // Remaining contracts inspect historical documents and retired boundaries only.
  // They do not mount the removed browser runtime or need a static test server.
});
