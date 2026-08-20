# OSS公開契約fixture Architecture

## Decision

`contracts/brainbase-public-contract.v1.json`を、OSSが外部へ提供する公開面の機械可読fixtureとする。実装をfixtureから生成せず、独立した契約と実装をテストで照合する。これにより、意図しない公開面の追加・削除をレビュー対象にする。

fixtureはnpm packageの`files`へ含める。組織版は後続Storyでこの同一artifactを読み、上位互換性を検証する。

## Contract boundary

- package: name、main、types、bin
- MCP: tool名、必須入力フィールド
- CLI: command名

説明文や内部関数名は契約にしない。MCP結果schemaと失敗意味は現在コード上で統一schemaになっていないため、このStoryでは誤った安定性を宣言せず後続へ分離する。

## Failure semantics

実装とfixtureの集合・必須入力・manifestが一致しない場合はテストを失敗させる。fixtureがnpm tarballから欠ける場合も失敗させる。
