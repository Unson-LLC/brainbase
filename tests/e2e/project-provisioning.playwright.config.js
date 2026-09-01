import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const port = Number(process.env.BRAINBASE_E2E_PORT || 31991);
const baseURL = process.env.BRAINBASE_BASE_URL || `http://127.0.0.1:${port}`;
const publicDir = fileURLToPath(new URL("../../public", import.meta.url));

export default defineConfig({
  testDir: ".",
  testMatch: [
    "story-codex-appserver-session-create-contract.spec.ts",
    "story-project-runtime-catalog-ux.spec.js",
    "story-inline-session-creation-pr-gate.spec.ts",
    "story-nocodb-task-start-retirement.spec.js",
  ],
  outputDir: "../../var/test-results/project-provisioning",
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL,
    channel: "chrome",
    headless: true,
  },
  webServer: {
    command: `python3 -m http.server ${port} --bind 127.0.0.1 --directory ${JSON.stringify(publicDir)}`,
    url: `${baseURL}/modules/project-mapping.js`,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
