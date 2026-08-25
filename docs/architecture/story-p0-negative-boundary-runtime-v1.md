# Architecture: P0 Personal→Organization負境界runtime

## 境界

昇格は「Personalデータのコピー」ではなく、Personal eventを根拠にサーバーがallowlist schemaへ正規化した新しい組織知識の生成である。組織側へ渡すのはnormalized payloadと非可逆hash、最小のprovenanceだけとし、Personal本文やprivate locatorを渡さない。

処理順は次に固定する。

1. `Brainbase-Tenant-Context`からA0署名、期限、audience、deployment、person actor、操作別capabilityを検証し、person、organization、projectを解決する。
2. owner本人だけがpromotion requestを作成し、同じ本人がnormalized payload hashへ同意する。
3. 別personのGM以上が同一organization・project authorityでnormalized payloadだけを審査する。
4. 承認時にorganization knowledge event、Graph Entity/Edge、review receiptを単一DB transactionで確定する。
5. readbackでrequest、Receipt、Graph projection、重複件数を同一runへ結び付ける。

## Authority契約

- owner authorityとorganization reviewer authorityは別actor・別receiptとして保存する。
- organization reviewerはownerと同一personであってはならない。
- authorityは`operation_id`、`idempotency_key`、actor、organization、project、操作別capabilityへ束縛し、使用を`knowledge_promotion_authority_uses`へ同一transactionで記録する。
- missing、expired、invalid、scope mismatch、replayed authorityはfail closedする。
- direct request bodyのtenant/person/roleはauthority根拠として採用しない。

## データ契約

- Graph payloadは`personal_knowledge_normalized.v1`のallowlistだけを受け入れる。
- `body`、`raw`、`content`、`preview`、`personal_event_id`、local path、secret、credentialを拒否する。
- Personal eventとの対応は組織Graph payloadではなくpromotion台帳のhashとReceiptで監査する。
- mutation結果はrequest単位で一意にし、同じrequestから二重Entity・Edge・Receiptを生成しない。同一の署名authorityを再送した場合は、使用済みauthorityとしてHTTP 409で拒否し、authority使用台帳を含む全更新差分を0にする。新しい署名authorityで完了済みrequestを再確認した場合は、新しいauthority使用Receiptだけを監査記録として追加できるが、event・Graph・promotion・Receiptは変更しない。別hashへの差し替えも競合として停止する。

## Transactionと副作用

署名・期限・capability検証はroute middlewareでtransaction開始前に完了する。actor・organization・project再束縛とauthority再送claimはservice transaction内のGraph書込み前に完了する。承認系はauthority使用台帳、organization event、Graph、promotion request、Receiptを同一transactionに含める。途中失敗はrollbackする。検索とLLM contextはGraph SSOTのallowlist projectionだけを入力にし、このtransactionからPersonal本文を検索index、LLM、外部送信へ直接渡さない。本Storyには別outbox経路を追加しない。

## predecessorとの関係

`story-p0-negative-boundary-contract-v1`は境界契約を確定した履歴であり、本Storyが実runtimeの振る舞いを置き換える。旧Storyの`production_evidence: not_collected`と「組織側writeなし」は旧contract sliceだけの記録であり、本Storyの本番受入判定には流用しない。

## 本番検証

migration適用後にsynthetic fixtureで正常系、owner=reviewer、cross-person、cross-tenant、期限切れ、署名改ざん、replay、payload差し替えを確認する。成功判定はHTTP 200だけでなく、Receipt、DB/Graph readback、Personal本文不在、重複0、再送時の更新差分0までを必要とする。
