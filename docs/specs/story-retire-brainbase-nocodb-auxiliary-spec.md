---
spec_id: story-retire-brainbase-nocodb-auxiliary-spec
story_id: story-retire-brainbase-nocodb-auxiliary
title: BrainbaseのNocoDB補助HTTP経路退役仕様
status: active
created_at: 2026-09-20
---

# BrainbaseのNocoDB補助HTTP経路退役仕様

## 契約

1. Overviewの`critical-alerts`、`strategic-overview`、`projects/:id/stats`は共通の退役応答を返す。HTTP statusは410、`error`は`capability_retired`、`capability`は`brainbase.nocodb-auxiliary`とし、Graph/Canonical Task APIを置換先として示す。
2. Trendsの`trends`と`trends/heatmap`も同じ退役応答とし、`?test=true`などのfixture経路で旧NocoDB形式を返さない。
3. Graph project catalogの一覧取得は残す。健康統計が必要な旧投影を参照せず、NocoDB投影が存在するプロジェクトは`healthStatus: unavailable`、`healthSource: nocodb_retired`、数値指標はnullで返す。投影のないプロジェクトは`healthStatus: unmapped`とする。
4. Overview/Trends routerはNocoDBServiceを引数として必要とせず、ルーター生成時およびリクエスト時にNocoDBへ接続しない。portal、Actions、共通認証など他の責務はこの仕様の対象外とする。

## 検証

- 上記5パスをfixture/query有無の両方で呼び、410と退役契約を確認する。
- 退役パスでproject catalogおよび偽NocoDB serviceが呼ばれないことを確認する。
- Graph project catalogの一覧が従来のアクセス範囲で返り、健康情報がunknownのまま保持されることを確認する。
- 変更ファイルのlint/syntaxと専用Vitestを実行する。既存の旧NocoDB成功期待テストは、退役契約へ更新して回帰を確認する。

## 境界と復旧

コード、専用テスト、Story/Specのみの変更。保存済みデータ、Slack/Googleの認証・連携、Personal Knowledge、Graph/InfoSSOT/learningは削除・移行しない。必要ならこのコミットをrevertしてコードを復旧できる。
