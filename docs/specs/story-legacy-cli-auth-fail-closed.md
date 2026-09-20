# CLI認証の旧insecure headerフォールバック撤去 Spec

## 対象

- `cli/auth.js`
- `cli/token-expiry.js`
- `cli/learning.js`
- `cli/project-provisioning.js`

## 振る舞い

### Device Code Flow

1. `/api/auth/device/code` が成功した場合は、既存のSlack Device Code Flowを表示・pollし、取得した`access_token`をBearer tokenとして保存する。返却された`refresh_token`はそのまま保存する。
2. 保存する期限は、token responseの有効な`expires_at`、有効な`expires_in`、JWT payloadの`exp`のうち最も早いものとする。JWTの`exp`は署名検証ではなく、サーバーが発行した期限を越えないためのローカル上限判定に限って利用する。
3. token responseに利用可能な期限情報がない場合は認証情報を保存せず、30日固定の推測値へフォールバックしない。
4. 404の場合はDevice Code Flow未提供としてエラー終了し、手入力のrole・project・clearanceを受け付けない。
5. 接続失敗またはその他のリクエスト失敗はエラー終了し、認証情報を保存しない。
6. エラー文には、現行サーバーでの正規ログインを再試行する案内を含める。

### 既存保存値

- `auth.json`の`mode: insecure_header`は互換用に読み取られても、認証済みとして表示せず、APIヘッダーへ変換しない。
- 学習CLIとプロジェクトプロビジョニングCLIはBearer tokenがない保存値を拒否する。
- `tokens.json`の`access_token`フォールバックは既存のSlack UIログイン経路として保持する。
- 既存`auth.json`の有効性判定では、保存済み`expires_at`をJWT payloadの`exp`より後に延長しない。期限情報のない既存の不透明トークンは従来互換で読み取る。

## セキュリティ境界

- CLIは利用者入力から権限を構成しない。
- APIへ送信する認証は`Authorization: Bearer <token>`だけとする。
- サーバー側の内部用途で残るinsecure header経路は本Specの対象外であり、別の利用実態と移行計画なしに削除しない。

## ロールバック

コード変更は単一コミットをrevertできる。保存済みの`auth.json`・`tokens.json`や本番環境は変更しないため、データ移行は不要。
