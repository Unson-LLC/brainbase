---
story_id: story-company-os-durable-wait-due-candidates-v1
title: Manaが期限到来した待機候補を範囲限定で取得できる
status: active
created_at: 2026-09-24
implementation_started: true
owner_repository: brainbase
depends_on: ["story-company-os-durable-wait-http-v1"]
---

# Manaが期限到来した待機候補を範囲限定で取得できる

## 利用者成果

担当するtenant・scopeの期限到来待機を、再起動後も定期実行から見つけられる。取得結果だけでは再開せず、既存claimで現在条件を再検証する。

## 受入条件

- 認証済みhost contextからtenant・principal・scopeを受け、GET `/api/v1/durable-waits/due` は記録のtenantとscopeが一致するwaiting状態で期限が来た候補だけを返す。request queryから主体やscopeを採用しない。tenant未記録の旧データは推測で所属を補わず、候補から除外する。
- 候補ごとに現在のclaim ACLとProblem snapshotを確認し、権限のない候補を漏らさない。provider異常を空リストへ変換しない。
- 応答を上限100件とcursorでページ化し、候補IDと期限だけを返す。cursorを他のtenant・主体・scopeへ流用できない。
- 取得後の変更・失効は既存claimが再検証する。取得結果を権限や再開成功として扱わない。

## 対象外

Manaのcron/queue接続、本番認証とtenant別store生成、旧データのtenant移行、期限切れleaseの自動引継ぎ、外部作用不明の照合。本番の候補巡回はこれらの接続と移行が済むまで有効化しない。

## 検証

実store・HTTPで境界、期限、状態、ACL、snapshot、ページ送り、取得後のclaim拒否を確認する。
