---
spec_id: organization-member-invite-v1
story_id: story-organization-member-invite-v1
status: draft
owner_repository: brainbase
export: "@unson/brainbase-mcp/organization-member-invite"
depends_on: []
---

# 組織メンバーの招待（招待メール・リンク）v1 仕様

## 目的

組織の管理者がメールアドレスを入れてメンバーを招待し、招待された人がリンクから、その組織で
選ばれたログイン方法でログインしてメンバーになる、までの共通契約を公開する。発行・受諾・取り消し・
期限切れ・権限付与のルールを kernel として持ち、保存先・メール送信・組織認証・ログイン方法・配備は
すべて DI boundary の外側（組織版）へ委譲する。kernel 自身は DB・メール基盤・secret・URL base・
provider を知らない。

関連: 受諾時の「組織ごとに選ばれたログイン方法」は組織接続 OAuth カーネル
（`organization-connection-kernel`）と同じく利用側が所有する。利用側は受諾 URL を開いた人を、組織の
選ばれたログイン方法でログインさせ、**その結果（認証済み person）だけ**を `acceptInvite` に渡す。
ログイン方法そのものの解決・実装は本仕様の対象外。

## 境界

- 招待記録・token hash・受諾結果の保存先、tenant/person の認可、メールの実送信、ログイン方法の解決、
  受諾 URL の base、招待の定期的な失効掃除を動かす場所は、差し込み口として利用側が持つ。
- 生 token は発行時に一度だけ返し、保存先には SHA-256 hash だけを渡す。生 token は受諾リンクにのみ現れる。
- メール本文・テンプレート・SMTP/API 実装は作らない。kernel は送信に要る非秘密の envelope（宛先・受諾 URL・
  発行者表示名・失効時刻・役割名）を delivery 差し込み口へ渡すだけ。
- 役割（role）の集合や各役割の細かな権限表は利用側の policy が所有する。kernel は「どの役割を付与するか」を
  受け渡し、policy が許すかどうかだけを委ねる。

## 公開契約

- `OrganizationMemberInviteService`: `createInvite`, `acceptInvite`, `revokeInvite`, `resendInvite`, `reissue`, `readInvite`
- `OrganizationMemberInviteRepository`: 招待 record の保存、atomic な `reserveForAccept`・`finalizeAccept`・
  `releaseReservation`・`revoke`・`reissue`、`get`、`findPendingByEmail`
- `OrganizationMemberInvitePolicy`: 発行・受諾・取り消し・参照・再送の組織固有認可（誰が・どの tenant で・
  どの役割を付与/操作できるか）
- `OrganizationMemberInviteDelivery`: credential を含まない招待 envelope の送信委譲（メールを送るのは利用側）
- `OrganizationMemberInviteAcceptBinding`: 受諾時に、認証済み person を tenant に役割付きで結び付ける委譲
- `OrganizationMemberInviteAudit`: credential を含まない監査 entry（best-effort。失敗は受諾結果を覆さない）
- `OrganizationMemberInviteClock`: deterministic な時刻供給
- `OrganizationMemberInviteError`: 安定した `code`/`status`/`details` envelope

## データ形（record と readback projection）

招待 record は次の非秘密 field だけを持つ。生 token・secret・password・credential を示す field は拒否する。

- `inviteId`（kernel が `createOrganizationMemberInviteId()` で発行、`omi_` で始まる）
- `tenantId`・`inviterPersonId`（発行者の binding）
- `inviteeEmail`（正規化済み。小文字化・前後空白除去。PII として扱う）
- `role`（付与予定の役割名。policy が許す集合のうちの1つ）
- `status`（`pending`・`accepting`・`accepted`・`revoked`・`expired`）
- `issuedAt`・`expiresAt`・`acceptedAt?`・`revokedAt?`・`supersededByInviteId?`
- `acceptedByPersonId?`（受諾後にのみ入る）

`readInvite` / readback は、**認可された呼び出し元（同 tenant の管理者など）に対しては** 上記 record を返す
（管理者 UI が宛先メールと状態を表示するため `inviteeEmail` を含む）。token hash と内部の予約マーカーは
決して返さない。ログ・監査・エラーには `inviteeEmail` の生値・生 token を出さず、必要なら伏せ字にする。

## 受諾者の本人確認

- 既定（policy 無指定時）: `acceptInvite` に渡された認証済み person の **検証済みメール**が `inviteeEmail` と
  一致しないと受諾を拒否する（`email_mismatch`）。検証済みでないメールは一致とみなさない。
- policy が明示的に許したときだけ、リンク所持者（メール不一致）での受諾を認める。この判断と、その場合の
  監査強化は利用側 policy が所有する。kernel は既定で厳格側に倒す。

## 受諾の原子性（予約→確定の二段）

受諾は「予約（atomic）→ binding → 確定/解放」の二段で行い、`acceptBinding` 失敗から復旧できるようにする。

1. `reserveForAccept(tokenHash, now)`: `pending` かつ未失効・未取り消しのときだけ、atomic に `accepting` へ
   遷移し record を返す。missing・expired・revoked・replayed（既に `accepting`/`accepted`）・consumed を区別する。
2. `acceptBinding`: 認証済み person を role 付きで tenant に結び付ける。
   - 成功 → `finalizeAccept` で `accepted` へ遷移し `acceptedByPersonId`・`acceptedAt` を記録。
   - 副作用なしと確定した失敗 → `releaseReservation` で `pending` へ戻し（TTL 内なら再試行可能）、安定エラーを返す。
   - timeout・プロセス停止など結果不明時、または binding 成功後の確定失敗時は `accepting` を保持する。
     binding は inviteId を冪等キーとし、同じ person/role への再試行・結果照会と確定再試行で復旧する。
     他 person に予約を渡さず、予約所有者だけが確定/解放できる。自動 TTL 解放で結果不明の予約を再利用しない。
3. 監査は `finalizeAccept` の後に best-effort で記録する。監査失敗は受諾結果（`accepted`）を覆さず、
   監査失敗自体を別途記録する（不変条件 11）。

## 不変条件

1. token は `randomBytes` で発行し、repository には SHA-256 hash・binding・inviteeEmail・role・issuedAt・expiresAt
   だけを渡す。生 token は `createInvite`/`reissue` の戻り値（と受諾 URL）に一度だけ現れ、保存しない。
2. 受諾は `reserveForAccept`→`finalizeAccept`/`releaseReservation` の二段で行い、missing・expired・revoked・
   replayed・consumed を区別する。`accepting` マーカーは atomic に保存し、二重受諾で2人が同じ招待を消費できない。
3. 受諾は、招待が `pending` かつ未失効かつ未取り消しで、本人確認（上記）を満たすときだけ `acceptBinding` を呼び、
   `acceptInvite` に渡された認証済み person を role 付きで tenant に結び付ける。
4. `expiresAt` を過ぎた招待の受諾・再送は `expired` として拒否する。既定 TTL は利用側が注入（推奨 7 日）。
   期限切れからの再開は再送ではなく `reissue`（新 token 発行＋旧 record 無効化、不変条件 7）で行う。
5. `revokeInvite` は `pending` のみ atomic に `revoked` にし、以後の受諾を拒否する。
   `accepting` への取り消し・再発行は `accept_in_progress` として拒否する。予約と取り消しの競合では
   一方のみ成功し、取り消し済みなのに binding だけ成功する状態を防ぐ。`accepted` は変えない。
6. 発行・受諾・取り消し・参照（`readInvite`）・再送（`resendInvite`/`reissue`）は policy が認可する。policy は
   操作者・対象 tenant・付与/操作する role を判断し、拒否したら provider 呼び出しも binding も行わない。
   すべての操作は tenant 分離を満たし、他 tenant の招待を参照・操作できない。
7. 再送は raw token を保存しないため同一 token の再送はできない。`resendInvite` は `pending` の招待の envelope を
   同じ受諾 URL で再送する用途に限り、raw token が呼び出し時に手元にある場合だけ使える。手元に無い/期限切れの
   場合は `reissue` を使い、**新しい token を atomic に発行して旧 record を `superseded`（= `revoked` 相当・
   `supersededByInviteId` を設定）にし**、旧リンクを無効化してから新リンクを delivery へ渡す。`reissue` と
   受諾/取り消しは同じ record に対して atomic に直列化し、競合時は後勝ちにならないよう one-time 契約で守る。
8. inviteeEmail は正規化し、kernel は `findPendingByEmail` で同一 tenant・同一メール宛の `pending` 招待を
   検知できるようにする。重複時に再送・拒否・上書きのどれにするかは利用側 policy に委ねる。
9. intent/metadata は JSON-compatible な値に限定し、token・secret・credential・password・private key・
   authorization code を示す field を拒否する。
10. delivery・repository・policy・acceptBinding・audit・clock の例外は raw message を返さず、安定した公開エラーへ
    正規化する。エラー・監査・ログに inviteeEmail の生値や生 token を出さない。
11. 監査は best-effort。`finalizeAccept` 成功後の監査失敗は受諾を覆さず、監査失敗を別エントリで記録する。
    binding 前（予約中）の監査失敗は安定エラーにできるが、record は `releaseReservation` で `pending` に戻す。
12. repository・policy・delivery・acceptBinding・audit・clock の実装は利用側が所有する。

## フロー

1. 管理者が招待先メールと role を入力 → `createInvite` が policy で認可を確認し、token を発行、hash と record を保存、
   `OrganizationMemberInviteDelivery` に envelope（宛先・受諾 URL・発行者表示名・失効時刻・role 名）を渡す。
2. 招待された人が受諾 URL を開く → **利用側**が組織の選ばれたログイン方法でログインさせ、認証済み person を得る。
3. `acceptInvite(rawToken, authenticatedPerson)` → 本人確認を満たしたうえで `reserveForAccept`（atomic）→
   `acceptBinding` → 成功なら `finalizeAccept`（`accepted`）、副作用なしの失敗なら `releaseReservation`（`pending` に戻す）。結果不明・確定失敗は予約を保持して冪等復旧する。
4. 管理者が未受諾の招待を取り消すとき `revokeInvite` → `pending` を `revoked` にし（`accepting` は `accept_in_progress` 拒否）、、以後の受諾を拒否。
5. 再送: 手元に raw token があり招待が `pending` なら `resendInvite` で同じリンクを再送する。期限切れ・手元に
   token が無いときは `reissue` で新 token を発行し、旧 record を `superseded` にして新リンクを送る。

## 受け入れ条件

- AC-01 `createInvite`: policy 認可後に opaque token を発行し、repository には SHA-256 hash と非秘密 record だけを保存。
  戻り値は readback projection と生受諾 URL を一度だけ返す。
- AC-02 発行時に inviteeEmail を正規化し、secret-shaped な intent/metadata を拒否する。
- AC-03 `acceptInvite`: 本人確認を満たし `reserveForAccept` が `reserved` を返したときだけ `acceptBinding` を呼び、
  成功時に `finalizeAccept` で person を role 付きで結び付ける。
- AC-04 本人確認: 既定では認証済み person の検証済みメールが `inviteeEmail` と一致しないと `email_mismatch` 拒否。
  policy が許すときだけリンク所持者受諾を認める。
- AC-05 復旧: `acceptBinding` の副作用なしと確定した失敗時のみ `releaseReservation` で `pending` に戻り、TTL 内で再受諾できる。
  結果不明・確定失敗では予約を保持し、同じ person/role の冪等 binding と確定再試行で復旧する。
  `finalizeAccept` 後の監査失敗は `accepted` を覆さない。
- AC-06 期限切れ: `expiresAt` 超過で受諾・再送を `expired` 拒否。期限切れからの再開は `reissue`。
- AC-07 取り消し: `revokeInvite` は `pending` に効き、以後の受諾を `revoked` 拒否。
  `accepting` の取り消し・再発行は `accept_in_progress` 拒否。予約との競合では一方のみ成功する。`accepted` は不変。
- AC-08 二重受諾: 同じ token の2回目の受諾は `replayed`/`consumed` として拒否され、binding は1回だけ起こる。
- AC-09 再送/再発行: `resendInvite` は raw token が手元にある `pending` のみ。`reissue` は新 token を atomic に
  発行し旧 record を `superseded`（`supersededByInviteId` 設定）にして旧リンクを無効化する。
- AC-10 権限と tenant 分離: 発行・受諾・取り消し・参照・再送を policy が認可し、他 tenant の招待を参照・操作できない。
- AC-11 delivery: envelope の秘密値は受諾 URL 内の token のみ（宛先メールは必要な PII として許可）。
  生 token 単独の field や他の credential を含めず、delivery は URL と宛先をログに出さない。送信失敗は安定エラーへ正規化。
- AC-12 可視性: `readInvite` は認可された同 tenant 呼び出し元に record（`inviteeEmail` 含む）を返すが、
  token hash・予約マーカーは返さない。ログ・監査・エラーには生 token・生 inviteeEmail を出さない。
- AC-13 DI: repository・policy・delivery・acceptBinding・audit・clock は利用側から注入できる。

## 検証

- `tests/organization-member-invite.test.ts`: 発行、TTL/期限切れ、取り消し（`pending` 成功・`accepting` 拒否・予約との競合）、
  予約→binding→確定、副作用なしの binding 失敗からの release と再受諾、結果不明・確定失敗・停止後の冪等復旧、one-time replay（二重受諾）、本人確認（メール一致/不一致）、
  tenant 分離と role 付与、policy 委譲、delivery 失敗、`reissue` による旧リンク無効化、重複メール検知、
  safe readback、監査 best-effort（確定後の監査失敗が受諾を覆さない）。
- `scripts/npm-consumer-smoke.mjs`: 公開 tarball を fresh consumer から subpath import し、
  create/accept/revoke/reissue/replay を実行する。
- `npm run build`、focused Vitest、consumer smoke を PR で実行する。

## 非対象

メール本文・テンプレート・SMTP/メール API 実装、組織ごとのログイン方法そのものの解決・実装、Postgres/Graph adapter、
role ごとの詳細権限表、受諾 URL の base・配備設定、secret 値、本番反映、既存 Unson route の切替。
