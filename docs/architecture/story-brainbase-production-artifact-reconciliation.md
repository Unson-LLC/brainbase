# Architecture: production artifact reconciliation

## センターピン

本番固有差分を先に正式なGit履歴へ保全してから、統合SHAとproduction環境正本を再投影する。Graph検証はコード、設定、署名、DB snapshotが同一runで揃った場合だけ成功とする。

## 境界

- 本番4ファイルの差分はパッチIDと対象テストで同一性を確認し、開発ブランチのcommitへ移す。
- 本番checkoutへ直接commitを追加せず、VibePro PRとCIを通した`develop`を唯一のデプロイ元にする。
- Ontologyの非機密公開鍵は`config/ontology/trusted-public-keys.json`を正本とする。
- Infisical productionでは署名用の秘密鍵と`key_id`を維持し、重複して壊れている公開鍵overrideだけを除去する。
- 再投影後に`brainbase-ssot.service`を再起動し、checkout SHA、process SHA、API version、dirty状態を読み戻す。
- Judgment Hostの変更はLightsailだけでは有効にならない。Global Codex lifecycle Hook、canonical local UI/API、persistent MCP Host bridge、Lightsail Resolver API/serverを、`judgment-resolve.md`の4面契約に従って同じmerge SHAへ揃える。
- 4面のreadinessは実タスクの証明ではない。反映後に作成した新しいCodexタスクのepisode、PostToolUse event、complete final、ユーザー向け判断レシートを同一turnで照合して初めて`proven_active`とする。
- 判断レシートの派生経路は、Hostの意味的成功判定から`judgment-value-proof-adapter`によるprojection、owner journalの`value-proof.json`、Stop final、ユーザー向け表示の順とする。取得監査だけのlive-session E2Eは`judgment_lifecycle_active`までを証明し、この派生経路の代替にしない。
- Graph SSOTは変更せず、`graph_validate`を読み取り検証として実行する。

## 実行順序

1. 本番差分を開発ブランチへ再現し、パッチ同一性と対象テストを確認する。
2. PR、CI、mergeを完了し、統合SHAを確定する。
3. Infisicalの不正な公開鍵overrideを削除し、productionへ再投影する。
4. 統合SHAを4実行面へデプロイし、各面を再起動またはreconcileする。
5. 4面のSHA、health、version、dirty/readiness状態を独立して読み戻す。
6. 反映後の新しいCodexタスクで同一turnのepisode、event、final、判断レシートを読み戻す。
7. journal、Ontology検証、Graph全体検証を同一runで読み戻す。

## 証拠契約

- PR前は、本番4ファイルと保全commitのpatch ID、対象テスト、型検査をVibeProのverification/review artifactへ記録する。
- merge後は、PR番号、CI結果、merge SHAと、4実行面それぞれで独立して観測した直前SHAを配備receiptへ記録する。一つの面のSHAから他面を推定しない。
- 再投影後は、削除した公開鍵overrideの名前だけを記録し、秘密鍵と`key_id`の値は出力しない。Ontology 1.1.0の署名検証元がGit信頼ストアであることをreadbackで確認する。
- 配備後は、Global Hook checkout、local `:31013`、MCP reconcile receipt、Lightsail checkout/public APIを個別に読み戻し、各SHAがmerge SHAと一致すること、Git checkoutを持つ面は`dirty=false`であることを同一receiptに保存する。
- fresh task証拠は、反映後に作成した一つのCodexタスクのepisode/event/final/transcriptへ束縛し、判断レシートがユーザー向け最終回答に一度だけ表示されたことを確認する。readinessやsynthetic testを`proven_active`へ丸めない。
- Graph検証は同一runの`graph_validate(project_code=brainbase)`レスポンスを保存し、HTTP 200、`collection_complete=true`、構造違反0件、Ontology違反0件、`valid=true`を個別に照合する。一つでも欠落または不一致なら成功としない。
- 復旧証拠は、保全commit、4実行面それぞれの直前SHA、Hook設定、runtime pin、本番差分の回復用backup pathに束縛する。

## 失敗時の扱い

- 差分同一性またはテストが不一致なら、本番checkoutを変更しない。
- CIまたはレビューが未完了なら、本番へデプロイしない。
- 再投影後に署名検証が失敗した場合はサービスを成功扱いせず、削除前の設定メタデータとGit信頼ストアを照合する。
- デプロイ後の4面SHA、dirty/readiness状態、fresh task、Graph検証のいずれかが一致しない場合は、保全済みcommitと各面の直前SHAを使って復旧し、未確認として報告する。
