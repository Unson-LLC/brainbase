# Zapier議事録投稿をmanaへ正規に引き渡す

## 目的

`#9940-meeting-router` へZapierが投稿した議事録を、人物へのなりすましや認可の迂回なしにmanaが受け付けられるようにする。

## 現在の失敗

- Slack Event APIの受信までは成功している。
- BrainbaseのCompany Authorityで、ZapierのSlack user IDを正規主体へ解決できず `COMPANY_IDENTITY_UNRESOLVED` となる。
- 失敗位置は議事録キュー投入より前で、Slack threadへの応答も作られない。

## 仕様

- `service-company-authority.v1` のtransportは、既定の `provider=service` と `authenticated_subject_id=actor_id` を維持する。
- transportで `provider` と `authenticated_subject_id` を両方指定した場合だけ、外部で認証済みのサービス主体を既存service actorへ対応付けられる。
- 許可するproviderは `service` と `slack` に限定する。
- Zapierの対応はworkspace、app、Slack user、projectの完全一致でのみ有効とする。
- 既存の `svc_mana_runtime` membershipと `runtime.execute` bindingを再利用し、権限範囲は拡張しない。

## 受入条件

- 従来manifestの正規化・provisioningが変わらない。
- providerとsubjectの片方だけ、または未知providerはfail closedとなる。
- Zapier manifestのcheck、dry-run、apply、DB readbackで、作成対象がSlack identity 1件だけと確認できる。
- manaのCompany Authority rolloutは該当workspace、channel、Zapier userの完全一致だけを追加する。
- 本番Slackで受付表示、同一thread返信、処理中状態の消去、返信readbackを確認する。未実施の場合は完了扱いにしない。
