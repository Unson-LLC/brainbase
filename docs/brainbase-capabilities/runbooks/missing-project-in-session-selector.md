# Runbook: Project Catalog Access and Readback

認証済みのCLI/API/MCPでProject Catalogが見えない、またはProject Provisioningの完了を確認できない場合に使います。

`project.selector`のブラウザー選択画面は廃止済みです。画面がないことはProject Catalog障害ではありません。Projectの認可範囲はAPI/MCPで調べ、タスクやworktreeの作成はCodex app/CLIで行います。

## 1. APIのCatalogを確認する

```bash
curl -s http://127.0.0.1:31013/api/config/projects \
  -H 'Authorization: Bearer <token>' | jq .

curl -s http://127.0.0.1:31013/api/brainbase/projects \
  -H 'Authorization: Bearer <token>' | jq .
```

`source.status`が`loaded`なら、返されたprojectが認証済みactorのgrantとRegistryのactive状態の積集合です。`status: ok`かつ`count: 0`相当の応答だけが確認済み空です。`unavailable`、`error`、`organization_context_required`は未確認であり、legacy topologyへフォールバックしてはいけません。

## 2. MCPのCatalogを確認する

`brainbase_projects`を引数なしで呼び出し、返却されたscope・status・audit evidenceを確認します。JWTの`projectCodes`とサーバー設定の許可範囲の積集合だけが返ること、呼び出し引数で範囲を拡張できないことを確認します。

## 3. Provisioningのreadbackを確認する

```bash
brainbase project provision status <run-id>
brainbase project provision verify <run-id>
```

`status`と`verify`の結果で、Registry、Graph validation、Auth Grant、Repository boundary、runtime catalogの各readbackを個別に確認します。ReceiptやHTTP成功だけでは`active`や`verified: true`と判断しません。未確認・不一致・取得不能が一つでもあれば、完了扱いにせず原因を復旧してから`resume`または再検証します。

`GRAPH_PROJECT_IDENTITY_BUSY`と`details.retryable: true`が返った場合は、一時的な同一IDロック競合です。恒久的なidentity conflictとしてmanifestを変更せず、先行処理の完了後に次を実行します。

```bash
brainbase project provision status <run-id>
brainbase project provision resume <run-id>
brainbase project provision verify <run-id>
```

`status`で先行処理やpartial failureの状態を読み戻してから`resume`し、最後に`verify`します。同じbusyが続く場合は自動成功扱いにせず、該当`entity_id`の実行中runとロック保持処理を調査します。

## 4. 廃止済みブラウザー導線を混同しない

`project.selector`は履歴記録であり、現役のUI/API/code/data surfaceはありません。`/device`はCLI等のデバイス認証を承認する画面で、Project Catalogやタスク選択画面ではありません。`/api/config`はローカルruntime topologyの情報であり、組織のProject Catalog・membership・grantの代替には使いません。

旧Session Launch Picker、Workspace Setup selector、NocoDB開始ボタンのブラウザー導線を再有効化して調査しないでください。Catalogの欠落は上記API/MCPのstatusとscopeを確認し、タスク/worktree操作はCodex app/CLIに戻します。

## 5. 証拠境界

Graph writerとGitHub writerの契約テストはfake/adapter doubleによる確認です。本番Graph/GitHub writesとproduction E2Eは対象外・未確認であり、ローカルテストやreadback契約を本番登録成功の証拠へ置き換えません。
