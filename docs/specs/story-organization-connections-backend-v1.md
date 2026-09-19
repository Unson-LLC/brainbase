# Story: 組織の外部サービス接続を安全に開始・確認する

## 利用者の成果

組織管理者が Brainbase の管理画面から Mana 用 Slack App と GitHub App の認可を開始でき、確認できていない接続状態を「未接続」と誤認しない。

## 受け入れ条件

- 組織管理者だけが `Slack` と `GitHub` の接続開始 API を利用できる。
- Slack は既存の installation control plane と OAuth flow を再利用する。
- GitHub は設定が揃った場合だけ署名付き state を含む App インストール URL を返す。
- 状態取得はテナント境界内で行い、credential reference や token を返さない。
- Slack はDBのactive行とCredential Storeのopaque referenceが一致して検証できた場合だけ `connected: true` を返す。
- GitHubはinstallation callbackとprovider readbackの実装前なので、active/pending行があっても `connected: null` を返す。
- Slack再認証では、canonical DBの現connection revisionをサーバー側で引き継ぐ。
- 明示的な revoked の場合だけ `connected: false` を返す。
- 同一オリジン BFF からの開始要求だけを想定し、canonical API の CSRF 例外は対象パスと Bearer に限定する。

## 今回の非対象

- GitHub callback での state 消費、installation 検証、永続登録
- Google Drive の接続追加
- 本番環境への設定投入とデプロイ

## 検証

- 組織接続 route と CSRF 境界の対象テスト
- 既存 Slack installation control plane と PostgreSQL repository の回帰テスト
- Node 構文確認、TypeScript typecheck、`git diff --check`
