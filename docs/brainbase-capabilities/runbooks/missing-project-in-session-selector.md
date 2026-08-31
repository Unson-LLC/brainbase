# Runbook: Project Catalog Access and Readback

認証済みのCLI/API/MCPでProject Catalogが見えない、またはProject Provisioningの完了を確認できない場合に使います。

サーバー側の`session.create`/static endpointとブラウザのSession Launch Pickerはretiredかつ到達不能です。ブラウザのProject Catalog consumerはWorkspace Setupだけです。

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

## 4. 退役済みSession Launch Pickerの入口を確認する

desktop/mobileの新規セッション操作は`EVENTS.CREATE_SESSION`を発火しますが、現在のhandlerはCodex移行案内へfail-closedします。次を確認します。

- desktopの`#add-session-btn`とmobileの`#mobile-new-session-btn`が同じCodex移行案内を表示する。
- `#session-launch-picker`と`#create-session-modal`を表示しない。
- `/api/sessions`、`/api/sessions/start`、`/api/sessions/create-with-worktree`を呼ばない。
- `session-creation-mixin.js`の過去実装を現在の受け入れ証拠やProject Catalog consumerとして使わない。

## 5. Workspace Setupとの境界を確認する

`/api/config`は個人ごとのWorkspace Setup用legacy topologyです。local pathやclone先が未設定でも、Registry上のprojectがCatalogから消えたことを意味しません。逆に、Registryへの登録だけで個人Workspaceが準備済みになることもありません。タスクとworktreeの作成・所有はCodex app/CLIが担い、Workspace Setupは別Capabilityとして扱います。

## 6. 証拠境界

Graph writerとGitHub writerの契約テストはfake/adapter doubleによる確認です。本番Graph/GitHub writesとproduction E2Eは対象外・未確認であり、ローカルテストやreadback契約を本番登録成功の証拠へ置き換えません。
