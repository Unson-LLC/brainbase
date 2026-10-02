---
story_id: story-ux-20261001-06-source-navigation
title: 判断の根拠から確認済みのGraph記録へ移る
status: proposed
created_at: 2026-10-01
owner_repository: brainbase
depends_on: ["story-personal-value-proof-review-web-v1", "story-local-web-graph-screens-v1"]
issue: "#630"
inspector_finding: UX-20261001-06
---

# 判断の根拠から確認済みのGraph記録へ移る

## 利用者成果

判断の見返し画面で、判断に使った根拠の対象が実際に手元のGraphから読めるときだけ、その対象を開ける。利用者は画面に作られた架空のURLを信じず、同じID・種類・版（記録されている場合）の対象を確認できる。

## 現状と境界

- InspectorのUX-20261001-06は、根拠の対象IDだけでなく元情報へ移動できることを求めている。
- 今回の元記録には`basis.source`がなく、実データに出典があるとは確認できない。元journalへ出典を補うこと、架空の出典を追加することはしない。
- 実装と回帰テストのsource-bearing例は、`tests/ui/ux06-source-fixture.mjs`の架空Graph記録だけで検証する。
- 出典がない実記録は、これまでどおり対象ID・版だけを表示し、リンクを作らない。

## 受入条件

- [ ] AC-01: `basis.source`がない、または契約不正の根拠は、対象ID・版を表示するがリンクを作らない。
- [ ] AC-02: `basis.source.kind=local_graph`、`entity_id`、`entity_type`が根拠対象と一致し、host-owned readerが同じGraph記録を読み戻したときだけ「出典を開く」を表示する。
- [ ] AC-03: 出典リンクは任意URLを受け取らず、同一オリジンの`#graph?entity_id=<encoded-id>`だけを使う。Graph画面は遷移後に対象を選択して詳細を表示する。
- [ ] AC-04: 対象の404・同一ID複数候補・認可不可・通信失敗・種類/ダイジェスト/版の不一致はリンクを出さず、それぞれ「未確認」と理由を表示する。
- [ ] AC-05: source descriptorのない元journal、既存のjournal内容、未確認状態を成功扱いに変えない。
- [ ] AC-06: 架空fixtureで、出典ありの遷移と、出典なし・404・重複・権限不可・通信失敗の回帰テストを同じPRに持つ。
- [ ] AC-07: 架空の一時`data_dir`/`journalRoot`で起動したPersonal WebのHTTP/UI回帰テストで、Graph読戻しのID・種類・digest（出典に版がある場合は版も）が一致した出典だけ、同一Originの`#graph?entity_id=<encoded-id>`リンクを表示し、既存Graph画面の対象詳細へ渡す。
- [ ] AC-08: 同じ回帰テストで、出典なし・404・重複・権限不足・通信失敗・版不一致・digest不一致はそれぞれリンクを表示しないことを確認する。
- [ ] AC-09: URL形式の出典は受け付けず、外部URL・任意path・別Originへのリンクを生成しないことを確認する。

## 人間判断待ち

このStoryはIssue #630の推奨契約を具体化した候補であり、`basis.source`というpayload契約とhost-owned readerを追加するため、アーキテクチャ変更に該当する。PRは候補のレビューとCIまで進めるが、採用判断が返るまでマージしない。

選択肢は次のとおり。

1. **A（このPRの候補）**: `local_graph`を型付きdescriptorとして保存し、hostだけがGraph readbackを行う。出典が読めた場合だけ同一オリジンのGraph routeへ遷移する。
2. **B（将来拡張）**: providerを抽象化し、Graph以外の正本を追加する。provider登録、認可、版照合、UI表示の設計が増えるため、今回のUX-06には広げない。

## 検証

TypeScriptのvalue-proof validator、簡易DOMのvalue-proof UI、local Web shellのGraph deep-linkと失敗状態を検証する。`node tests/ui/ux06-source-fixture-server.mjs --duration 900 --port 31986`で架空データだけの期限付きWebを起動すれば、Inspectorは`http://127.0.0.1:31986/#today`から同じP1×S1の「出典を開く」→Graph対象表示を実際に確認できる。実journalのsource-bearing結果とInspectorの同一ペルソナによる再確認は、元記録に出典がないため未確認として別途残す。
