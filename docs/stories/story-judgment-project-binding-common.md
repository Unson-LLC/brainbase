---
story_id: story-judgment-project-binding-common
title: 判断の依頼のプロジェクトを決める順序をOSSの公開packageへ移し、Claude Codeで明示したプロジェクトを優先する
status: in_progress
created_at: 2026-11-23
implementation_started: true
owner_repository: brainbase
depends_on:
  - story-judgment-harness-common-contracts-v1
---

# 判断の依頼のプロジェクトを決める順序をOSSの公開packageへ移し、Claude Codeで明示したプロジェクトを優先する

## 利用者成果

Claude Codeで判断Hostを使う人として、`BRAINBASE_JUDGMENT_PROJECT_CODE` で明示したプロジェクトの判断と監査にしたい。brainbase系のrepoで作業していても、明示した先と違うプロジェクトの判断に使われると、記録が別の場所に残る。

組織版のHostを作る開発者として、この順序をOSSの公開packageから使いたい。順序を組織版のrepositoryに持つと、移設待ちのHostに行を足すことになり、同じ判断が2か所に分かれる。

## 背景

- 組織版のHostは、依頼のプロジェクトを「公開relayのrepoの紐づけ → 環境の値 → 本人のrepoの紐づけ → repo名」の順で決めていた。
- Claude Codeの依頼では、本人用の常駐MCPが、その依頼の `x-brainbase-project-code` があるときだけ環境の値を設定し、無ければ消す。そのため、この値はそのターンで明示したプロジェクトである。
- Codexの環境の値は、前の作業から残っていることがある。その場合は、従来どおりrelayの紐づけを優先する（組織版の既存テストが固定している）。
- relayの紐づけと違うプロジェクトの受領は、relayが配送の時点で拒否する（project mapping mismatch）。明示を優先しても、relayの紐づけ先へ公開されることはない。
- 組織版の変更の別モデルのレビューで、明示したプロジェクトよりrelayの紐づけが先に選ばれる点が指摘された。

## 最小仕様

- `judgment-project-binding` を公開subpathとして出す。中身は `selectJudgmentProjectBinding` だけとする。
- 引数は、Hostが持つ候補（`hostRuntime`、`configuredProjectCode`、`relayProjectCode`、`ownerRepositoryProjectCode`、`sourceRepository`）とする。
- 順序は次のとおり。前後の空白を除き、空の候補は無いものとして扱う。
  1. `hostRuntime` が `claude-code` のときの `configuredProjectCode`
  2. `relayProjectCode`
  3. `configuredProjectCode`
  4. `ownerRepositoryProjectCode`
  5. `sourceRepository`
- 候補の読み取り（環境・relayの設定・git）と、relayの配送時の照合は呼び出し側が行う。

## 受入条件

- [ ] AC-01: Claude Codeのターンでは、明示したプロジェクトをrelayの紐づけより優先する。
- [ ] AC-02: Codexのターンでは、環境の値よりrelayの紐づけを優先する。
- [ ] AC-03: relayの紐づけが無ければ、環境の値、本人のrepoの紐づけ、repo名の順に使う。空白だけの候補は無いものとして扱う。どれも無ければnullを返す。
- [ ] AC-04: `@unson/brainbase-mcp/judgment-project-binding` として公開packageのsubpathから読める。

## 範囲外

- OSSの `judgment-host` の `buildJudgmentRequest` の変更。組織版のHostとは別の実装で、relayの紐づけを持たない。
- 組織版のHostの切り替え。組織版は、公開された版を取り込んでから切り替える。
- npm公開、組織版への取り込み、実行環境への反映。

## 検証

- `npx vitest run tests/judgment-project-binding.test.ts tests/judgment-harness-common-contracts.test.ts`
- `npm run build`
