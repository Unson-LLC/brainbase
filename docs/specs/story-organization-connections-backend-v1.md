# Story: 組織の外部サービス接続を安全に開始・確認する

## 利用者の成果

組織管理者が Brainbase の管理画面から Mana 用 Slack App と GitHub App の認可を開始でき、確認できていない接続状態を「未接続」と誤認しない。

## 受け入れ条件

- 組織管理者だけが `Slack` と `GitHub` の接続開始 API を利用できる。
- 認証ミドルウェアが組織IDから解決したcanonical tenant権限を接続管理APIで利用し、未登録のSlack外部IDを二重に要求しない。
- Slack installation control plane自体は、従来どおり信頼済みAppに紐づくSlack外部IDからcanonical権限を解決する。
- Slack は既存の installation control plane と OAuth flow を再利用する。
- GitHub は設定と callback 用 port が揃った場合だけ、10 分有効の署名付き state を一回限りで消費する App インストール URL を返す。
- GitHub callback は署名・期限・一回消費を確認し、注入された verifier で対象 App の organization installation を確認する。
- GitHub credential は注入された既存 Credential Store に opaque reference として保存し、provider readback が同じ organization installation を確認した後だけ接続 repository に保存する。
- GitHub の接続状態は Credential Store の参照検証と provider readback の両方に成功した場合だけ `connected: true` にする。
- callback の完了先は設定された固定の相対パスだけを許可する。未設定時は秘密情報を含まない no-store JSON を返す。
- verifier、state store、credential store、repository port のいずれかが未注入・失敗した場合は接続成功とせず、秘密情報を API 応答へ含めない。
- 状態取得はテナント境界内で行い、credential reference や token を返さない。
- Slack はDBのactive行とCredential Storeのopaque referenceが一致して検証できた場合だけ `connected: true` を返す。
- Slack再認証では、canonical DBの現connection revisionをサーバー側で引き継ぐ。
- 明示的な revoked の場合だけ `connected: false` を返す。
- 同一オリジン BFF からの開始要求だけを想定し、canonical API の CSRF 例外は対象パスと Bearer に限定する。

## 非対象

- Google Drive の接続追加

## 検証

- 組織接続 route と CSRF 境界の対象テスト
- legacy organization claimをcanonical tenantへ変換した管理者の状態取得回帰テスト
- 既存 Slack installation control plane と PostgreSQL repository の回帰テスト
- Node 構文確認、TypeScript typecheck、`git diff --check`
