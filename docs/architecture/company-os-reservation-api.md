# 資源予約Canonical HTTP adapterの境界

この文書は [story-company-os-reservation-api-v1](../stories/story-company-os-reservation-api-v1.md) の境界を定める。HTTPで予約サービスを公開するが、予約の正本や組織の認証・承認を別の場所へ移さない。

## 責務の分離

```text
HTTP host / BFF
  ├─ 認証済みrequestから tenant・principal・scope を解決
  ├─ CSRF / 変更元を検証
  └─ ResourceReservationHttpHandlerへ trusted context を注入
       ↓
OSS canonical adapter
  ├─ URL・method・JSON・入力境界を検証
  ├─ 本文の主体情報をcontextと照合
  ├─ contextに束縛されたservice factoryを呼び出す
  └─ service結果・失敗をHTTPへ投影
       ↓
ResourceReservationService
  ├─ 現在の認可・Problem snapshot・容量を再確認
  ├─ SSOT lock内で状態遷移・冪等性を処理
  └─ 予約ledger sidecarへ原子的に保存
```

HTTPホストはOSSのルートを既存のサーバーへ組み込む。OSSは別のlisten処理、認証ストア、テナントDB、組織固有の権限規則を持たない。`ResourceReservationService`自身が現在ACLを確認するため、readもadapterが認可済みと仮定して直接台帳へ触れない。

## 信頼境界

信頼される入力はホストが検証して注入するcontextと、contextに束縛されたservice factoryだけである。HTTP本文は要求データであり、tenant・principal・scopeを含んでいてもcontextを上書きしない。不一致は拒否し、`authority`のような未契約の権限表現は受け付けない。

状態変更は、contextに検証済み変更元があるか、ホスト注入の変更要求検証providerが成功した場合だけサービスへ到達する。認証済みであることとCSRF検証済みであることを同一視しない。

## 保存と失敗

HTTP adapterはデータを保存しない。入力検証に失敗した要求はservice factoryを呼ばず、サービスのエラーは既存の状態遷移・ロック・認可を保ったままHTTPステータスへ写像する。未知の失敗や台帳破損は成功へ変換せず、fail closedで扱う。

`start_external`は、外部作用と照合の所有境界が別にあるためこの面へ投影しない。
