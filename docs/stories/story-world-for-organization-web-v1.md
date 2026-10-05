---
story_id: story-world-for-organization-web-v1
title: 世界を、組織版でも同じ部品のまま載せられるようにする（OSS側）
status: in_progress
created_at: 2026-10-05
implementation_started: true
owner_repository: brainbase
depends_on: ["story-world-generic-graph-v1", "story-world-organization-judgments-only-v1"]
---

# 世界を、組織版でも同じ部品のまま載せられるようにする（OSS側）

## 利用者成果

組織のメンバーが組織版を開くと、OSS Personalと同じ世界で、組織の事業と案件を自分の権限の範囲で見られる。Personal Webが組織Graphを読む検証の間の代用（C1）を、組織版で見られるようになった時点で終えられる。

## 背景

台帳P16・D8は「組織版はOSSの画面部品をそのまま使う」と決めている。世界はOSSの部品として作ったが、組織版には載っていなかった（組織版の依存は0.15.0で世界を含まず、組織のGraphの記録から世界を描く口も公開していなかった）。佐藤さんが、組織版に世界を載せてからC1を終える流れを承認した（2026-10-05）。判断journalは各メンバーのMacに残し組織版へ送らない（台帳§6の7、2026-09-27）。

## 受入条件

- [x] AC-01: `@unson/brainbase-mcp/world` の `projectOrganizationWorld({ projects, glossaryTerms }, { server, vocabulary?, now? })` が、組織のGraph APIが返すプロジェクトと用語の記録から、Personal Webと同じ形の世界（事業・案件・リポジトリ・分類の名前）を返す。
- [x] AC-02: `createWorldView` に `projectHref(project)` を渡すと、事業・案件の「プロジェクトと関係者で開く」がその行き先になる。渡さなければ従来どおり `#projects?project=<id>`。
- [x] AC-03: ホストが判断の理由 `judgment_journal_not_connected` を返したとき、世界は「判断の記録は各メンバーのMacにあり、組織版には送らないため未接続」と出し、事業だけを描く（0件とは言わない）。

## 対象外

組織版側の画面とAPIの追加・配備（brainbase-organizationの別Story）。C1の撤去（組織版で確認した後）。

## 検証

- `tests/world-extension.test.ts` で、組織APIの形の記録から事業・案件・リポジトリ・用語の名前が出て、終了した記録は描かないことを確かめる。
- 既存の世界・UIテストが通ること。
