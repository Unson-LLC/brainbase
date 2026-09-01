# Spec: 判断価値証跡consumer接続

## 固定契約

- Core dependency: `github:Unson-LLC/brainbase#d51550260407bff7782c1a621fa13b12ce9fbfa6`
- Core import: `@unson/brainbase-mcp/judgment-value-proof`
- input schema: `brainbase-judgment-value-proof-input-v1`
- projection schema: `brainbase-judgment-value-proof-v1`
- MCP tool: `brainbase_judgment_value_proof_record`

## 実装条項

### SPEC-001 MCP入力

入力Schemaはinterruption、decision、execution、outcome、任意のhuman_decisionとfeedback_requestedを検証する。tool成功は入力受理だけを意味し、Outcome検証を意味しない。

### SPEC-002 Projection

Stopは成功したvalue proof eventが同一episodeに正確に1件ある場合だけ採用し、同一episodeのevidence eventだけを参照する。`intent_id`はturnへ、`decision_attempt_id`は採用したvalue proof eventへ決定的に束縛する。複数件は失敗させる。各実行成果物は、同じ`subject_ref`を安全なmetadataへ記録した先行実行eventと、その実行より後に同じ対象を入力にして結果を得た`search`または`retrieve`の両方があり、各eventの入出力digestまで証拠refへ束縛できる場合だけ検証済みとする。取得だけによる実行の自己申告、実行前の古い読み戻し、無関係な実行・取得、結果なし、証拠不足、申告種別とevent意味の不一致、失敗event、digest不一致は`unconfirmed`として扱う。

### SPEC-003 表示

Projectionが無ければ表示しない。ProjectionがあればCore Rendererを使い、既存のHost生成監査行を変更せず、その後へ表示する。

Projectionにattention付随成果物がある場合、確定後の再Stopでも保存digestと実体を照合し、欠落または不一致はfail-closedにする。

`continued_without_human`は、Hostが同一turnで実際に差し戻して保存した中断候補と質問文・digestが一致する場合だけ表示する。

### SPEC-004 人間判断

`human_required`は`waiting_human`へ投影し、理由、選択肢、各選択肢の影響を保持する。
状態toolの`runtime_reason_code`と最終回答の確認行を照合し、表示質問が一致しなければ投影しない。

### SPEC-005 非複製

組織版はCoreのSchemaとRendererを再実装せず、依存subpathからimportする。

### SPEC-006 展開

表示は既定OFFとする。`BRAINBASE_JUDGMENT_VALUE_PROOF_MODE=enabled`、または`canary`とproject allowlistの一致でのみ有効化する。マージ自体は本番有効化を意味しない。

### SPEC-007 変更範囲

既存のVibePro証跡を削除しない。CIは読み取り専用権限で検証だけを実行し、ブランチへのcommitやpushを行わない。

## テスト参照

- `mcp/brainbase/tests/tools/judgment-value-proof-tools.test.ts`
- `tests/unit/judgment-value-proof-adapter.test.js`
- `tests/unit/judgment-resolver-host-value-proof.test.js`
- `tests/integration/j0-organization-pinned-artifact-consumer.test.js`
- `tests/integration/judgment-resolver-host-entrypoint.test.js`
