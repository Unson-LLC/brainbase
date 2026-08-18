---
spec_id: SPEC-sns-scheduled-publisher
title: SNS予約投稿の実行者 Specification
status: implemented
date: 2026-08-18
story_id: str.brainbase.sns-scheduled-publisher
related_specs:
  - SPEC-sns-posting-engine
implementation_files:
  - server/services/sns/posting-ledger-repository.js
  - server/services/sns/sns-scheduled-publisher.js
  - scripts/run-sns-scheduled-posts.js
  - scripts/import-sns-review-pack-to-ledger.js
  - config/com.brainbase.sns-scheduled-publisher.plist
  - docs/runbooks/sns-scheduled-publisher.md
test_files:
  - tests/sns/scheduled-publisher/sns-scheduled-publisher.test.js
  - tests/sns/ops/run-sns-scheduled-posts.test.js
  - tests/sns/ops/import-sns-review-pack-to-ledger.test.js
  - tests/e2e/str-brainbase-sns-scheduled-publisher-jst.spec.ts
---

# SPEC: SNS予約投稿の実行者

## Invariants

- **INV-1**: runnerはSNS Posting Ledgerから `status=scheduled` かつ `scheduled_at <= now` の投稿だけをdue postとして扱う。
- **INV-2**: runnerは公開投稿が明示的に有効化されていない場合、X投稿スクリプトを呼ばない。
- **INV-3**: 実公開はrunnerだけが `SnsLedgerPublishService` 経路で行う。対話APIはdry-run専用で、公開副作用を持たない。
- **INV-4**: runnerは冪等であり、同じLedger rowを二重投稿しない。
- **INV-5**: `scheduled_at` の比較はJST/UTCの扱いを実装とテストで明示する。
- **INV-6**: 投稿失敗はUIで再確認できる状態としてLedgerに残し、黙って破棄しない。
- **INV-7**: dry-runはdue-post選択だけを検証し、X投稿スクリプトを呼ばない。
- **INV-8**: review packの `date` と `time` はJSTの壁時計時刻であり、`scheduled_at` が明示されない場合はJSTとしてUTC instantへ変換して保存する。
- **INV-9**: 修正前に作成済みのmutable Ledger rowは、review pack再インポートで `time` と `scheduled_at` を補正できる。公開済み履歴は上書きしない。
- **INV-10**: production review-pack取込はdeployment-localの4つの明示設定からcanonical tenant／resource bindingを全draftへ付与し、欠落・不正時はHTTP送信前に停止する。暗黙tenantを補完しない。
- **INV-11**: 公開runnerはtenant runtimeとPostgreSQL gatewayを必須にし、永続bindingを`entry_point=background_job`としてclaim／provider呼出し前に認可する。
- **INV-12**: `/api/sns-growth`は認証と`admin_api` tenant guardを必須とし、非dry-run publishをHTTP 409で拒否する。
- **INV-13**: production LedgerはPostgreSQLを必須とし、接続先未設定時は503で停止する。JSON fileは明示的なtest modeでだけ使用する。

## Contracts

### Contract-1: Scheduled Publisher

- **input**: `now`, `dry_run`, `auto_publish_enabled`, `actor`
- **output**: `{ scanned, due, posted, skipped, failed, dry_run }`
- **preconditions**: 投稿対象はSNS Posting Ledgerに存在し、statusが `scheduled` である。
- **postconditions**: 成功した投稿は `posted`、失敗した投稿はレビュー可能な失敗状態または失敗metadata付きの状態になる。
- **error cases**: X投稿スクリプト失敗、account利用不可、時刻変換不正、同時実行競合。

### Contract-2: Deployment Entry Point

- **input**: CLIまたはlaunchd/cronからの定期実行。
- **output**: 実行サマリーとログ。
- **preconditions**: 本番公開投稿には`SNS_AUTO_PUBLISH_ENABLED=true`、`BRAINBASE_TENANT_RUNTIME_ENABLED=1`、実PostgreSQL接続、tenant runtimeのservice auth／署名設定、binding付きLedger rowが必要である。
- **postconditions**: due postの結果がLedgerとログに残る。
- **error cases**: runtime／gateway欠落は`UPSTREAM_UNAVAILABLE`、binding欠落・不正は`TENANT_BOUNDARY_INVALID`、越境は`CROSS_TENANT_CANDIDATE`として副作用前に停止する。

初回実装の実行コマンド:

```bash
npm run sns:scheduled-publish -- --dry-run --json
SNS_AUTO_PUBLISH_ENABLED=true npm run sns:scheduled-publish -- --json
```

### Contract-3: Review Pack Time and Tenant Import

- **input**: review pack draftの `date`, `time`, 任意の `scheduled_at`、4つのSNS tenant／resource env。
- **output**: SNS Posting Ledger rowの `time`, `scheduled_at`, `evidence.tenant_boundary`。
- **preconditions**: `date` は `YYYY-MM-DD`、`time` は `HH:mm`。`scheduled_at` がある場合は絶対時刻として有効なISO文字列である。tenant ID、revision、object type、resource IDはcanonical形式である。
- **postconditions**: `scheduled_at` 未指定なら `date + time` をJSTとしてUTC instantへ変換して保存する。全draftに同じstructured-clone済みcanonical bindingを保存し、mutable既存rowは再インポートで補正する。
- **error cases**: 不正なdate/time、tenant env欠落／不正、同一account/date/slotに公開済みimmutable rowがある、重複本文guardに該当する。

### Contract-4: Release Operation Surface

- **input**: 修正前後のLedger行、review pack再インポート、dry-run結果、`SNS_AUTO_PUBLISH_ENABLED`
- **output**: 本番公開前に判断できるdue post件数と補正済み `scheduled_at`
- **preconditions**: 公開投稿を有効化する前にdry-runを実行できる。
- **postconditions**: 既存mutable rowの補正手順がrunbookにあり、公開済みrowを上書きしないことがテストと仕様で確認できる。
- **error cases**: 既存rowが補正されないまま公開投稿を有効化する、過去時刻のdue postを意図せず即時公開する。

## Regression Surface

このSpecの回帰確認対象は以下である。

- Ledger import: InMemory/JSON継承/Pg insert/Pg updateで `date + time` をJSTとして扱う。
- Existing data: `posted` / `learning_ready` / `deleted` は再インポートで上書きせず、mutable rowだけ補正する。
- Runner: `scheduled_at <= now` だけをdue判定に使い、`approved` を自動投稿しない。
- Publication safety: `SNS_AUTO_PUBLISH_ENABLED=true` がない場合はX投稿を呼ばない。
- Tenant safety: production importerはbinding欠落時に送信せず、publisherはgateway／binding／認可のいずれかが成立しない場合にclaimとX投稿を呼ばない。
- Operational surface: runbookに再インポート、dry-run、即時due時の判断が書かれている。
- UI/API surface: `/api/sns-growth`全体に認証とtenant guardを適用し、publish endpointはdry-runだけを許可する。UIコンポーネントの公開操作はscheduled runnerへ委譲する。
- Storage surface: productionでPostgreSQL URLがなければ503とし、ローカルJSON fileを生成しない。

## Scenarios

### S-1: 期限到来した予約投稿を投稿する

- **given**: `status=scheduled` かつ `scheduled_at <= now` の投稿がある。
- **when**: runnerを公開投稿有効で実行する。
- **then**: `SnsLedgerPublishService` 経由で投稿され、Ledgerは `posted` と `posted_url` を持つ。

### S-2: 公開投稿が無効なら投稿しない

- **given**: due postがある。
- **when**: `auto_publish_enabled=false` でrunnerを実行する。
- **then**: X投稿スクリプトは呼ばれず、投稿はskipとして記録される。

### S-3: 同時実行でも二重投稿しない

- **given**: 同じdue postに対してrunnerが同時に起動する。
- **when**: 両方がdue-post処理を試みる。
- **then**: 片方だけが投稿し、もう片方はstatus変化を検知してskipする。

### S-4: dry-runで選択だけ確認する

- **given**: due postがある。
- **when**: `dry_run=true` でrunnerを実行する。
- **then**: due件数は返るが、X投稿スクリプトとLedger mutationは実行しない。

### S-5: 投稿失敗を見える状態に残す

- **given**: due postがある。
- **when**: X投稿スクリプトまたはaccount確認が失敗する。
- **then**: 失敗理由がLedgerに残り、SNS UIからレビュー/再実行判断ができる。

### S-6: review packのJST slotを保存する

- **given**: review packに `date=2026-05-24`, `time=18:00`, `scheduled_at` なしの投稿候補がある。
- **when**: Ledgerへimportする。
- **then**: Ledgerには `time=18:00`, `scheduled_at=2026-05-24T09:00:00.000Z` が保存される。

### S-7: 修正前の既存行を再インポートで補正する

- **given**: 修正前に作られた同じaccount/date/slotのmutable rowがある。
- **when**: 修正後のreview pack importを再実行する。
- **then**: rowは新しいJST変換後の `scheduled_at` に更新される。公開済みrowは更新されずskipされる。

### S-8: review packへcanonical tenant bindingを付ける

- **given**: deployment-local設定にcanonical tenant ID、revision、resource object type、resource IDがある。
- **when**: production import CLIを実行する。
- **then**: 全draftの`evidence.tenant_boundary`へbindingが永続化され、設定欠落時はHTTP送信前に停止する。

### S-9: 公開前にbackground job認可する

- **given**: due rowにcanonical bindingがあり、tenant runtimeとPostgreSQL gatewayが到達可能である。
- **when**: public runnerを実行する。
- **then**: `entry_point=background_job`認可がclaim／provider呼出しより先に成功した場合だけ投稿する。

### S-10: 対話APIから直接公開しない

- **given**: 認証・tenant context付きのoperatorがSNS publish endpointを呼ぶ。
- **when**: `dry_run=true`でない公開要求を送る。
- **then**: `sns_direct_public_publish_disabled`で拒否し、claim、Ledger mutation、provider呼出しを行わない。

### S-11: production DB未設定でfail closedにする

- **given**: production runtimeにSNS Ledger用PostgreSQL URLがない。
- **when**: SNS Ledger APIを呼ぶ。
- **then**: `sns_posting_ledger_database_required`を503で返し、JSON fileとprovider副作用を生成しない。

## Anti-patterns

- **AP-1**: runnerが `SnsLedgerPublishService` を迂回してX投稿スクリプトを直接呼ぶ。
- **AP-2**: `approved` の投稿をrunnerが自動投稿する。
- **AP-3**: 自動投稿フラグなしで本番投稿する。
- **AP-4**: 失敗した投稿をUIから見えない状態にする。
- **AP-5**: JST/UTCを暗黙に扱い、slot時刻と実行時刻がずれる。
- **AP-6**: デプロイだけで既存Ledger rowの `scheduled_at` が補正されたとみなす。
- **AP-7**: tenant env欠落を既定tenant、account ID、workspace ID、project codeから補完する。
- **AP-8**: tenant bindingの認可より前にrowをclaimする、またはX providerを呼ぶ。
- **AP-9**: 対話APIの`confirm_public_post`でclaim／fencingを迂回する。
- **AP-10**: production DB未設定をJSON file repositoryで継続する。

## Verification

| Clause | Test | Status |
|---|---|---|
| INV-1, S-1 | tests/sns/scheduled-publisher/sns-scheduled-publisher.test.js | ✅ |
| INV-2, S-2, AP-3 | tests/sns/scheduled-publisher/sns-scheduled-publisher.test.js | ✅ |
| INV-3, AP-1 | tests/sns/scheduled-publisher/sns-scheduled-publisher.test.js | ✅ |
| INV-4, S-3 | tests/sns/scheduled-publisher/sns-scheduled-publisher.test.js | ✅ |
| INV-5, AP-5 | tests/sns/scheduled-publisher/sns-scheduled-publisher.test.js | ✅ |
| INV-6, S-5, AP-4 | tests/sns/scheduled-publisher/sns-scheduled-publisher.test.js | ✅ |
| INV-7, S-4 | tests/sns/ops/run-sns-scheduled-posts.test.js | ✅ |
| INV-8, S-6 | tests/sns/posting-ledger/posting-ledger-repository.test.js, tests/e2e/str-brainbase-sns-scheduled-publisher-jst.spec.ts | ✅ |
| INV-9, S-7, AP-6 | tests/sns/posting-ledger/posting-ledger-repository.test.js, docs/runbooks/sns-scheduled-publisher.md | ✅ |
| INV-10, S-8, AP-7 | tests/sns/ops/import-sns-review-pack-to-ledger.test.js, tests/sns/posting-ledger/posting-ledger-repository.test.js | ✅ |
| INV-11, S-9, AP-8 | tests/sns/ops/run-sns-scheduled-posts.test.js, tests/sns/scheduled-publisher/sns-scheduled-publisher.test.js, tests/e2e/str-brainbase-sns-scheduled-publisher-jst.spec.ts | ✅ |
| INV-12, S-10, AP-9 | tests/server/routes/sns-growth.test.js, tests/server/bootstrap/sns-growth-production-boundary.test.js | ✅ |
| INV-13, S-11, AP-10 | tests/server/bootstrap/sns-posting-ledger-runtime-config.test.js, tests/server/bootstrap/sns-growth-production-boundary.test.js | ✅ |
