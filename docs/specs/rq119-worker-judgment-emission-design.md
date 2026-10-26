# RQ-119 設計書: Worker の判断を組織版の判断履歴に届ける

状態: 設計（Planned）。実装・テストは本書に含めない。
対象読者: Director とレビュアー。
関連: RQ-116（judgment の記録を journal ファイルから DB へ寄せる）、RQ-120（Mac relay の owner 資格失効）。
根拠は原則としてファイルパスと行番号で示す。確証のない箇所は「推測」と明記する。秘密の値（owner JWT、person_id/tenant_id の実値、bearer）は書かない。

---

## 1. 目的と範囲

### 目的
Worker（Claude Code と DeepSeek(opencode 経由)）が下す判断を、Codex hook と同じ判断の形・契約で、組織版の判断履歴（judgment history）に届ける。

### 背景（なぜ必要か）
- 組織版の判断履歴は 2026-10-19 23:53 JST を最後に増えていない（`/workspace/prod-20261026/journal-2508/judgment-history-stall-20261026.md:1-9`）。
- 直接原因は Mac の Codex hook → 公開 relay が `judgment_public_relay_owner_auth_expired` で失敗し続けていること（同:2,6、RQ-120 で別対応）。
- しかし構造上の原因は、判断を履歴に送る経路が **Codex hook だけ** であること。box（Linux）上で動く Worker（Claude Code / opencode）の判断は、そもそもどこにも送られていない（同:8 の副因＝Codex 利用激減とあわせ、Codex が止まれば履歴も止まる単一経路）。

### やること
- Worker が判断を出す箇所（Claude Code hook / opencode プラグイン）を特定し、そこから共通の送り口へ渡す設計。
- 共通の送り口（brainbase に置く1つのモジュール/CLI）＋道具ごとの薄いアダプタ。
- 保存先（RQ-116 の DB `judgment_receipts` を使う案 vs 既存 public relay を通す案）の比較と推奨。
- Worker 用の認証（本人 JWT に頼らないサービス/AI メンバー資格）、冪等性、失敗時保持、バックフィルしない方針。

### やらないこと
- 実装・テストコード（本書は設計のみ）。
- 過去に失敗した Codex の 36 件の再送（佐藤さんが判断。`judgment-history-stall-20261026.md:6`）。
- Worker の過去（本機能稼働前）の判断のバックフィル。
- Mac relay の owner 資格情報の修復（RQ-120）。
- OSS を単一所有者・ローカルファーストから外す変更（CLAUDE.md の境界を維持）。

---

## 2. 今の流れ（Codex hook → 履歴）

### 2.1 送り手（Codex hook、`/workspace/repos/brainbase-unson/scripts/codex-hooks/`）
1. `judgment-resolver-entry.sh` がエントリ。journal ディレクトリ env を決め（`:16-30`、既定 `~/.codex/var/judgment-resolver`）、`record_only` でなければ `judgment-resolver-host.mjs` を node で起動（`:32-36`, `:90-94`）。
2. `judgment-resolver-host.mjs`:
   - journal 置き場: `journalRoot(env)` が `BRAINBASE_JUDGMENT_JOURNAL_DIR` を読む（`:1413-1417`）。turn 別のファイル群を `journalPaths()` が決める（`:1419-1442`）。1 turn ＝ `<sessionRef>/<sha256(turnId)>.{episode,final,events,…}.json`。公開 relay の outbox は `…public-relay.json`（`:1440`）。
   - entrypoint のタグ付け: `runtime.entrypoint = historyEntrypointForEnvironment(env)`（`:1802-1804`）。既定は `'codex'`、env `BRAINBASE_JUDGMENT_ENTRYPOINT` / `BRAINBASE_JUDGMENT_HOST_RUNTIME` で上書き（`:5926-5939`）。
   - session_id / turn_id は hook payload から取得し、`sessionRef=sha256(session_id)` / `turnRef=sha256(turn_id)`（`:705-709`, `:1421`）。
   - `Stop` イベントで `finalizeEpisode()` が episode/final/events を確定（`:9149`、`createImmutableJson` for final `:7531-7533`）、続いて `relayFinalizedPublicJudgment()` を呼ぶ（`:9166`、ラッパ `:8885-8928`、実呼び出し `:8901`）。
3. `judgment-public-relay.mjs`:
   - 確定済みの episode/final/events から公開エンベロープ（`public_frame` = summary/reason/selected_references/alternatives のみ）を組む（`safeEnvelope` `:445-508`、`buildPublicProjectionEnvelope` `:510-523`）。
   - owner 資格を読む: `loadOwnerAuthorization`（`:315-389`）が組織クライアントの JWT を読み、`/api/auth/verify` で scope を確認（`verifyOwnerScope` `:252-311`、endpoint `:263-264`）。**ここが失敗点**: token 期限切れで `judgment_public_relay_owner_auth_expired`（`:376`）、または 401/403 で同（`:295`）。
   - 送信先は `PUBLIC_RELAY_PATH = /api/organization/judgment-history/public-projections`（`:24`）。POST（`:807-812`）。outbox に `pending/attempts/failed/saved` を記録、次の hook で再試行、最大 3（`PUBLIC_RELAY_MAX_ATTEMPTS` `:25`、retry 判定 `:748`, `:803-824`, `:836-849`）。
   - 公開 relay の有効化は `~/.codex/judgment-public-relay.json`（`judgment-public-relay-config.mjs:8`）＋ `enabled/effective_after/repo_project_bindings/owner_scope/organization_client_*` が揃うこと（`:272`）。

### 2.2 proxy / route（brainbase-unson → 組織版）
- `/workspace/repos/brainbase-unson/server/routes/organization-judgment-history-public-projections.js:8` は再エクスポートの互換 shim。正本は組織版 server-parts。

### 2.3 受け手と保存（`/workspace/repos/brainbase-organization/packages/server-parts/`）
- route: `organization-judgment-history/public-projection-route.js`
  - パス `:16-17`。`requireAuth` を必須（`:378`, `:388`）。**人の認証のみ受理**: `PERSON_AUTH_SOURCES = {bearer, cookie}`（`:19`, `:391`）、`publicScopeFromAccess(req.access)`（`:393`）。
  - 書き込み前に grant を再確認（`resolveCurrentAccess` `:418-440`、`createPublicProjectionAccessResolver` `:83-161`）。
  - receipt 行を照合: `receiptRepository.findByResolutionId(resolution_id)`（`:447`）→ `receiptMatchesScope`（`:214-257`、turn_ref/session_ref/digest/recorded_at を検証）。
  - 検証を通れば projection を永続化（`:470-488`）。
- 保存は **DB ではなくファイルシステム**: `public-projection-store.js` の `createHostJournalPublicProjection`（`:843`）が journal root 下の `public-frame/<scopeKey>/<turnHash>.json` ＋ index ＋ scope-index に immutable 書き込み（`write` `:885-1051`、`readPartition` 読み出し `:1170-1263`）。本番 VM の `public-frame/index.json` の mtime が 10/19 で止まっている（`judgment-history-stall-20261026.md:4`）のはこのファイル群。
- 契約: `public-projection.js`
  - **entrypoint は 'codex' 固定**: `PUBLIC_PROJECTION_ENTRYPOINT = 'codex'`（`:17`）、`buildPublicProjection` が常に codex を書く（`:353`）。relay 側 readback も `projection.entrypoint !== 'codex'` を拒否（`judgment-public-relay.mjs:631`）。
  - record の一意キー: `publicProjectionRecordId`（`:384`）→ `contract.js` の `recordId(binding, source_identity)` = `{organization_id, tenant_id, owner_person_id, project_code, turn_ref, source_identity}` の digest（`contract.js:73-83`）。
- 別系統の受領（RQ-116 の表）: `judgment_receipts`（下記 §4）。これは `/api/judgment/resolve` から書かれ、public-projections の検証材料になる。

### 2.4 まとめ（今の単一経路）
`Codex Stop → host が journal ファイル → relay が owner JWT で POST → 組織版が receipt 行で照合 → public-frame ファイルに projection → 履歴表示`。
Worker はこの経路のどこにも接続していない。履歴表示の正本は public-frame ファイル（DB ではない）。

---

## 3. Worker の道具がどう判断を出すか

### 3.1 共通の送り口（brainbase に1つ）
- 置き場: このリポジトリ **brainbase**。judgment-harness の最終所在は brainbase（`/workspace/repos/brainbase-unson/docs/contracts/repository-ownership.json` judgment-harness `:174-214`、`final_repository: "brainbase"` `:176`）。CLAUDE.md の「共通部品はコピーせず所有するリポジトリで変更」にも一致。
- 役割: 入力（道具・session・turn・判断内容）から、Codex hook と同じ判断の形（共有 record 契約 `src/judgment-history.ts:77-89`、`JUDGMENT_HISTORY_RECORD_SCHEMA`／`public_frame` = summary/reason/selected_references/alternatives）を作り、
  1. ローカルの outbox/journal に先に書き（失敗時保持。§7）、
  2. 送信ポート（transport）に渡す。送信ポート自体は注入（OSS 既定はローカルのみ。組織版が「DB へ送る」実装を注入。§4・CLAUDE.md の OSS 境界）。
- 出力契約（Codex と同形にする要点）:
  - `entrypoint`: 道具を表す値（`claude_code` は既存。opencode/DeepSeek 用は新規。§9 の未決事項）。
  - `resolution_id`: §6 の冪等キーから決定的に導出。
  - `turn_ref`: `sha256(session) / sha256(turn)`（既存 `TURN_REF = /^[a-f0-9]{64}\/[a-f0-9]{64}$/`、`contract.js:15`）。
  - `public_frame`: 秘密を含めない（`public-projection.js` の `CREDENTIAL_PATTERN`/制御文字拒否 `:85-86`、長さ上限 `:18` と同じ受理境界に合わせる）。

### 3.2 道具ごとの薄いアダプタ
どちらも box（Linux）上で動く。Mac keychain / owner JWT は使わない。

- Claude Code（`~/.claude/settings.json` の hooks 機能）
  - 使うイベント（推測、`claude-code-hooks-gotchas` Skill 参照推奨）: `UserPromptSubmit` で turn を開始、`Stop`（応答完了）で判断を確定して送る。`PreToolUse`/`PostToolUse` は参照・実行の痕跡として任意。
  - アダプタの仕事: hook が渡す session_id / turn / プロンプト・結果から、共通送り口の入力に詰め替えるだけ。判断本文（summary/reason 等）は Claude Code 側で生成した判断フレームを使う。
  - entrypoint = `claude_code`（`contract.js:7` と `src/judgment-history.ts:11-17` に既存）。
  - 注意（既知の罠）: Claude hooks が `npx tsx` を呼ぶと runner/worktree で失敗する（Skill `brainbase-claude-hooks-that-call-npx-tsx-fail-…`）。共通送り口はビルド済み node スクリプト/CLI として呼ぶ。

- DeepSeek（opencode 経由）
  - 使う仕組み（推測）: opencode のプラグイン/イベント機能で turn 完了フックを取り、共通送り口を呼ぶ。opencode のイベント名・プラグイン API は未確認（§9 で確認課題）。
  - entrypoint = 新規値（例 `opencode`。実モデルが DeepSeek であることは record 本文/メタで表す案と、entrypoint を分ける案の2択。§9）。

- 原則: アダプタはイベント取得と詰め替えのみ。認証・冪等・送信・失敗保持のロジックは共通送り口に1本化する。

---

## 4. 履歴の保存先までの道筋（2案比較と推奨）

### 前提（RQ-116 の表と一意キー）
- 表: `judgment_receipts`（`/workspace/repos/brainbase-organization/packages/server-parts/judgment-receipt-store/judgment-receipt-schema.sql:4-16`）。列: `organization_id, project_code, owner_person_id, resolution_id, turn_id, receipt(JSONB), created_at`。
- 一意キー: `UNIQUE (organization_id, project_code, owner_person_id, resolution_id)`（同 `:12`）。
- 書き込み: `judgment-receipt-postgres-repository.js` の `record(receipt, actor)` が `ON CONFLICT … DO NOTHING`（`:113-134`, 衝突句 `:123`）＝冪等・追記のみ。RLS で owner/project/org にスコープ（schema `:33-58`、`withOwnerContext` `:89-111`）。
- 既存の書き込み経路: `/api/judgment/resolve` が `receiptWriter.record(receipt, receiptAccess)` を呼ぶ（`judgment-resolution-host-mount/judgment-resolution.js:125-163`, 呼び出し `:147`）。※行番号はサブ調査に基づく。
- RQ-119 では **この同じ表・同じ一意キー** を使う（指示どおり）。

### 案A: RQ-116 の DB に直接書く（推奨）
Worker → 共通送り口 → 組織版 transport → サービス資格付きの判断受領エンドポイント → `judgment_receipts` に `record()`（冪等）。履歴表示は RQ-116 で DB から投影（Codex も Worker も同一表から読む）。

- 長所:
  - owner JWT（人）に依存しない。Worker 用のサービス/AI メンバー資格で済む（§5）。RQ-120 の失効問題から切り離せる。
  - `judgment_receipts` の一意キーがそのまま冪等キー（§6）。`ON CONFLICT DO NOTHING` で再送しても二重にならない。
  - entrypoint が `codex` 固定の public-projection 契約（`public-projection.js:17,353`）を迂回できる。Worker の entrypoint を表の receipt/投影に素直に載せられる。
  - box で完結（Mac 固有経路を使わない）。
- 短所/前提:
  - 「DB から履歴を投影して表示する」読み出しは RQ-116 の作業であり **現状は未実装（Planned）**。本番 VM の履歴正本は今なお public-frame ファイル（§2.3）。RQ-119 の価値は RQ-116 の投影読み出しとセットで初めて見える。
  - サービス資格の受領エンドポイント（非 person 認証）が必要（§5）。現 route は person のみ受理（`public-projection-route.js:19,391`）。

### 案B: 既存 public relay を通す
Worker → episode/final/events を Codex と同形で生成 → `relayFinalizedJudgment` → `/api/organization/judgment-history/public-projections` に POST。

- 長所: 送信〜照合〜projection の既存実装をそのまま使える。public_frame の秘密除去も既存。
- 短所（いずれも重い）:
  - 認証が owner（人）JWT 前提: route が `PERSON_AUTH_SOURCES={bearer,cookie}`＋`publicScopeFromAccess`（per_ の person）を要求（`public-projection-route.js:19,391-396`）。Worker は人ではなく、box に owner JWT は無い。受理するには受け手を改造するしかなく、それは実質 案A と同じ新口になる。
  - entrypoint が `codex` 固定: projection 契約（`public-projection.js:17,353`）と relay readback（`judgment-public-relay.mjs:631`）が codex 以外を拒否。Worker を表現できない。
  - 保存先がファイル（public-frame）で DB ではない → RQ-116 と逆行。「同じ表・同じ一意キーを使う」指示に反する。
  - RQ-120 の owner 失効と同じ資格面に縛られる。

### 推奨
**案A**。理由: (1) 本人 JWT 非依存で Worker に適合、(2) RQ-116 の同一表・同一一意キーをそのまま冪等境界に使える、(3) entrypoint 固定の public-projection 契約を迂回でき Worker を素直に表せる、(4) RQ-120 から独立、(5) box 完結。
ただし「履歴として見える」ためには RQ-116 の DB 投影読み出しが前提であり、これは Planned。RQ-119 は案A の書き込み側を担い、RQ-116 の読み出し側と同一表で突き合わせる。

---

## 5. 認証（本人 JWT に頼らない）

- 原則: Worker は人ではない。Codex relay が使う owner JWT（`loadOwnerAuthorization` → `/api/auth/verify` → person scope、`judgment-public-relay.mjs:315-389`）を Worker に流用しない。失効時の挙動（`:376,295`）も RQ-120 の資格に属する問題で、RQ-119 の経路に持ち込まない。
- 使うもの: 組織版の **AI メンバー/サービス資格（agent credential）**。
  - scope 限定: 1 組織・1 テナント・特定 project に限定（Worker ごと、または Worker 群で1つ）。`judgment_receipts` の RLS（org/project/owner、schema `:33-58`）と整合する scope を持たせる。
  - owner_person_id の扱い: `judgment_receipts` は `owner_person_id` を要求（`:12`）。Worker の判断を「どの人の判断力の延長か」を表す person に束ねる（例: その project の owner＝佐藤さん）か、Worker 専用の agent 主体 id を持たせるかは **未決（§9）**。どちらでも一意キーが成立すること、RLS を通ることが条件。
  - 期限と更新: サービス資格は短期トークン＋更新（rotation）。失効時は §7 のとおり黙って捨てず保持・再送、状態を可視化。
    - 教訓（2026-10-26 判明）: 今の Codex relay が止まった根本原因は、organization-client の access token が 1 時間で切れ（`expires_in` 既定 3600）、relay は `tokenIsCurrent` で確かめるだけで更新しないこと（unson `judgment-public-relay.mjs:362-377`、org `organization-client/src/index.mjs:292-297`。更新は CLI `refresh` `:1387-1455` のみ）。Worker の送り口は **送る前に必ず更新を試す**（RQ-120 で組織版 organization-client に足す `ensureCurrentToken` 相当を使う）。更新もできないときは §7 の outbox 保持＋理由コード（例 `organization_client_token_refresh_failed`）で可視化する。
  - 置き場: box 上の秘密置き場（Infisical 等の正規経路。Skill `brainbase-infisical-env-management`）。ファイルで置く場合は owner 限定・0600・symlink 拒否（Codex 側 config の作法 `judgment-public-relay-config.mjs:225-254` に倣う）。
  - ログ規則: トークン/bearer/person の実値、プロンプト全文、ツール応答をログ・outbox に出さない（既存 outbox も envelope と digest のみ `judgment-public-relay.mjs:698-701`）。失敗は理由コード（`judgment_*` 形）だけ出す。
- 受け手側（組織版）: 非 person（agent）認証を受理する判断受領エンドポイントが必要。現 person 専用 route（`public-projection-route.js:19,391`）とは別口にする。組織版の auth service（grant/`buildAccessFromGrant` 等、`public-projection-route.js:92-120` が参照する port）で agent 資格を検証する想定。**agent credential の正確な仕組みは本調査で未確認＝推測。§9 で確認。**

---

## 6. 冪等性

- 一意キー: `judgment_receipts` の `UNIQUE (organization_id, project_code, owner_person_id, resolution_id)`（schema `:12`）をそのまま使う。再送は `ON CONFLICT DO NOTHING`（repository `:123`）で二重にならない。
- `resolution_id` の決定的導出: 指示の「道具・セッション・ターン・内容ハッシュ」から決定的に作る。案:
  `resolution_id = f(entrypoint/tool, session_id, turn_id, content_digest)`（例: これらの canonical JSON の sha256 を安全なコード形 `SAFE_CODE`〈`judgment-public-relay.mjs:32`〉に収める）。
  - 同じ turn・同じ内容なら同じ `resolution_id` → 再送は冪等。
  - 同じ turn で内容が変わった場合（判断の訂正）は別 `resolution_id` になり別 record。訂正の表現は既存の feedback イベント（`src/judgment-history.ts:28-45` の `JudgmentHistoryFeedbackEvent`、kind=correction）に寄せる案を検討（§9）。
- 順序: 追記のみ・immutable（schema のトリガで UPDATE/DELETE 禁止、repository の immutable 衝突 `:129-131`）。表示順は `recorded_at`（receipt の `resolved_at` 相当）で決める。到着順には依存しない。
- content_digest: 判断本文（public_frame 相当）の canonical JSON ハッシュ。秘密は含めない。

---

## 7. 失敗時（黙って捨てない）

RQ-120 と同じ扱い＝保持して再送、状態を見えるように。

- ローカル outbox: 共通送り口は送信前にローカル outbox（Worker 用、Codex の `…public-relay.json` 相当）へ `pending/attempts/status/envelope-digest` を書く。Codex の outbox 設計（`judgment-public-relay.mjs:703-876`、原子的書き込み `persistOutbox:420-438`、envelope と digest のみ）を踏襲。
- 再試行: 次の Worker 実行（次 turn の hook/プラグイン発火）で outbox を読み、`pending` を再送。有限回で上限（Codex は最大3 `:25,748`）。transport/5xx/429 は再試行、401/403・契約拒否は即停止（Codex の分岐 `:826-849` に準拠）。
- 可視化: 失敗は理由コード（`judgment_*`）を残し、Director が状態を確認できる場所に出す（outbox の件数・最終状態）。本番 staging は Cloud Run `/tmp` が残らない点に注意（`judgment-history-stall-20261026.md` 背景の RQ-116 と同根）。outbox もローカルファイル依存なら揮発する → DB 側に「未送信/失敗」を持てないか RQ-116 とあわせ検討（§9）。
- 秘密: outbox・ログにトークン/プロンプト/応答を残さない（§5）。

---

## 8. バックフィルしない

- 過去の Codex 失敗 36 件（`judgment-history-stall-20261026.md:6`、すべて owner_auth_expired/attempts 0）は再送しない。佐藤さんが判断（指示）。本設計に再送・republish・過去走査を入れない（relay の運用方針とも一致: `docs/runbooks/judgment-history-public-relay.md` の「無限リトライ・手動 republish・過去履歴の再走査をしない」方針）。
- Worker の過去（本機能稼働前）の判断もバックフィルしない。Codex と同様に `effective_after`（ISO 時刻）境界を設け、境界より前の turn/受領時刻は送らない（Codex は `effective_after` を envelope 条件にしている `judgment-public-relay.mjs:475-479`）。Worker 用も同じ考え方で、稼働開始時刻以降のみ対象。

---

## 9. 段階的な進め方と Director の未決事項

### Story 分割（それぞれ受入条件＋テスト方針）

- **S1: 共通送り口（brainbase）の契約と骨格**
  - 内容: 入力（tool/session/turn/判断内容）→ 共有 record 契約＋`resolution_id` 決定的導出＋public_frame 秘密除去。送信ポートは注入（OSS 既定はローカル outbox のみ）。
  - 受入: 同一入力で同一 `resolution_id`・同一 envelope。秘密混入入力は拒否/除去。OSS 単体で organization なしに動く（CLAUDE.md 境界）。
  - テスト: 契約の単体テスト（record 形・一意キー・冪等導出・秘密除去）。既存 `src/judgment-history.ts` の record 契約に対する適合。

- **S2: Claude Code アダプタ（薄い）**
  - 内容: `~/.claude/settings.json` hooks（UserPromptSubmit/Stop）→ 共通送り口。entrypoint=`claude_code`。
  - 受入: 1 turn で outbox に1件、entrypoint 正。`npx tsx` 罠を踏まない呼び出し。
  - テスト: hook payload 固定入力→ outbox 内容の検証（送信はモック）。

- **S3: opencode(DeepSeek) アダプタ（薄い）**
  - 内容: opencode プラグイン/イベント → 共通送り口。entrypoint は S0 決定値。
  - 受入: 1 turn で outbox に1件。
  - テスト: イベント固定入力→ outbox 検証。前提: opencode イベント API の確認（下記 Q）。

- **S4: 組織版 transport ＋ サービス資格受領エンドポイント（案A）**
  - 内容: 非 person（agent）資格で認証し `judgment_receipts.record()` を呼ぶ受領口。scope 限定・期限・失効時 403。
  - 受入: 正資格で saved、再送で冪等（二重にならない）、失効資格で 403・outbox は保持。owner JWT を要求しない。
  - テスト: 受領口の結合テスト（冪等・RLS・資格失効）。`ON CONFLICT DO NOTHING` の確認。

- **S5: 失敗保持と可視化（RQ-120 と同作法）**
  - 内容: outbox の pending/retry/上限、状態の可視化。
  - 受入: transport 失敗で pending 保持→次回再送、上限で failed、理由コードが残る。
  - テスト: 失敗注入でのリトライ/上限/可視化。

- **S6（RQ-116 連携・読み出し）**: `judgment_receipts` から履歴を投影して Codex と Worker を同一表示。RQ-116 の Story として進め、同一表・同一一意キーで突き合わせる。RQ-119 単独では表示まで到達しないことを明記。

### Director が確かめるべき未決事項
1. **entrypoint 値**: DeepSeek(opencode) の entrypoint を新設するか（例 `opencode`）、`claude_code` と同様に enum（`contract.js:7`、`src/judgment-history.ts:11-17`）へ追加するか。追加は共有契約の変更＝影響範囲の合意が必要。実モデル名（DeepSeek）を entrypoint で表すか record 本文で表すか。
2. **owner_person_id の帰属**: Worker 判断を project owner（佐藤さん）に束ねるか、Worker 専用の agent 主体 id にするか。`judgment_receipts` の一意キー・RLS が成立する前提で選ぶ。
3. **agent credential の仕組み**: 組織版 auth service が agent（非 person）資格を発行・検証できるか、scope/期限/更新/失効の具体。本調査では未確認（推測）。
4. **保存先の確定**: 案A（DB 直書き、推奨）で合意するか。履歴表示は RQ-116 の DB 投影が前提である点の了解。
5. **outbox の置き場**: staging の Cloud Run `/tmp` 揮発を踏まえ、未送信/失敗状態を DB に持てるか（RQ-116 と統合するか）。
6. **判断の訂正表現**: 同一 turn の再判断を別 `resolution_id` にするか、feedback イベント（kind=correction、`src/judgment-history.ts:28-45`）に寄せるか。
7. **opencode の確認課題**: opencode のプラグイン/イベント API 名と発火タイミング（本調査では未確認＝推測）。

### 推測の明示
- Claude Code / opencode の具体的なフックイベント名・発火タイミングは本調査で未確認（§3.2）＝推測。
- 組織版の agent credential 発行・検証の正確な仕組みは未確認（§5）＝推測。
- `/api/judgment/resolve` の receiptWriter 周りの行番号はサブ調査に基づく（§4）。

---

## 変更範囲の確認
本作業で変更したファイルは本書 1 ファイルのみ:
`docs/specs/rq119-worker-judgment-emission-design.md`。
コード・テスト・他ドキュメントは変更していない。
