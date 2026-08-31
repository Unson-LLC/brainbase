# J0 組織版固定commit consumer仕様

## 目的

ADR-022の一方向依存を、J0 run artifact契約の実consumerで証明する。

## 固定契約

- manifest dependency: `github:Unson-LLC/brainbase#9c0343c6b967cd34e1a45ed2d7c25d1c3f8ff3ae`
- installed resolution: `git+ssh://git@github.com/Unson-LLC/brainbase.git#9c0343c6b967cd34e1a45ed2d7c25d1c3f8ff3ae`
- import: `@unson/brainbase-mcp/judgment-dag`
- save input: 既存directory rootと完全な`JudgmentDAGRunRecord`
- load input: 同じrootとsave receiptの`artifact_id`
- load output: 保存時recordとdeep equalな、検証済みimmutable record

## 不変条件

1. package manifestとpackage lock rootのGitHub dependency文字列は完全一致する。
2. install済みlockのresolved値はnpm正規化後のGit URLと固定commitへ完全一致する。
3. consumerは公開package APIだけを呼び、組織版にartifact store実装を複製しない。
4. saveとloadは別processで実行し、memory上の参照を証跡にしない。
5. load processへrunnerを渡さず、再実行なしでrecordを復元する。
6. input、DAG、execution order、runner versions、node input/outputを比較する。
7. tamper検知、replay、evaluation、list、組織storage adapterは本仕様へ追加しない。

## 検証

focused Vitestが一時directoryでprocess AとBを起動し、receipt、artifact file、reload record、lock pinをreadbackする。既存のJudgment Resolver実装や本番runtimeは起動しない。
