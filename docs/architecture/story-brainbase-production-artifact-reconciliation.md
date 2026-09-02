# Architecture: production artifact reconciliation

## センターピン

本番固有差分を先に正式なGit履歴へ保全してから、統合SHAとproduction環境正本を再投影する。Graph検証はコード、設定、署名、DB snapshotが同一runで揃った場合だけ成功とする。

## 境界

- 本番4ファイルの差分はパッチIDと対象テストで同一性を確認し、開発ブランチのcommitへ移す。
- 本番checkoutへ直接commitを追加せず、VibePro PRとCIを通した`develop`を唯一のデプロイ元にする。
- Ontologyの非機密公開鍵は`config/ontology/trusted-public-keys.json`を正本とする。
- Infisical productionでは署名用の秘密鍵と`key_id`を維持し、重複して壊れている公開鍵overrideだけを除去する。
- 再投影後に`brainbase-ssot.service`を再起動し、checkout SHA、process SHA、API version、dirty状態を読み戻す。
- Graph SSOTは変更せず、`graph_validate`を読み取り検証として実行する。

## 実行順序

1. 本番差分を開発ブランチへ再現し、パッチ同一性と対象テストを確認する。
2. PR、CI、mergeを完了し、統合SHAを確定する。
3. Infisicalの不正な公開鍵overrideを削除し、productionへ再投影する。
4. 統合SHAを本番へデプロイしてサービスを再起動する。
5. health、version、dirty状態、journal、Ontology検証、Graph全体検証を同一runで読み戻す。

## 失敗時の扱い

- 差分同一性またはテストが不一致なら、本番checkoutを変更しない。
- CIまたはレビューが未完了なら、本番へデプロイしない。
- 再投影後に署名検証が失敗した場合はサービスを成功扱いせず、削除前の設定メタデータとGit信頼ストアを照合する。
- デプロイ後のSHA、dirty状態、Graph検証が一致しない場合は、保全済みcommitと直前SHAを使って復旧し、未確認として報告する。
