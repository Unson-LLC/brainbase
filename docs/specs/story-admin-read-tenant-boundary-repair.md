---
story_id: story-admin-read-tenant-boundary-repair
title: 認証済み管理ビューの読み取り経路を復旧する
status: active
created_at: 2026-09-06
updated_at: 2026-09-06
---

# 認証済み管理ビューの読み取り経路を復旧する

## Story

Brainbase MCPのbrainbase_admin_readは利用者のBearer tokenを送り、管理ビュー側はその人物・役割・プロジェクト・機密区分で結果を絞り込む。しかし/api/adminに単一テナントの署名済み文脈を要求するガードが追加された一方、その文脈を発行してMCPへ渡す経路がないため、すべての管理読み取りがHTTP 400で失敗している。

## Acceptance Criteria

- AC-001: 認証済みのGET /api/admin/*は、既存のreq.accessによる読み取り制御を維持したまま、テナントランタイムの有無に依存せず応答する。
- AC-002: 未認証の管理読み取りは従来どおり拒否する。
- AC-003: 監査書込みなど、テナント所有資源を変更する経路の署名済みテナント境界は維持する。
- AC-004: 実MCPから管理ビューを読み戻し、HTTP 400が解消したことを確認する。

## Architecture Decision

/api/adminは複数プロジェクトを横断できる読み取り専用の診断面であり、単一テナントを表す署名Envelopeとは責務が一致しない。既存のBearer認証とAdminVisualizationServiceのアクセス制御を正本とし、書込み系・外部副作用系のテナント境界は変更しない。

## Verification

- tests/server/bootstrap/tenant-entrypoint-fail-closed.test.js
- tests/server/services/admin-visualization-service.test.js
- 実brainbase_admin_readによる読み戻し
