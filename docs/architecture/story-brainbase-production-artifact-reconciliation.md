# Architecture: production artifact reconciliation

## センターピン

本番固有差分を先に正式なGit履歴へ保全してから、統合SHAとproduction環境正本を再投影する。Graph検証はコード、設定、署名、DB snapshotが同一runで揃った場合だけ成功とする。

## 境界

- 本番4ファイルの差分はパッチIDと対象テストで同一性を確認し、開発ブランチのcommitへ移す。
- 本番の旧SHA＋4ファイル差分は、切替前に対象限定のpatch、content hash、専用rollback branchのcommitとして保存する。このcommitは復旧専用であり、デプロイ元にはしない。
- 通常の本番checkoutへ直接機能commitを追加せず、VibePro PRとCIを通した`develop`を唯一の前進デプロイ元にする。
- Ontologyの非機密公開鍵は`config/ontology/trusted-public-keys.json`を正本とする。
- Infisical productionでは署名用の秘密鍵と`key_id`を維持し、重複して壊れている公開鍵overrideだけを除去する。
- Judgment Resolverの変更はglobal Hook checkout、ローカル`:31013`、常駐MCP、本番Lightsailの4面を一つの互換セットとして扱い、各面のSHAを推測せず個別に読み戻す。
- 切替前に4面のSHAとglobal Hookファイルを保全し、統合SHAへ揃えた後に各面のclean/readinessを確認する。
- Infisical再投影後に`brainbase-ssot.service`を再起動し、checkout SHA、process SHA、API version、dirty状態を読み戻す。
- Graph SSOTは変更せず、`graph_validate`を読み取り検証として実行する。

## 実行順序

1. 本番差分を開発ブランチへ再現し、パッチ同一性と対象テストを確認する。
2. PR、CI、mergeを完了し、統合SHAを確定する。
3. `judgment-resolve.md`のproduction dirty hotfix reconciliationを実行する。許可した4ファイル以外の差分がないこと、正式commitとのpatch ID一致を確認し、patch、content hash、旧SHAを退避して専用rollback commitを作る。本番checkoutがcleanにならなければ停止する。
4. 同runbookのpre-deployment rollback captureで、4面の現行SHAとglobal Hookファイルを個別に保全する。Lightsailのrollback SHAは旧SHA＋ホットフィックスを表すcleanな専用commitである。
5. global Hook checkout、ローカル`:31013`、常駐MCP、本番Lightsailを統合SHAへ揃え、各面のclean/readinessを読み戻す。
6. Infisicalの不正な公開鍵overrideだけを削除してproductionへ再投影し、Lightsailサービスを再起動する。
7. health、version、dirty状態、journal、Ontology検証、Graph全体検証を同一runで読み戻す。
8. Hook trust状態を確認し、必要ならowner承認後に作成したfresh taskでJudgment episode、実Brainbase event、完全なowner auditを実証する。

## 失敗時の扱い

- 差分同一性またはテストが不一致なら、本番checkoutを変更しない。
- 本番に許可した4ファイル以外の変更がある、patch/content hashを退避できない、または専用rollback commit後もdirtyなら、通常の事前取得へ進まない。
- CIまたはレビューが未完了なら、本番へデプロイしない。
- 再投影後に署名検証が失敗した場合はサービスを成功扱いせず、削除前の設定メタデータとGit信頼ストアを照合する。
- デプロイ後のSHA、dirty状態、Graph検証、fresh task実証のいずれかが一致しない場合は、`judgment-resolve.md#rollback`の順序でローカルUI/MCP、Lightsail、global Hookを記録済み状態へ戻し、未確認として報告する。Lightsailは専用rollback commitへ戻して旧SHA＋ホットフィックスの実効内容を`dirty=false`で復元し、保存済みcontent hashと照合する。global Hookは最後に復旧し、owner journalは削除しない。
