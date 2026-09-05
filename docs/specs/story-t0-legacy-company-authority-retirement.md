# 旧テナント会社権限経路の監査付き失効 Spec

## 入力

CLIは `company-authority-retirement.v1` manifestを受け取る。tenant ID/key、organization ID、project IDに加え、失効するmembership、external identity、active bindingの現在値をIDとrevisionを含む全項目で宣言する。対象membershipに紐づくactive bindingも完全な集合として宣言する。空配列は「未収集」ではなく「DBでactive行が0件と照合する」という期待値である。

membershipは `membership_id`、`principal_id`、`expected_revision` を持つ。identityはID、revision、membership、provider、subject、workspace、app、project、placementを持つ。宣言外のキー、重複、秘密らしいキーまたは値を拒否する。

## 実行境界

`--check` はmanifestだけを検査する。`--dry-run` と `--apply` は次の順で同じtransaction処理を行う。

1. tenant contextとtenant単位のadvisory lockを設定する。
2. active tenant、tenant key、organization、projectを正確に照合する。
3. 対象membershipを `FOR UPDATE` で読み、organization、principal、status、revisionを照合する。
4. 対象membershipに紐づく全active identity IDと全active binding IDがmanifestの集合と一致することを確認する。
5. 各identityの全宣言値を照合する。
6. apply時だけ、同じtenant keyとidempotency keyのledgerを照合し、`claimed` を作成する。
7. identityとbindingをrevokedへ、membershipをinactiveへ更新し、membership revisionを1増やす。
8. transaction内で対象行と各identity由来のruntime routeが0件であることを読み戻す。
9. apply時はredacted receiptをledgerへ保存してcommitする。dry-runは必ずrollbackする。

apply後は新しいDB接続で同じreadbackを繰り返し、既存provisioning operation ledgerのstatus、manifest SHA-256、receiptも照合する。transaction内とcommit後のどちらかが不一致なら成功を返さない。

## 再実行

operation IDはtenant key、idempotency key、manifest SHA-256から決定的に作る。同じkeyと同じSHAでapplied済みなら既存receiptを返し、別接続readbackだけを再実行する。同じkeyと異なるSHA、terminalでない既存operation、期待値と異なる現在状態は副作用なしで拒否する。

## 変更しない状態

人物、`auth_grants`、tenant organization、tenant project、workspace connectionは読取りだけである。これにより、同じ人物の正当なUnson所属とログイン権限を残し、誤配置された会社権限経路だけを止める。
