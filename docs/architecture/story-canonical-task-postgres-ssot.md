# Architecture: Canonical Task PostgreSQL SSOT

## Context

Canonical Task API は現在 `CanonicalTaskNocoDBRepository` を通じて NocoDB を Task 本文の正本にしている。
一方、Brainbase PostgreSQL には single-writer、readiness、operation recovery の調停データだけがある。
mana-runtime から Slack Canvas をチャンネル別の閲覧・操作面として使うため、Task 本文の正本を
Brainbase PostgreSQL に移し、Canvas と NocoDB を投影先へ降格する。

## Decision

- `canonical_tasks` を Brainbase PostgreSQL に追加し、Task本文・版・冪等キー・source refsを保持する。
- `CanonicalTaskPostgresRepository` は既存repository契約を実装し、公開HTTP契約を変更しない。
- opaque ID は既存 `ct1` を維持する。新規IDには store discriminator `postgres` と UUID を署名して埋め込む。
- 既存NocoDB opaque IDは移行期間中に読み取れるよう、migrationで同じ公開IDへ対応する `legacy_nocodb_id` を保持する。
- `CANONICAL_TASK_BACKEND=nocodb|postgres` で明示選択し、未指定は安全のため既存 `nocodb` とする。
- Postgres選択時も既存single-writer/readiness/operation ledgerを使い、mutation経路を増やさない。
- migrationは NocoDB read -> PostgreSQL upsert の一方向だけとし、dry-run/check/applyを分離する。
- 再実行時はIDだけでなくpayload fingerprint・version・operation markerの完全一致を要求し、
  target-only行を切替前のauthority逸脱として拒否する。
- Graph SSOT は人・組織・project・decisionの権威を維持し、Task本文は格納しない。
- Slack Canvas同期は本Storyに含めず、mana-runtime側の後続StoryがCanonical Task APIだけを利用する。

## Boundaries

- NocoDBの既存データを削除しない。
- 本Storyで本番切替・DB apply・Canvas更新は行わない。
- 本Storyが保証するrollbackは切替前の設定維持までである。PostgreSQLへの本番書込み開始後にNocoDBへ
  戻すにはreverse syncと整合性確認を伴う別の承認済みcutover計画が必要で、単純なbackend設定復帰はしない。
- API route、認証、People検証、状態遷移、監査、single-writer契約は変更しない。
- repository選択とmigrationが失敗した場合はfail closedとし、別storeへ暗黙fallbackしない。

## Consequences

- API利用者は正本の物理配置を意識しない。
- 本番切替はschema適用、migration検証、readiness証跡、環境変数切替を別運用手順で実施できる。
- Canvasは再生成可能なprojectionになり、人間によるCanvas直接編集は正本へ逆輸入しない。
