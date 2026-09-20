---
story_id: story-device-login-provider-neutral-copy
spec_status: accepted
---

# Deviceログインprovider-neutral表示仕様

## 表示契約

- Step 2の見出しと開始ボタンは `組織アカウントでログイン` とする。
- Step 2の説明は `組織で利用しているアカウントでログインしてください` とする。
- OAuth callbackで認証情報が見つからない場合のエラーは、provider名を含めず `組織認証情報が見つかりません。もう一度お試しください。` とする。
- Deviceログイン画面とcontrollerの表示文言にprovider固有のサービス名を埋め込まない。

## 動作境界

- `startOrganizationAuth()` は既存の `/api/auth/login/start` と同じreturn URLを使い、provider選択はserverへ委譲する。
- 認証方式、redirect、callback、device approval、token pollingの処理は変更しない。

## 検証

- `tests/server/bootstrap/device-surface-contract.test.js` でprovider-neutral文言とprovider固有表示の不在を確認する。
- この仕様の検証はlocal source/test evidenceであり、本番provider設定やOAuth完了を証明しない。
