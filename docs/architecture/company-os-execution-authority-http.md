# 実行権限Canonical HTTP adapterの境界

この文書は [story-company-os-execution-authority-http-v1](../stories/story-company-os-execution-authority-http-v1.md) の責務境界を定める。HTTP adapterは既存の実行権限サービスを公開するが、認証・組織権限・外部作用の正本をOSSへ移さない。

```text
HTTP host / BFF
  ├─ 認証済みrequestから tenant・principal・scope を解決
  ├─ 変更要求のOrigin/CSRFを検証
  └─ ExecutionAuthorityHttpHandlerへtrusted contextを注入
       ↓
OSS canonical adapter
  ├─ URL・method・JSON・入力境界を検証
  ├─ bodyの主体をtrusted contextへ束縛
  ├─ contextに束縛されたservice factoryを呼ぶ
  └─ service結果・失敗をHTTPへ投影
       ↓
ExecutionAuthorityService
  ├─ 現在のauthority・承認・制約・予約・read ACLを再確認
  ├─ SSOT lock内で意図・状態・冪等性を処理
  └─ ExecutionEffectPortの外部作用境界を維持
```

adapterはlisten、認証ストア、tenant DB、RACI判断、sidecar保存を持たない。`start`はservice factoryから返された現在のtenant serviceへ渡し、`read`もadapter独自のACLやsidecar直読を追加せずserviceの `readIntent` に委譲する。contextがない、または不正なら401、変更元未検証なら403としてfactoryを呼ばない。

公開する操作は、`POST /execution-authority/start` と `GET /execution-authority/intents/{operationId}` の二つだけである。外部作用を直接起動するrouteは公開しない。
