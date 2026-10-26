# 受信箱の待ち日数を「番になってから」数える（RQ-121 T10 調査）

要件: RQ-121(要件台帳 sheetId 710612730「組織版の受信箱を A 案『今日決めること1画面型』に作り直す」)。
受入条件のうち「各行が『決めること』の問い+依頼者+待ち日数で出る」の **待ち日数** を、
作成日ではなく **その行が今の担当者の番になった日** から数えたい。

分割表 T10: 「待ち日数を『番になってから』に(assigned_at か状態の履歴から)。履歴から出せるなら migration 不要。要調査。
受入『作成日ではなく番が来た日から数える』」。

この文書は T10 の調査結果である。結論は **migration が必要**。したがって読み取り経路と `ui/inbox.js`
への実装は行わず、何が足りないか・何を足せばよいか・npm 公開の要否だけを記録する。

## いま何が起きているか

- `ui/inbox.js` の `layout: 'today'` は `waitingDays(item.receivedAt, now)`
  (`ui/inbox.js:557`、関数は `ui/inbox.js:252`) で、`receivedAt` から今日までを日単位で切り捨てて
  「待ち <days>日」を出す。仕様は `docs/specs/inbox-stage1.md:128`。
- `receivedAt` は共通UIが取りに行く値ではなく、ホストが渡す読み取り契約の値
  (`docs/specs/inbox-stage1.md:28` の `InboxItem.receivedAt`)。組織版ではタスクの **作成日** が入る。
- よって「番になった日」を出すには、ホストが `receivedAt` とは別に「番になった時刻」を
  受信箱の行へ渡せること、つまり canonical task の読み取り応答がその時刻を持っていることが要る。

## 調べた問い

既存の監査の記録(`canonical_task.updated` の担当者変更、`canonical_task.transitioned`)から、
**今の担当者の番になった時刻** を migration なしで、既存の読み取り経路に乗せて出せるか。

## 調べた結果（どの記録で足りないか）

### 1. 監査の記録は書き込み専用で、読み取り API が無い
`CanonicalTaskAuditRepository` が持つのは `upsertAuditLog` だけ
(`src/canonical-task-service.ts:217-224`)。一覧・取得・問い合わせのメソッドは無い。
読み取り経路(`listTasks` / `searchTasks` / `getTask`、`src/canonical-task-service.ts:755-800`)は
`CanonicalTaskRepository`(現在のタスク行)だけを読み、監査の履歴は一切読まない。
→ 既存の読み取り経路から監査の履歴に到達する手段が無い。

### 2. 監査の記録に、OSS 契約として時刻の列が無い
`CanonicalTaskAuditEntry`(`src/canonical-task-service.ts:177-190`)に `created_at` 等の時刻が無い。
時刻を足すかどうかはホストのリポジトリ任せで、OSS の契約に含まれない。
→ 仮に履歴を読めても「番になった時刻」を OSS 側で確定できない。

### 3. 監査の記録は操作指紋で upsert される冪等な行で、順序付きの出来事の列ではない
監査行の `id` は操作の指紋から作る再実行キー
(`src/canonical-task-service.ts:1516-1520`)。再試行は同じ行を upsert する。
担当者がどの順で変わったかを並べて「最後に今の担当者になった時刻」を取り出す、という
出来事の履歴としての保証(順序・一意な出来事・時刻)が OSS 契約に無い。

### 4. OSS の SSOT に監査のテーブルが無い
`contracts/canonical-task/store-schema.sql` にあるのは `canonical_tasks` だけで、監査のテーブルは無い。
監査のテーブル・その時刻・索引はホスト/組織側のアダプタにあり、OSS の canonical task ストアには無い。
→ 担当者の変更履歴を問い合わせる、時刻付き・索引付きの表が OSS 側に存在しない。

### 5. `canonical_tasks` に「番になった時刻」の列が無い
列は `created_at`(作成)と `updated_at`(更新のたびに更新される)だけ
(`contracts/canonical-task/store-schema.sql:23-24`)。`assigned_at` や `turn_started_at` は無い。
時刻を持つ他の列(`due_at` / `review_at` / `completed_at` / `claimed_until`)はどれも
「今の担当者の番が始まった時刻」ではない。`updated_at` はどんな更新でも動くので使えない。
担当者変更(`fields.assignee_person_id`)や状態遷移(`transition.to_status`)の情報は
監査の `changes` に概念としては入る(`src/canonical-task-service.ts:1268-1283`)が、
読める・時刻付き・並べられる形では保存されていない。

## 結論: migration が必要

「番になった時刻」を既存の読み取り経路に乗せるには、**読める・時刻付きの新しい保存状態** が要る。
今ある監査の記録だけでは、(a) 読み取り API が無い、(b) 時刻が OSS 契約に無い、
(c) 出来事の履歴としての順序保証が無い、(d) OSS の SSOT に表が無い、の 4 点で足りない。
よって T10 の「履歴から出せるなら migration 不要」は満たさず、migration が要る。

実装を今回のキューで行わない理由はもう一つある。必要な変更は
`contracts/canonical-task/store-schema.sql`(DB 定義・migration)とホストのアダプタに及ぶが、
これらは今回の変更許可の範囲外(読み取りまわり・`ui/inbox.js`・`docs/specs/`・`tests/` のみ)である。

## 必要な列や表（どちらかの案）

### 案A（推奨・小さい）: `canonical_tasks` に時刻列を1本足す
- `canonical_tasks` に `turn_started_at TIMESTAMPTZ`(名前は仮)を足す。
- 作成時と `assignee_person_id` が変わったときに `NOW()` を書く(アダプタの書き込みロジック)。
  担当者が変わらない他の更新では動かさない。
- 既存行の初期値は `created_at` を入れる(= 今までどおり作成日基準にフォールバックできる)。
- 読み取り応答に乗せる: `CanonicalTaskRecord` に `turn_started_at` を足し、`normalizeResponse`
  (`src/canonical-task-service.ts:1578`)で未定義を `null` に正規化。ホストがこれを受信箱の
  新しい値(例: `InboxItem.turnStartedAt`)へ写す。
- `ui/inbox.js` は `waitingDays(item.turnStartedAt ?? item.receivedAt, now)` のように、
  値があればそれ、無ければ従来どおり `receivedAt` から数える。
- 長所: 読み取りが1行の取得で済む。索引不要(行に載る)。履歴の全スキャンが要らない。
- 短所: 「番になった時刻」= 担当者が最後に変わった時刻、という近似。細かい状態遷移までは表さない。

### 案B（重い）: 時刻付き・追記専用の監査/出来事テーブル + 読み取り API
- 監査を順序付き・時刻付き・索引付き(`(target_id, recorded_at)`)の追記テーブルにし、
  `CanonicalTaskAuditRepository` に読み取り(`listAuditLog(targetId)` 等)を足す。
- サービスが履歴を読み、「最後に今の担当者になった時刻」を計算して読み取り応答に足す。
- 長所: 担当者変更以外の遷移基準にも将来広げられる。
- 短所: 監査契約・アダプタ・索引・冪等 upsert から出来事ログへの作り直しが要り、案Aより大きい。
  読み取りごとに履歴問い合わせが要る。

どちらも `contracts/canonical-task/store-schema.sql` とホストのアダプタを変える migration を伴う。
推奨は案A。

## npm 公開の要否

要る。`@unson/brainbase-mcp` の `CanonicalTaskRecord` / `normalizeResponse` に新しい時刻を足すと、
組織版が読み取り応答からその時刻を受け取るには **公開済みの OSS パッケージの更新** が要る
(組織版は OSS を consume する。`CLAUDE.md`「Organization products must consume and extend the OSS UI」)。
`ui/inbox.js` 側の変更だけは公開に依存しないが、ホストが新しい時刻を渡せないと値は出ないので、
実効的には OSS の読み取り契約の更新 → npm 公開 → 組織版の取り込み、の順が要る。
公開は `brainbase-npm-publish` / `npm-package-publish` の承認フローに従う(本タスクでは行わない)。

## 今回やらないこと（範囲外・未実装）

- `contracts/canonical-task/store-schema.sql` の列追加・migration。
- ホストのアダプタ(PostgreSQL 等)の書き込み・読み取りの実装。
- `src/canonical-task-service.ts` への `turn_started_at` の追加、`ui/inbox.js` の待ち日数の変更。
- npm 公開、組織版 `brainbase-organization` 側の受信箱マッピング。

これらは案A/案Bの承認後、別のキューで DB 定義の変更許可を取ってから行う。
本文書は T10 の調査結果の記録であり、実装の承認ではない。
