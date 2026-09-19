# 診断ファミリー

症状や変更から関係する確認を選ぶための短い索引。複数に見えても、証拠が示す最小の組み合わせから始める。

## UI

- HTMLがCSSのselector・wrapperを実際に生成しているか確認する。
- 親のflex/grid、`min-height: 0`、`overflow`、scroll/stickyの階層を照合する。
- 表示されない要素は、存在、計算後のstyle、親のclip、イベント/データ投入の順に分ける。
- 詳細: [旧UI資料](../agents/phase3a_ui_consistency.md)

## Runtime

- 変数の宣言、scope、初期化、再代入、非同期処理の順序を追う。
- `undefined` / `null` は宣言漏れ、入力欠落、ライフサイクル競合を分けて確認する。
- 詳細: [旧Runtime資料](../agents/phase3b_variable_lifecycle.md)

## Logic/Data

- 入力の実値とコードが期待するenum、case、型、境界値を比較する。
- 変換、filter、sort、計算の前後を同じ入力で確認し、欠落した値や暗黙の変換を探す。
- 詳細: [旧Logic/Data資料](../agents/phase3c_data_flow.md)

## Architecture

- コード、個人データ、共有データ、生成物の保存場所と所有者を分ける。
- 永続化すべき意図（desired state）と、実行時に計算できる状態（runtime/computed state）を混ぜない。
- API、DB、ファイル、workerの境界でスキーマと責任を照合する。
- 詳細: [旧Architecture資料](../agents/phase3d_data_architecture.md)

## Refactoring

- 実装の戻り値、同期/非同期、状態、View、APIの変更と、テストの前提を比較する。
- 失敗を実装不備、テストの陳腐化、fixture/環境の不整合へ分類する。
- 詳細: [旧Refactoring資料](../agents/phase3e_code_test_sync.md)

## 設定・デプロイ・セキュリティ

- Config: 生のテンプレート、環境変数、展開後の値、利用箇所を順に照合する。
- Deploy: CLIの期待構文、生成payloadのJSON shape（必要なwrapperや`jq -c`を含む）、バックアップ/diff、更新後readbackを確認する。
- Security: 影響範囲、攻撃経路、漏えいの直接証拠、封じ込め、監査証跡を分ける。破壊的な広域探索や外部操作は権限と対象を確認してから行う。
- 詳細: [旧Config資料](../agents/phase3f_config_processing.md)、[旧Deploy資料](../agents/phase3g_deployment_operations.md)、[旧Security資料](../agents/phase3h_threat_containment.md)

## 前提・根因・修正

必要に応じて、既存の [再現資料](../agents/phase1_reproduce.md)、[特定資料](../agents/phase2_locate.md)、[前提資料](../agents/phase4_prerequisites.md)、[根因資料](../agents/phase5_root_cause.md)、[修正資料](../agents/phase6_fix.md) を参照する。これらは選択した観点の補助資料であり、全件実行の指示ではない。旧資料にある固定工程・人数・モデル・再試行回数・完全再現の要求は適用しない。
