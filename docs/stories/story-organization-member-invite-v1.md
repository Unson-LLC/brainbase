# Story: 組織メンバーの招待（招待メール・リンク）

> **2026-11-20 移設**: 招待の本体と受け口は brainbase-organization の `packages/server-parts/organization-member-invites`（`kernel.js`・`http.js`、保存先 `postgres-repository.js` の隣）へ移した（Unson-LLC/brainbase-organization#1473）。招待はテナント・役割・認可・メンバーの付与・監査を持つ組織の管理で、OSSの境界に合わないため。OSSの `./organization-member-invite` と `./organization-member-invite-http` は外した。以下は移す前の記録。

Story ID: `story-organization-member-invite-v1`

## Story

組織の管理者として、メンバーにしたい相手のメールアドレスを入れて招待を送りたい。
招待された人は、メール（またはリンク）から入り、その組織で選ばれているログイン方法で
ログインすると、管理者が決めた権限でその組織のメンバーになる。これにより、管理者は
相手のアカウントを事前に用意しなくても、安全にメンバーを増やせる。

## 受け入れ条件

1. `@unson/brainbase-mcp/organization-member-invite` から招待サービス、DI interface、エラー型を import できる。
2. 招待は opaque token として発行され、保存先には SHA-256 hash だけが保存される。生 token は招待リンクにのみ現れる。
3. 招待には招待先メール・付与する役割（role）・発行者（tenant/person binding）・発行時刻・失効時刻が結び付く。
4. 受諾は injected repository の atomic consume 契約により TTL と一度きりを満たし、missing・expired・revoked・replayed・consumed を区別する。
5. 受諾時のログインは、利用側（組織版）が組織ごとに選ばれたログイン方法でユーザをログインさせ、その結果（認証済み person）を kernel の `acceptInvite` に渡す。ログイン方法の解決・実装は利用側が所有し、kernel は結果だけを受け取って招待の役割で tenant に結び付ける。
6. 管理者は pending の招待を取り消せ（受諾処理中は競合エラー）、取り消された招待の受諾は拒否される。失効・再送・取り消しは監査 envelope に credential を含めず記録される。
7. 誰が招待できるか・どの役割を付与できるかは policy が所有し、policy が拒否した招待・受諾は実行されない。
8. 招待メールの送信（delivery）は差し込み口に委譲し、kernel 自身はメールを送らず、送信に必要な非秘密の envelope（宛先・受諾 URL・表示名・失効時刻）だけを渡す。
9. unit test と fresh consumer smoke で subpath import、発行・受諾・取り消し・期限切れ・replay・境界エラーを検証する。

## 境界

- 本Storyの正本は公開Brainbaseの TypeScript service kernel と、その subpath export である。
- 永続化、メール送信基盤、組織認証とログイン方法の実装、tenant policy、secret、受諾 URL の base、配備設定は利用側repo（組織版）が所有する。
- Unson固有のメールテンプレート・SMTP/API 設定・DB/Graph adapter・secret 値・本番配備はこのStoryの対象外である。
