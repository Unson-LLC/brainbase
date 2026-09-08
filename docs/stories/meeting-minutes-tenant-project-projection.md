# 議事録保存先のテナント投影

## Story

佐藤さんが Meeting Router で BAAO Growin を選択したとき、正規の BAAO project がテナントの保存先として解決され、既存の雲孫 membership を保ったまま Slack identity が `minutes-baao-growin` に対応する。

## Scope

この変更は、宣言済みの `tenant_projects` を追加し、既存の Sato membership の `project_codes` に `baao` を加算し、対象 Slack identity がなければ作成する。既存の `auth_grants`、Graph の組織所有権、authority binding、Slack 接続の credential は変更しない。

適用は `--apply --approve-apply` と actor の明示が必要で、適用後は RLS 付き readback で project、membership、identity、接続の一致を確認する。`--dry-run` は同じ検証と SQL 計画を実行して rollback する。

BAAO の既存 Sato membership は live readback で `tenant_role` と `principal_type` のキー自体が欠損していた。承認済み manifest は `from_missing:true` を明示した場合だけこの欠損を `tenant_role=tenant_admin`、`principal_type=person` に補完し、`project_codes` へ `baao` を加算する。明示的な `null` は `from:null` で別に宣言し、欠損と混同しない。非 null の異なる値や宣言と異なる null は補正せず失敗し、更新時は宣言外の membership payload を保持する。適用後の最終 readback は補完後の値を必須とする。

`organization_id` は canonical なテナント組織 ID であり、ルートの `tenant_key`（`unson-business`）とは別の識別子として検証する。authority binding、auth grant、Graph 組織所有権、既存の別 organization membership はこの処理の対象外である。

## Acceptance evidence

- canonical project resolver が `baao` と `prj_01KGCS8BC76XRHFCHRRQ8G25MY` を一意に返す。
- tenant、organization、Slack connection、既存 Sato membership が manifest と完全一致する。
- membership は宣言済みの値を保持し、`baao` だけを加算する。
- identity は Slack subject、workspace、app、membership、project、`minutes-baao-growin` placement の組で一意になる。
- commit 後の readback が成功し、`auth_grants` への SQL が存在しない。
- 横展開対象の zeims、aitle、senpainurse、kartz、salestailor は canonical project ID と保存先対応を記録済みだが、membership の正本証跡が未確認のため `apply_ready=false` とする。
