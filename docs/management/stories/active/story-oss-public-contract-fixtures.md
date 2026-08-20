# Story: OSS公開契約fixture化

## 利用者価値

組織版の実装者として、OSSが公開するMCP・CLI・npm packageの境界を機械可読なfixtureとして参照したい。そうすれば、組織版をOSSの上位互換へ寄せる際に、名称の取りこぼしや配布漏れをテストで検出できる。

## 受け入れ条件

- 15件のMCP tool名と必須入力がfixtureに記録され、実装との差分でテストが失敗する。
- 23件のCLI command名がfixtureに記録され、実装との差分でテストが失敗する。
- package名、main、types、2つのbinがfixtureに記録され、manifestとの差分でテストが失敗する。
- fixtureがnpm tarballに含まれる。
- fixtureはOSSの公開情報だけを含み、組織固有の接続先やローカル絶対パスを含まない。

## 対象外

- 組織版へのfixture consumer実装。
- 組織版adapterの移設。
- MCP result payload全体の固定。後方互換方針を別Storyで定義してから拡張する。

## 検証

- `npm test -- tests/public-contract-fixture.test.ts`
- `npm run build`
- `npm pack --dry-run --json`
