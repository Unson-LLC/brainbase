---
name: brainbase-judgment-resolver
description: Brainbase管理対象turnのHost指示とTurnContractに従って、判断・参照・完了証拠を扱うときに使う。
---

# Brainbase Judgment Resolver

## 目的と正本

一つのturnの意味判断、必要な参照、実行証拠、完了状態を取り違えずに扱う。現在のHost bootstrapと返されたTurnContractを優先し、Skillに記した過去のruntime仕様で上書きしない。

実装・障害調査で必要なときだけ、次を参照する。

- [Capability](../../../docs/brainbase-capabilities/capabilities/judgment.resolve.yml)
- [Runbook](../../../docs/brainbase-capabilities/runbooks/judgment-resolve.md)
- [Runtime manifest](../../../config/judgment-runtime-manifest.json)

## turnの開始と参照

- Hostの未解決episodeは意味分類でも完了receiptでもない。Hostが要求する最初の呼出しで、`brainbase_resolve_turn`へ発行済み`turn_ref`とモデル自身の意味解釈を渡す。
- 入力は原則 `{ turn_ref, model_interpretation }`。解釈のキーは`intent`、`domains`、`action_kind`、`risk`、`confidence`、`signals`だけ。canonical inputを読み出し・再構成して送らない。移行互換の入力は現行Hostが明示した場合だけ使う。
- 返された契約を保持する。keyword未一致を理由に義務を減らしたり、途中で独自に再分類したりしない。
- `brainbase_knowledge_resolve`は参照先の決定であり、検索・取得の証拠ではない。契約に必要な場合は指定された実取得と質問別の根拠評価まで行う。
- Graph必須参照では同じturnで取得した本文とIDを根拠に`brainbase_knowledge_evidence_record`を記録する。失敗・不足は`insufficient`のまま扱い、追加取得後は評価も更新する。

## 判断と業務の証拠

- 証拠を要求するjudgment nodeは、実調査・検証の後にfinding、evidence_fit、unknownsと成功した実業務toolの`tool_use_id`を記録する。route、record、自己申告を実取得・検証の代わりにしない。
- 前段を更新したら後段も更新した結果に結び直す。根拠が不足する結論は`insufficient`とし、許可範囲内の追加確認へ戻る。
- モデルの意味判定やJev等の評価値は、実動作・人間行動・内容の真偽を独立に保証しない。変更した振る舞いは対象テストやreadbackで確かめる。
- receiptは書き込み、外部送信、課金、本番変更の許可ではない。通常の権限境界を別に守る。

## 完了と監査表示

- 依頼された許可済み作業、selected node、required capability、要求されたvalue proofを満たしてから完了する。未処理や復旧可能な安全な作業を残して`completed`にしない。
- 実装・操作turnでHostが要求する`brainbase_judgment_state_record`は、業務toolとvalue proofの後、最後のtool callとして記録する。追加作業が発生した場合の回復も現行Hostの指示に従う。
- 最終回答の監査表示は現行Host契約に従う。Hostが別表示する構成では回答本文を一度だけ返し、Host所有の監査行を追加・模倣しない。旧構成のprefix挿入や`brainbase_judgment_audit_read`は、そのturnのHostが明示的に要求した場合に限る。
- PostToolUseの成功やstate記録だけで最終receipt確定とは扱わない。Stopによる受理と、業務の実行・検証を区別する。
- 自律継続できない場合は、現行契約で許可された理由と具体的な不足・次の行動を示す。権限範囲を広げて回復しない。

## Hook稼働を調べる場合

- Hookファイル、trust設定、過去artifactの存在だけを稼働証明にしない。`npm run check:judgment-hook-readiness -- --cwd <canonical-checkout>`でHostのreadinessを照会する。
- `modified`、`untrusted`、missing、disabled、matcher不一致、integrity failureは正常扱いしない。repo codeから`trusted_hash`を更新せず、必要な承認はownerが`/hooks`で行う。
- 承認後の新規taskでepisode、event、finalとtranscriptを照合できた場合だけ`proven_active`とする。既存taskや直接entrypointの実行で代用しない。
