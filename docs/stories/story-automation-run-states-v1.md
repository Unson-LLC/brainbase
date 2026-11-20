---
story_id: story-automation-run-states-v1
title: 自動実行の記録がどの段階からどの段階へ進むかを1か所で読めて、コードとずれたら止まる
status: active
created_at: 2026-11-20
implementation_started: true
owner_repository: brainbase
depends_on: []
---

# 自動実行の記録がどの段階からどの段階へ進むかを1か所で読めて、コードとずれたら止まる

## 利用者成果

`AutomationRunService`（`@unson/brainbase-mcp/automation-run`）を組み込む開発者とエージェントが、runStore の記録がどの呼び出しでどの段階へ進むか、どの失敗でどこに止まるかを1枚の図で読める。runStore を自分で実装するときに、守るべき遷移がSpecに書いてある。図とコードが食い違ったらテストが落ちる。

## 背景

自動実行の状態はコアに保存されず、利用側の runStore と lifecycle の2つのportに書かれる。段階の語彙は3つ（`AutomationRunPhase`、runStore の `status`、host の lifecycle phase）あるが、対応するSpecもStoryも無かった。2026-11-20の点検で、型にある `retryable` へはどの経路からも進まないこと、runner を呼ぶ前の checkpoint の失敗でも `uncertain` になることが分かった。

## 受入条件

- AC-01: Spec `automation-run-states-v1` が、runStore の記録の遷移を呼び出しごとに図で示す。
- AC-02: 実際の runStore（テストの memoryRunStore）で、成功と各段階の失敗を通したときに記録が動いた遷移の集合が、Specの図を展開した集合と両方向で一致する。
- AC-03: Specが、変更前は `retryable` に到達せず、checkpoint の失敗でも `uncertain` になっていたことを変更の記録として残す。
- AC-04: AC-05 の他は、コードの振る舞い、エラーのコードと文言、port の型は変わらない。
- AC-05: runner を呼ぶ前の `lifecycle.checkpoint` の失敗は `retryable` で release し、次の `start` は runner を1回だけ呼ぶ。`markRunnerStarted` 以降の失敗は今どおり `uncertain`。投げるエラーはそのまま。

## 対象外

遷移表と単一の書き込み関数の導入（状態はコアに無く、利用側の runStore が書くため）。組織版への移設。

## 検証

`tests/stage3c-runtime.test.ts` で、記録の読み直しを挟む runStore の包みを使って各シナリオを通し、観測した遷移の集合と図を照合する。図から1本消すとテストが落ちることを確かめる。
