import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const expectedIds = [
  "story-brainbase-outcome-foundation-context",
  "story-brainbase-outcome-knowledge-discovery",
  "story-brainbase-outcome-knowledge-capture",
  "story-brainbase-outcome-knowledge-canonical-save",
  "story-brainbase-outcome-knowledge-lifecycle",
  "story-brainbase-outcome-knowledge-codex-use",
  "story-brainbase-outcome-knowledge-preview",
  "story-brainbase-outcome-mana-contract",
  "story-brainbase-outcome-mana-authority",
  "story-brainbase-outcome-mana-triggers",
  "story-brainbase-outcome-mana-deliver-outcome",
  "story-brainbase-outcome-mana-safe-test",
  "story-brainbase-outcome-mana-run-control"
];

const manifest = JSON.parse(await readFile(new URL("../../docs/management/outcome-13-evidence.json", import.meta.url), "utf8"));
const config = JSON.parse(await readFile(new URL("../../.vibepro/config.json", import.meta.url), "utf8"));
const knowledgeUi = JSON.parse(await readFile(new URL("../../.vibepro/artifacts/outcome-13/ui-knowledge-27925c6.json", import.meta.url), "utf8"));
const manaTap = await readFile(new URL("../../.vibepro/artifacts/outcome-13/ui-mana-27925c6.tap", import.meta.url), "utf8");

test("13 Storyを一意に証跡へ対応付ける", () => {
  assert.deepEqual(manifest.stories.map(({ id }) => id), expectedIds);
  assert.equal(new Set(manifest.stories.map(({ id }) => id)).size, 13);
  const configured = new Set((config.brainbase?.stories ?? []).map(({ story_id }) => story_id));
  for (const id of expectedIds) assert.ok(configured.has(id), `${id} is registered`);
  for (const story of manifest.stories) for (const key of story.evidence) assert.ok(manifest.evidence[key], `${story.id}: ${key}`);
});

test("UIの対象テスト成果物を読み戻す", () => {
  assert.equal(knowledgeUi.numPassedTests, 69);
  assert.equal(knowledgeUi.numFailedTests, 0);
  assert.match(manaTap, /# tests 34/);
  assert.match(manaTap, /# fail 0/);
});

test("3リポジトリのマージ済み実装と検証件数を固定する", () => {
  for (const key of ["foundation", "knowledge-backend", "mana-runtime", "mana-e2e"]) {
    const item = manifest.evidence[key];
    assert.equal(item.state, "MERGED");
    assert.match(item.mergeCommit, /^[0-9a-f]{40}$/);
  }
  assert.equal(manifest.evidence.foundation.passed, 47);
  assert.equal(manifest.evidence["knowledge-backend"].integrationPassed, 68);
  assert.equal(manifest.evidence["knowledge-backend"].mcpPassed, 362);
  assert.equal(manifest.evidence["mana-runtime"].fullSuitePassed, 2405);
  assert.equal(manifest.evidence["mana-e2e"].targetPassed, 3);
});

test("本番外部作用を未実施として保持する", () => {
  assert.deepEqual(manifest.limits, [
    "no production deployment",
    "no third-party send",
    "no production Google Drive, GitHub, or Slack write"
  ]);
});
