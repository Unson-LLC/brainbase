# Story: OSSの公開契約をfixtureで固定する

Story ID: `story-oss-public-contract-fixture-v1`

状態: Planned / docs only（Story と Spec だけ。fixture とテストは別の実装PRで追加する）

起点: brainbase#505 の再実装台帳「#476 OSS公開契約fixture」。旧Draft（`codex/oss-public-contract-fixtures`）を現行 develop（e5f0db5e）の公開面に合わせて最小差分で作り直す。#489 は対象外。

## Story

OSSの利用者と、OSSを土台にする組織版の実装者として、`@unson/brainbase-mcp` が外へ見せる面（MCP tool名と必須入力、CLI command名、package の入口と bin）を、npm package に同梱された1つの機械可読fixtureで確かめたい。そうすれば、公開面が意図せず増えたり消えたりしたときにテストが失敗し、変更は必ず fixture の差分としてレビューに乗る。組織版は名前の取りこぼしや配布漏れを、OSSのコードを読まずに検出できる。

## 受け入れ条件

各ACの正本、照合方法、追加する正確なテスト名は [Spec](../specs/oss-public-contract-fixture-v1.md#受け入れ条件と追加するテスト) に置く。本docs PRでテストを実装済みとは扱わない。

- AC-1: MCP tool名と必須入力が、出る条件ごとの群（既定のlocal、managed_cloud、foundation接続時、queue backend注入時）としてfixtureに記録され、実装との差分でテストが失敗する。
- AC-2: CLI command名と別名（`review:serve` → `web:serve`）がfixtureに記録され、実装との差分でテストが失敗する。
- AC-3: package名、main、types、2つのbinがfixtureに記録され、manifestとの差分、またはbuild後のbin実体の欠落でテストが失敗する。
- AC-4: fixtureがnpm tarballに含まれる。
- AC-5: fixtureはOSSの公開情報だけを含み、組織固有の接続先やローカル絶対パスを含まない。
- AC-6: fixture自体の形が壊れている（未知のfield、並び崩れ、重複、空の群）とテストが失敗する。

## 対象外

- 組織版のfixture consumer実装と、組織版adapterの移設。
- MCP result payload、入力propertyの型・説明文、annotations、CLI option の固定。
- host が組み立てる foundation 認証付き tool（`scope_id` を足した版、`foundation_adopt`）の記録。
- `package.json` の `exports` への追加、version・lockfile の変更、振る舞いの変更。
- 既存テスト（`tests/mcp-contract.test.ts` の C-6、`tests/queue-task-tools.test.ts` の AC-1）の件数assertの整理。

## 残る判断

範囲は Spec の「決定」節で claude-code が決めた（Director 指示 2026-11-01 18:42 JST）。owner の判断が要る点は Spec の「未確認事項」に置く。
