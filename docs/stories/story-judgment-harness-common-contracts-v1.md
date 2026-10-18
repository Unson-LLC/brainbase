---
story_id: story-judgment-harness-common-contracts-v1
title: 判断Hostの共通契約をOSSの公開packageへ移す
status: in_progress
created_at: 2026-10-18
implementation_started: true
owner_repository: brainbase
depends_on:
  - story-judgment-resolution-contract-exit-v1
---

# 判断Hostの共通契約をOSSの公開packageへ移す

## 利用者成果

組織版のHostをOSSの判断部品と組み合わせる開発者として、Hostの開始・停止・監査の既存振舞いを保ったまま、実行結果・ノード根拠・完了回答の公開共通契約を一つのpackageから利用したい。

## 最小仕様

- `judgment-execution-outcome` は、Host種別・実行段階・失敗時の再開位置・証拠参照を厳密に検証する。
- `judgment-node-evidence` は、業務toolの成功イベントだけを根拠として、順序付きのノード結果を検証する。制御面・空検索・秘密値は根拠にしない。
- `judgment-event-adapter` は、完了した判断エピソードを権限なし・グラフ昇格不可の知識イベントへ投影し、監査行を除去し、秘密らしい回答を隔離する。
- 既存 `judgment-host.ts` は複製せず、同じOSS実装を `@unson/brainbase-mcp/judgment-host` から公開する。
- Task・continuation・repository identity・transcript・process・SQLite・outbox配送・組織IDはHost/組織adapterの境界に残す。OSS共通部品へ移さない。

## 受入条件

- [ ] AC-01: 3つの共通契約がruntime正本の受理・拒否条件を満たす。
- [ ] AC-02: Hostの既存単体テストが通り、公開subpathから既存Host APIをimportできる。
- [ ] AC-03: `npm run build` と契約テストが通る。
- [ ] AC-04: `npm pack` したtarballを新しいconsumerへ組み込み、Hostと3つの共通契約をsubpath importできる。
- [ ] AC-05: npm公開・consumer切替・旧配置削除・本番配備は、レビューと利用者承認後に行う。

## 範囲外

- unsonの9k行Host、Task保存、outboxのruntime path・lock・HTTP配送、Mana meeting adapterの丸ごと移設。
- 組織ID、秘密値、絶対パス、組織固有認証のOSSへの持ち込み。
- npm publish、merge、本番配備。

## 検証

- `npx vitest run tests/judgment-harness-common-contracts.test.ts tests/judgment-host.test.ts`
- `npm run build`
- `npm pack` 後の別ディレクトリconsumer smoke
- Graphifyの変更後更新
