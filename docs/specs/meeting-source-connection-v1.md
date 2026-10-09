---
spec_id: meeting-source-connection-v1
story_id: story-meeting-source-connection-sync-v1
status: draft
owner_repository: brainbase
export: "@unson/brainbase-mcp/meeting-source-connection"
depends_on: [meeting-source-reader-v1]
---

# 会議ソースの接続と接続ごとの同期 v1 仕様

## 目的

同じPlaudやTactiqを複数のアカウントでつないでも、資格情報・読んだ位置・全文待ち・失敗・受け渡しが接続ごとに分かれるようにする。接続の実行部分（`ConnectionRuntime`）は差し替えられ、読み出し（`meeting-source-reader-v1`）と同期の手順は変わらない。

## 境界

- 接続の記録・資格情報・同期の状態の保存先、テナントと持ち主の認可、同期を定期的に動かす場所、全文の受け渡し先は、差し込み口として利用側（組織版）が持つ。
- 全文は受け渡し先へ渡すだけで、同期の状態には貯めない。状態に残すのは会議ID・`digest`・時刻・理由だけ。
- Nangoの実装は作らない。接続の開始（OAuth）は組織接続の共通部品（`@unson/brainbase-mcp/organization-connection`）の`providerAdapter`として差し込む。

## 契約

### 接続の記録 `normalizeMeetingSourceConnectionRecord(value)`（AC-01）

- 項目：`connectionId`・`tenantId`・`provider`（`plaud`・`tactiq`）・`scope`（`personal`は`ownerPersonId`、`org`は`orgId`が必須）・`backend`（`kind`と非秘密の`ref`）・`capabilities`（`meetings:list`・`transcript:read`）・`status`（`pending`・`connected`・`reauth_required`・`disabled`・`revoked`）・`revision`（0以上の整数）・`lastVerifiedAt`。
- `connectionId`はBrainbaseが`createMeetingSourceConnectionId()`で発行する（`msc_`で始まる）。外部の接続基盤のIDは`backend.ref`にだけ持つ。
- `backend.ref`に秘密の形の鍵（token・secret・credential・password・private key・authorization code）や値（`Bearer `・JWTの形）があれば拒否する。

### 資格情報の差し込み口 `MeetingSourceCredentialStore`（AC-02）

- 接続IDごとに、持ち主の結び付き（テナント・人）、MCPサーバーのURL、OAuthのクライアント情報とtokenを読み書き・削除する。
- `MemoryMeetingSourceCredentialStore`と、1つのJSONファイル（権限0600、一時ファイルからの置き換え）に接続IDごとに持つ`FileMeetingSourceCredentialStore`を公開する。今のunsonのproviderごと1ファイルの保存は、後者に置き換えられる。
- OAuthの途中の値（PKCEの`codeVerifier`など）は、`state`のSHA-256をキーに同じ差し込み口の`savePendingAuthorization`・`takePendingAuthorization`で持つ。`take`は1回だけ返す。

### `ConnectionRuntime`と`NativeMcpRuntime`（AC-02・AC-03）

- `callTool(connection, tool, args)`：接続ごとの資格情報でMCPのSDKのクライアントを作り、ツールを1回呼んで閉じる。認可が要るとき（SDKが認可の画面へ送ろうとしたとき）は`OAuth authorization is required`のエラーにする（URLは含めない）。エラーの文言から、その接続のtoken・refresh token・client secretの値を伏せる。
- `verify(connection, { budget? })`：`probeMeetingSourceConnection`で、直近30日の一覧と、最新の会議の全文の1ページ目を実際に読む。
  - 一覧が読めたときだけ`status: 'connected'`と`meetings:list`。認可切れは`reauth_required`、それ以外の失敗は`error`で、どちらも能力は空。
  - 全文の1ページ目が読めたときだけ`transcript:read`を足す。読めなければ能力に入れず、理由（Tactiqの`access_required`では`get_access_options`の内容）を`notes`に残す。会議が無ければ`transcript:read`は`no_meetings`として未確認のまま。
  - Tactiqは全文の確認に1時間10件の枠を1件使う（渡された`budget`で数える）。
- `disconnect(connection)`：その接続の資格情報だけを消す。

### 接続ごとの同期 `syncMeetingSourceConnection(input)`（AC-04〜AC-08）

- 状態（接続ごと）：`listedThrough`（どこまで一覧を読んだか）、`pending`（会議・理由・次に試す時刻・試した回数）、`unobtainable`（取得できないと確定した会議と理由）、`delivered`（会議IDごとの`digest`・版・渡した時刻）、Tactiqの読み取りの記録、`syncEnabled`、`lastAttemptAt`・`lastSuccessAt`・`lastError`。
- 接続が`connected`でないか`syncEnabled`が偽なら、呼び出しをせず`skipped`を返す。
- 期間：`window`の指定が無ければ、`listedThrough`の1日前から今まで（初回は既定7日前から）。`window`を指定した取り直し（AC-08）は`listedThrough`を動かさない。
- 一覧が失敗したら、その回を`failed`として理由を`lastError`に残し、`listedThrough`を進めない（AC-05）。一覧が途中までのときも`failed`。
- 読む順：期間に出た会議のうち未受け渡しのものと、次に試す時刻が来た保留を、新しい順に。受け渡し済みの会議は`recheckDelivered`のときだけ読み直す。
- Tactiqは読む前に枠を確かめる。枠が無ければ呼ばずに保留（`rate_limited`、次に試す時刻つき）にし、失敗には数えない。
- 全文が`complete`なら受け渡し先へ渡す。同じ会議で`digest`が同じなら渡さず、変わったら版を1つ上げて渡す（AC-06）。受け渡しに失敗したら保留に残し、その回を`failed`にする。
- 全文が取れないとき：`not_ready`と`access_required`（会議だけ）と`rate_limited`は保留にして失敗に数えない。`timeout`・`incomplete`・`provider_error`は保留にしてその回を`failed`にし、`maxAttempts`（既定5回）に達したら`unobtainable`へ移す。範囲が`connection`の失敗（認可切れ・providerの枠切れ・全員に効く権限不足）は、残りを読まずに保留にして止め、`failed`にする。
- 成功した回だけ`lastSuccessAt`を更新し、`lastError`を消す。期間の一覧が完全なときだけ`listedThrough`を期間の終わりへ進める。

### 別のproviderの同じ会議 `findSameMeetingCandidates(entries)`（AC-06）

- 同じテナントで同じ持ち主（本人の接続は人、会社の接続は組織）の、別のproviderの会議の組だけを比べる。
- 時間が重なる組を候補として返し、共通の参加者を添える。一つにまとめない。全文のハッシュは使わない。

### MCPのOAuthの差し込み `createMcpOAuthConnectionAdapter(options)`（AC-09）

- 組織接続の共通部品の`OrganizationConnectionProviderAdapter`を返す。
- `createAuthorization`：MCPサーバーから認可サーバーを探し（RFC 9728・RFC 8414）、クライアントを動的に登録し、PKCEつきの認可URLを作る。範囲は保護リソースの`scopes_supported`（無ければ指定なし）。途中の値は`state`のSHA-256で保存する。
- `exchangeAuthorizationCode`：保存した途中の値を1回だけ取り出し、providerと持ち主の結び付きが一致するときだけ、codeをtokenに換える。接続IDを発行して資格情報を保存し、tokenを含まない読み戻しを`status: 'pending'`で返す（確認が通るまで接続済みにしない）。
- `readConnection`：接続IDの資格情報の持ち主とproviderが一致するときだけ、tokenを含まない読み戻しを返す。

## 試験

`tests/meeting-source-connection.test.ts`で、受入条件ごとに次を確かめる。

- AC-01：秘密の形の鍵と値の拒否、持ち主の必須項目、接続IDの形。
- AC-02：資格情報が接続ごとに分かれ、エラーの文言からtokenが消え、認可が要るときに認可URLを出さない。
- AC-03：一覧と全文が読める／認可切れ／Tactiqの`access_required`／会議なし の4通り。
- AC-04・AC-05：全文待ちが保留に残り後で渡る、一覧の失敗で`failed`と`lastError`が残り位置が進まない、受け渡しの失敗。
- AC-06：同じ`digest`は二度渡さず、変わったら版2で渡す。別providerの候補は同じテナント・持ち主の中だけ。
- AC-07：同じproviderの2接続で、資格情報・位置・保留・失敗・受け渡しが混ざらず、片方を切ってももう片方が続く。
- AC-08：止まっていた期間を指定して取り直しても重複しない。
- AC-09：偽の認可サーバーで、開始→完了→読み戻しが通り、読み戻しと状態にtokenが無く、同じ`state`の再利用は断られる。
