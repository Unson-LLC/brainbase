# Architecture: Judgment Value Proof Consumer

## 責務境界

- `Unson-LLC/brainbase`: Schema、真実性検証、表示モード、チャネル非依存Rendererの正本。
- `Unson-LLC/brainbase-unson`: 組織版MCP入力、既存Judgment Episode eventへの接続、Codex Stopへの表示接続。
- 各Surface: Slack、Mana、Web固有の描画。今回の対象外。

## データ経路

1. Hostが不要な質問を差し戻した時点で、質問文とdigestをimmutableな中断候補として記録する。`human_required`では、最終回答の確認行を中断候補にする。
2. モデルがその中断を解決した場合だけ、`brainbase_judgment_value_proof_record`を正確に1回呼ぶ。
3. `PostToolUse` journalへ安全な構造化metadataを記録する。
4. Stopで同一episodeの中断候補、証拠event、実行状態を照合し、Core Schemaへ投影する。
5. Core validationを通過したProjectionだけをimmutable receiptとして保存する。
6. Core Rendererの出力を既存監査ブロックの後へ追加する。

## 真実性境界

- tool入力だけでは`outcome_verified`にしない。同一episodeのverified evidenceが必要。`canonical_readback`は実行成果物と同じ`subject_ref`を入力にした、結果ありの`search`または`retrieve`成功eventへ一致させ、入出力digestを証拠refへ束縛する。無関係な取得、結果なし、書込み成功の自己申告では検証済みにしない。
- 質問削減は、同一turnでHostが実際に差し戻した質問とvalue proof入力が完全一致する場合だけ表現する。
- `human_required`は完了へ丸めず、`waiting_human`状態と表示質問の完全一致を必須にする。
- 成功したvalue proof eventは同一episodeに正確に1件だけ許可し、複数件は曖昧な最新採用をせず失敗させる。
- 入力が無いturnはレシートを生成しない。
- raw tool response、秘密情報、内部監査ログは表示Projectionへ入れない。
- attention付随成果物はfinal receiptのdigestへ束縛し、再Stopで欠落または改ざんを検出する。

## 展開境界

- `BRAINBASE_JUDGMENT_VALUE_PROOF_MODE`の既定値は`off`。
- `enabled`は明示的な全体有効化、`canary`は`BRAINBASE_JUDGMENT_VALUE_PROOF_CANARY_PROJECTS`のproject codeだけを対象にする。
- PRのマージだけでは本番表示を有効化しない。fresh-task実証後にcanaryを広げる。
