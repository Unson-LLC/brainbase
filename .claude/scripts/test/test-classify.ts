#!/usr/bin/env npx tsx

/**
 * classify.ts のフィクスチャテスト。
 *
 * 過去の監査で誤判定された実プロンプトを fixture 化し、TDD で回帰防止する。
 * fixture を増やす時はここに 1行追加、対応する分類ロジックを classify.ts に追記。
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import { classifyTopic } from "../audit/classify.js";

interface Case {
  label: string;
  prompt: string;
  expectGraph: boolean;
  expectCapmap: boolean;
  expectKg: boolean;
  expectExcluded: string | null;
}

const TRUE_POSITIVE: Case[] = [
  {
    label: "graph + capmap: nocodb タスク委譲 (顧客名 + brainbase 言及)",
    prompt:
      "以下のタスクを対応してください。 ID: nocodb:brainbase:276 プロジェクト: brainbase タイトル: ユニバーサルアーツ杉山PCにリモートアクセスして業務フロー分析",
    expectGraph: true, // 顧客名 ユニバーサルアーツ
    expectCapmap: true, // "brainbase" がプロジェクト名として登場 (multi-topic 許容)
    expectKg: false,
    expectExcluded: null,
  },
  {
    label: "graph: 人物名 + さん",
    prompt: "安部潔仁さんとのMTG準備して",
    expectGraph: true,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: null,
  },
  {
    label: "graph: 案件キーワード",
    prompt: "今期の決裁ルートを整理してくれる?",
    expectGraph: true,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: null,
  },
  {
    label: "capmap: session 作成系",
    prompt: "session作成できないんだけど",
    expectGraph: false,
    expectCapmap: true,
    expectKg: false,
    expectExcluded: null,
  },
  {
    label: "capmap: xterm/terminal",
    prompt: "xtermの描画バグを直して",
    expectGraph: false,
    expectCapmap: true,
    expectKg: false,
    expectExcluded: null,
  },
  {
    label: "kg: /oyasumi",
    prompt: "/oyasumi 2026-05-21",
    expectGraph: false,
    expectCapmap: false,
    expectKg: true,
    expectExcluded: null,
  },
  {
    label: "kg + graph: personal_kg + 議事録 (両 topic 該当)",
    prompt: "個人KG への昨日の議事録の反映状況を確認",
    expectGraph: true, // "議事録" は graph トリガーキーワードでもある (multi-topic 許容)
    expectCapmap: false,
    expectKg: true,
    expectExcluded: null,
  },
  {
    label: "graph + capmap: 正本所在 (案件 + brainbase 運用に触れる)",
    prompt:
      "brainbase運用において「既存営業案件」と「伴走型コンサルメニュー」の正本所在を特定してください。ユーザー(佐藤圭吾)はSalesTailorの代表でもあり",
    expectGraph: true, // 案件/正本所在/SalesTailor
    expectCapmap: true, // "brainbase運用" は capmap トリガー (multi-topic 許容)
    expectKg: false,
    expectExcluded: null,
  },
  {
    label: "graph + capmap (mixed): 大和田さん + Slack 3WS",
    prompt:
      "brainbase Graph SSOT（https://bb.unson.jp）と Slack 3ワークスペース（unson / salestailor / techknight）で「大和田」さんを特定してください",
    expectGraph: true,
    expectCapmap: true,
    expectKg: false,
    expectExcluded: null,
  },
  {
    label: "capmap: brainbase の機能質問",
    prompt: "brainbaseで何ができるか教えて",
    expectGraph: false,
    expectCapmap: true,
    expectKg: false,
    expectExcluded: null,
  },
];

const TRUE_NEGATIVE: Case[] = [
  {
    label: "純技術: react component",
    prompt: "このreact componentをリファクタして",
    expectGraph: false,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: null,
  },
  {
    label: "純技術: npm test",
    prompt: "npm test failed の調査",
    expectGraph: false,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: null,
  },
  {
    label: "純技術: 型修正",
    prompt: "TypeScript の type 修正",
    expectGraph: false,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: null,
  },
  {
    label: "純技術: build error",
    prompt: "build errorが発生してる",
    expectGraph: false,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: null,
  },
  {
    label: "純技術: GitHub Actions",
    prompt: "GitHub Actions yamlを書いて",
    expectGraph: false,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: null,
  },
];

const EXCLUDED: Case[] = [
  {
    label: "excluded: VibePro review task (worktree pattern)",
    prompt:
      "VibePro review task. Worktree: /Volumes/UNSON-DRIVE/brainbase-worktrees/session-1779016058396-g1-salestailor-app. Do not edit files. Read `.vibepro/...",
    expectGraph: false,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: "vibepro-reviewer",
  },
  {
    label: "excluded: VibePro review task (repo pattern)",
    prompt:
      "VibePro review task. Work in /Users/ksato/workspace/code/brainbase. Read .vibepro/reviews/story-terminal-input-render-stability/planning_spec/...",
    expectGraph: false,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: "vibepro-reviewer",
  },
  {
    label: "excluded: 'You are performing' VibePro reviewer",
    prompt:
      "You are performing the final VibePro required parallel review after fixes and regenerated PR artifacts. Repo: /Users/ksato/workspace/code/brainbase.",
    expectGraph: false,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: "vibepro-reviewer",
  },
  {
    label: "excluded: 監査タスク自身 (meta)",
    prompt:
      "Graph SSOT / Capability Map / 個人KG の日次利用監査を実行する。\n\n対象: 直近24時間の Claude Code (~/.claude/projects/...",
    expectGraph: false,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: "audit-meta",
  },
  {
    label: "excluded: 監査タスク (代替表現)",
    prompt:
      "brainbaseユーザーの Graph SSOT / Capability Map / 個人KG 利用状況を直近24時間で監査するレポートを作成してほしい。",
    expectGraph: false,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: "audit-meta",
  },
  {
    label: "excluded: VibePro reviewer (You are reviewing STR-...)",
    prompt:
      "You are reviewing STR-059 in /Volumes/UNSON-DRIVE/brainbase-worktrees/session-1778557049137-salestailor-app. Do not edit files. Read .vibepro/reviews/STR-059/preview/review-request-preview_smoke.md",
    expectGraph: false,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: "vibepro-reviewer",
  },
  {
    label: "excluded: 学び抽出 agent (transcript → 再発防止)",
    prompt:
      "あなたはこのトランスクリプトから「将来のセッションで再発防止・再利用に値する学び」だけを抽出するアナリストです。",
    expectGraph: false,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: "learning-extractor",
  },
  // v6: 2026-05-24 監査で発見された未除外 reviewer prefix を fixture 追加 (9種)
  {
    label: "excluded v6: Read-only VibePro Agent Review.",
    prompt:
      "Read-only VibePro Agent Review. Do not edit files. Workdir: /Volumes/UNSON-DRIVE/brainbase-worktrees/session-XXX. Story: STR-099.",
    expectGraph: false,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: "vibepro-reviewer",
  },
  {
    label: "excluded v6: Read-only VibePro agent review (lowercase)",
    prompt:
      "Read-only VibePro agent review. Repo: /Users/ksato/workspace/code/brainbase. Stage: planning_spec.",
    expectGraph: false,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: "vibepro-reviewer",
  },
  {
    label: "excluded v6: VibePro required agent review.",
    prompt:
      "VibePro required agent review. Worktree: /tmp/brainbase-terminal-stable.",
    expectGraph: false,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: "vibepro-reviewer",
  },
  {
    label: "excluded v6: VibePro parallel review.",
    prompt:
      "VibePro parallel review. Worktree: /tmp/brainbase-terminal-state.",
    expectGraph: false,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: "vibepro-reviewer",
  },
  {
    label: "excluded v6: VibePro Agent Review for Brainbase.",
    prompt:
      "VibePro Agent Review for Brainbase. Worktree: /tmp/brainbase-XXX.",
    expectGraph: false,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: "vibepro-reviewer",
  },
  {
    label: "excluded v6: VibePro gate review for...",
    prompt:
      "VibePro gate review for STR-099 in /tmp/brainbase. Read .vibepro/reviews/STR-099/...",
    expectGraph: false,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: "vibepro-reviewer",
  },
  {
    label: "excluded v6: Aitle repo review task for VibePro story",
    prompt:
      "Aitle repo review task for VibePro story story-ai-search-llm. Do not edit files.",
    expectGraph: false,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: "vibepro-reviewer",
  },
  {
    label: "excluded v6: Read `.vibepro/reviews/<...>",
    prompt:
      "Read `.vibepro/reviews/oyasumi-conversation-personal-kg/gate.md` and produce a verdict.",
    expectGraph: false,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: "vibepro-reviewer",
  },
  {
    label: "excluded v6: In <path>, read .vibepro/reviews/",
    prompt:
      "In /Users/ksato/workspace/code/brainbase, read .vibepro/reviews/story-foo/...",
    expectGraph: false,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: "vibepro-reviewer",
  },
  {
    label: "excluded v6: Worktree: ... Review role",
    prompt:
      "Worktree: /tmp/brainbase-live-feed-stable-order. Review role: architect. Do not edit files.",
    expectGraph: false,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: "vibepro-reviewer",
  },
  // v6 陰性: 「途中で VibePro と言及するだけの legit meta prompt」は除外しない
  // (CAPMAP_KEYWORDS_RE に "VibePro" は無いので capmap も false。anchor ^ 担保)
  {
    label: "v6 not excluded: VibePro に関する meta question (途中言及)",
    prompt:
      "直近でさまざまな開発をVibeProを使って行なっているが、実際にその結果をきちんと確認してVibeProのプロダクトとしての価値を出せているか不安",
    expectGraph: false,
    expectCapmap: false,
    expectKg: false,
    expectExcluded: null, // anchor ^ で除外されないことを担保 (途中言及)
  },
  {
    label: "v6 not excluded: VibePro installation status question",
    prompt: "VibePro はすでに SalesTailor に入ってるんだっけ?",
    expectGraph: true, // SalesTailor 顧客名
    expectCapmap: false, // CAPMAP_KEYWORDS_RE には VibePro 無し
    expectKg: false,
    expectExcluded: null, // "VibePro\s+" の後に「は」(non-space) なので reviewer regex に hit しない
  },
];

function runCases(label: string, cases: Case[]): void {
  describe(label, () => {
    for (const c of cases) {
      it(c.label, () => {
        const r = classifyTopic(c.prompt);
        assert.strictEqual(r.graph, c.expectGraph, `graph for ${c.label}`);
        assert.strictEqual(r.capmap, c.expectCapmap, `capmap for ${c.label}`);
        assert.strictEqual(r.kg, c.expectKg, `kg for ${c.label}`);
        if (c.expectExcluded === null) {
          assert.strictEqual(r.excluded, null, `excluded for ${c.label}`);
        } else {
          assert.strictEqual(r.excluded, c.expectExcluded, `excluded for ${c.label}`);
        }
      });
    }
  });
}

runCases("true positive", TRUE_POSITIVE);
runCases("true negative", TRUE_NEGATIVE);
runCases("excluded (false positive)", EXCLUDED);
