---
adr_id: ADR-016
title: Canonical Task single writer and explicit recovery
status: accepted
date: 2026-07-14
related_stories:
  - story-companion-canonical-task-provider
related_docs:
  - docs/stories/story-companion-canonical-task-provider.md
  - docs/architecture/story-companion-canonical-task-provider.md
  - docs/specs/story-companion-canonical-task-provider-spec.md
supersedes: []
superseded_by: []
---

# ADR-016: Canonical Task single writer and explicit recovery

## Context

NocoDBの通常REST PATCHは、BrainbaseのPostgres lease generationを条件に含めた原子的な
compare-and-swapを提供しない。複数processがleaseを自動takeoverすると、旧processの遅延PATCHが
新しい変更を上書きし得る。また、既存Workflow repositoryはJSON全体をprocess単位で保存するため、
複数processによる`task_store`承認の同時更新を正しく扱えない。

## Decision

Canonical Taskのmutationと`task_store`承認は、Postgresの永続singleton tokenを持つ単一Brainbase
processだけが実行する。別processは読取を提供できるが、Task mutationと`task_store`承認は503にする。

tokenはgraceful shutdownでreleaseする。process異常終了時は時間経過だけでtakeoverせず、運用者が
旧process停止を確認し、期待する旧tokenを指定した明示回復だけを許可する。新writerはPostgresの
operation結果からTask ID、human step/run目標状態、監査checkpoint、phaseを読み、Workflow JSONへ
再投影してから処理を再開する。

## Boundaries

- Task本文の正本はNocoDB Task表のままで、Postgresはwriter権限と回復checkpointだけを持つ。
- createの最終一意性はNocoDB Task表の冪等キーDB一意制約が担う。
- 外部APIとWorkflowの保存冪等keyはそれぞれ`api:<principal>:`と`workflow:<output>:`へserver側で分離する。
- update/transitionは単一writer内でexpected versionを検査し、版と操作markerを同じPATCHに保存する。
- 旧NocoDB routeは正本base mutationを拒否し、正本tableへ直接書く運用scriptはCanonical Task APIへ移行する。正本base以外の旧route互換は維持する。
- Mana captureと既存ブラウザTask画面の正本base mutationもCanonical Task API/serviceへ移行し、障害時にlocal ID、空一覧、旧routeへfallbackしない。
- 正本Taskの削除もexpected versionと冪等keyを持つsingle-writer operationに含め、削除済み再送は保存結果を再生する。
- deleteはTask/version共通排他claimとactor namespace付きclient idempotency claimを分離し、削除前認可snapshotとprepared intentを永続化してからNocoDBを削除する。
- delete再送は同一actor namespaceの同key異fingerprintと別key同versionを409にし、別actor namespaceには削除結果を開示せず404にする。
- NocoDB MCPは正本Taskのrecord mutationと列metadata mutationを拒否する。NocoDB credentialそのものを正本Task writer権限にしない。
- 正本store identityはcommit済みmanifestとcanonical JSON hashでBrainbase/MCP/migration間に共有し、不一致・個別override・table解決失敗はmutationを停止する。
- 正本store設定は起動時に一度だけ確定したimmutable objectを全JS writer/guardへ渡し、Task APIはcookie-onlyとinsecure-headerをowner認証として受理しない。
- 初回migration前に`docs/runbooks/canonical-task-cutover.md`と`scripts/preflight-canonical-task-cutover.js`で旧Brainbase、Mana、MCP、運用scriptを停止・排水する。rollbackでも旧直接writerを復活させない。
- 既存文字列候補はowner未解決objectへ正規化し、IDなし候補は内容hashと同一内容ordinalから並び順に依存しないcandidate ID集合を得る。
- 既存NocoDB UI adapterは`waiting`/`urgent`を双方向投影し、未知値を既定値へ黙って縮退しない。
- `task_store`以外の既存Workflow契約とrepository形式は変更しない。
- 複数writerを必要とする将来構成では、NocoDB backing store側の条件付き更新またはtransactional outboxへ移行する。このADRの自動takeover禁止を解除してはならない。

## Consequences

v1は障害時の自動復旧より書き込み安全性を優先する。異常終了後は明示回復までmutationが503になるが、
遅延した旧writerと新writerが同時にNocoDBへ書く状態を作らない。Brainbaseの現行単一process運用と
Workflow JSON repositoryの実態に一致し、保証できないmulti-process safetyを契約にしない。
