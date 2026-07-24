# Brainbase Web Surface Retirement Inventory

Status: accepted

Decision: `ADR-017-agent-first-product-surface`

Story: `story-brainbase-web-ui-retirement-v1`

## Purpose

Brainbase Webを画面名だけで一括廃止せず、各surfaceが持つ能力、API、browser-local state、後継面、削除条件をcurrent HEADの実装から固定する。この文書はWeb UI削除順の正本であり、MCP parityがない能力を「CodexやClaude Codeで代替済み」と扱わない。

## Evidence boundary

- `server/bootstrap/static-routes.js`はGraph API landingの`/`と最小認証面の`/device`を配信する。旧operations command centerの`/app.js`は410、`/admin`、`/setup`、`/workflows`と旧ttyd assetsは404で固定した。
- `mcp/brainbase/src/server.ts`のBrainbase MCPはGraph、Wiki、Personal KG検索に加え、認証済みproject catalog、Run Receipt Inbox/history/diagnosis、Automation Run detail/human-step resolve、Meeting Automation diagnosis、bootstrap config、admin readを提供する。
- Admin visualizationとsetupのREST APIはMCP backendとして維持する。device authorizationはブラウザ本人確認/OAuthのため最小Webを正規面とする。SNSのCore API/ledgerはautomationから継続利用するが、専用Web UIは運用面として採用しない。
- `docs/brainbase-capabilities/capabilities/codex.app-server.yml`はClaude CodeとApp Server metadataのないCodex sessionについてxterm fallbackを維持すると定義する。
- 廃止前の`public/test-infrastructure.html`はproduction code、test、scriptから参照されず、外部`jsonplaceholder.typicode.com`を使う手動デモだった。`TSK-WEBRET-001`で削除し、static 404をcontract testで固定した。

## Surface inventory

| Surface | Current capability and dependency | Target owner | Current parity | Disposition | Retirement gate |
|---|---|---|---|---|---|
| `public/test-infrastructure.html` | 廃止済み。EventBus、Store、DI、HttpClientの手動デモで、実データではなく外部test APIへ通信していた | CLI/unit test | 完了。各componentは自動テスト対象で、production導線なし | `deleted` | `TSK-WEBRET-001`完了。参照0件、static 404、static route tests green |
| `public/meeting-workflow-pack.html` | 廃止済み。画面内の固定`ORGS`、`WF`、`RUNS`だけで動き、Workflow APIを呼ばないprototypeだった | Workflow Core + MCP + Companion | prototype廃止。Workflow Core、Meeting Pack bootstrap、実データpanelは維持 | `deleted_prototype` | `TSK-WEBRET-002`完了。page、専用runtime、deep-link、専用E2E、CSP例外を削除し、設計文書を`retired`で保持 |
| `public/admin.html` | 廃止済み。overview、Graph、candidate store、Personal KG、context preview、data flow、healthを混在表示していたread-only visualization | `brainbase_admin_read`。接続不全はレスポンスのsource stateとして保持 | 完了。7 view、project/actor scope、filter、context POST、audit evidenceをMCP contract testで固定 | `deleted` | `TSK-WEBRET-007`完了。page、CSS、browser module、UI/E2E/visual smokeを削除し、REST/API testsを維持 |
| `public/setup.html` | 廃止済み。JWT取得後にuser/project情報と`config.yml`をdownloadするだけで、設定編集・正本保存は行わなかった | `brainbase_bootstrap_config`。認証は`/device`、設定正本は`~/workspace/config.yml` | 完了。MCPが認証scope、audit evidence、`ok`/`unavailable`/`error`を保持してconfigを取得 | `deleted` | `TSK-WEBRET-007A`完了。page、専用browser controllerを削除し、static 404とMCP contract testを固定 |
| `public/device.html` | device code検証、Slack OAuth、consent、approve/denyだけを持つ。approveはBearer tokenを検証し、Slack identityをサーバー側で確定 | 最小Web | ブラウザ本人確認/OAuthのためWebが正規 | `keep_minimal_web` | `TSK-WEBRET-008`完了。5状態以外のUIなし、日常一覧・設定導線なし、caller提供identityを不採用 |
| `public/sns-growth.html` | 廃止済み。review pack、post一覧/更新、publish、feedback、account default/healthを持つ専用cockpitだった | automation + Core API/ledger。人間確認は既存の明示確認境界 | 専用Web UIは不要というproduct decisionで廃止。Core API/ledgerは維持 | `deleted_ui` | `TSK-WEBRET-010`完了。page、専用view、旧shell接続、CSS、UI/E2E testsを削除し、static 404とCore API testsを維持 |
| `public/workflows.html` | 廃止済み。Workflow CRUD、draft/test/publish、manual runとRun/Meeting運用が混在していた | Automation Run Core + MCP + Companion | Run Receipt、Run detail/resolve、Meeting診断、Companion要介入projectionへ分離済み | `deleted` | `TSK-WEBRET-006`完了。page、route、overlay、browser modules、旧UI tests、deep-linkを削除し、Core/API testsを維持 |
| `public/index.html` | 廃止済み。Project/session、terminal、Codex transcript等を束ねた旧operations command center | Codex/Claude Code + MCP | Session/worktree/terminal runtimeの物理削除後、`/`をGraph API landingへ置換 | `deleted` | `TSK-WEBRET-009`完了。pageとentrypoint、専用testを削除し、`/app.js`を410で固定 |
| `public/ttyd/custom_ttyd_index.html` | 廃止済み。旧browser terminal shell | native Codex/Claude Code | session/terminal runtimeとfallback scriptを先に物理削除済み | `deleted` | `TSK-WEBRET-009`完了。runtime参照0件、static 404 |
| `public/ttyd/ttyd_index.html` | 廃止済み。旧ttyd upstream vendor artifact | native Codex/Claude Code | runtime consumerなし | `deleted` | `TSK-WEBRET-009`完了。static 404 |

## Capability gaps before deletion

Brainbase MCPに次のcontrol-plane tool群が必要である。REST endpointを直接呼べることだけではAgent-first parityとしない。

1. `project` / `auth scope`（`TSK-WEBRET-003`完了）: `brainbase_projects`が署名検証済みgrantとMCP設定の積集合だけを返し、ok/unavailable/error、actor、role、scope、request_id、sourceを保持する。
2. `session` / `runtime`: create、list、state、resume、stop、diagnose。途中状態を成功へ丸めない。
3. `automation run`: run detail、許可されたretry/cancel、human-step resolve、audit参照。汎用Workflow create/update/draft/test/publish/manual runは移植しない。
4. `run receipt inbox`: project filter、latest collapse、history、diagnosis、blocked/unconfirmed/no_data/unavailableの保持は実装済み。
5. `meeting automation`: source sync状態、ingest/reconcile診断、明示的に許可された再実行。汎用Workflow実行へfallbackしない。
6. `admin read`（`TSK-WEBRET-007`完了）: `brainbase_admin_read`がoverview、Graph entities、candidate、Personal KG、context preview、data flow、healthをactor/project scope付きで参照する。
7. `sns growth`: review、schedule、publish dry-run、feedback、account health。実投稿は明示確認を維持。
8. `bootstrap/config`: `brainbase_bootstrap_config`でsetup configを安全に生成・取得する。secret値は返さない。ブラウザdownloadは廃止済み。

## Retirement order

1. **Isolated developer artifact**: `test-infrastructure.html`。
2. **Non-canonical prototype**: `meeting-workflow-pack.html`と`/workflows`のdeep-link。
3. **MCP control plane foundation**: project/auth、workflow/run/inbox、admin read、SNS、setup config。
4. **Companion focus projection**: human approval、blocked、failed、waiting_human、unconfirmed、no_data、feedback。
5. **Dedicated operational pages**: admin、setup、SNS Growth、Workflowsをevidence単位で廃止。
6. **Minimal Web extraction**: login/OAuth、device pairing、break-glass recoveryだけを独立。bootstrap configはMCP/CLIが所有する。
7. **Main shell and terminal**: index/ttydはsession/runtime fallbackを解消した最後に廃止。

## Implementation tasks

全taskの作業branchは`codex/run-receipt-inbox-v1`とする。各taskは個別commit可能な境界で実施する。

| Task | Scope | Completion evidence |
|---|---|---|
| `TSK-WEBRET-001` | `test-infrastructure.html`を削除 | 完了。参照0件、static 404、static route tests green |
| `TSK-WEBRET-002` | Meeting Pack mock prototypeとdeep-linkを削除 | 完了。static 404、`/workflows`にdead linkなし、Workflow Core/API testsと残存panel E2E green、設計docは`retired`で保持 |
| `TSK-WEBRET-003` | Brainbase MCP control-plane foundationを追加 | 完了。`brainbase_projects`をMCP registryへ追加。RESTでtoken検証とgrant scopeを強制し、MCPでtoken/config scopeの積集合、`ok`/`unavailable`/`error`、audit evidenceを返す。MCP 51 tests、REST 13 tests、MCP build green |
| `TSK-WEBRET-004` | Automation Run/Run Receipt Inbox MCP parityを追加 | 完了。Run Receipt filter/history/diagnosis、Automation Run detail/human-step resolve、Meeting diagnosisを追加。汎用Workflow CRUD/draft/publish/manual runは対象外 |
| `TSK-WEBRET-005` | Agent Run InboxをMac Companionへ投影 | 完了。要介入だけを既存Inboxへ表示し、取得不能時は前回成功snapshotを保持。source identity単位のstable IDでfeedbackを次Runへ継承。companion commits `3982070`、`a3964b3`、full suite 373 tests green |
| `TSK-WEBRET-006` | Workflow Mission Control Webと汎用Workflow製品面を廃止 | 完了。`/workflows`と専用UI/state/client/test/導線/deep-linkを削除し、Meeting AutomationとRun Core testsを維持 |
| `TSK-WEBRET-007` | Admin/setupの残能力をMCPへ移管 | 完了。`brainbase_admin_read`と`brainbase_bootstrap_config`へ移管し、両Web面を削除。REST backend、config正本、認証scope、audit、失敗状態を維持 |
| `TSK-WEBRET-007A` | Setup configをMCPへ移管しSetup Webを廃止 | 完了。`brainbase_bootstrap_config`、scope/audit/失敗状態、static 404、MCP/static tests green |
| `TSK-WEBRET-008` | 最小Web auth/pairing/recovery surfaceを抽出 | 完了。verify、OAuth、consent、approve/deny、結果だけを残し、approveを認証済みSlack identityへbind。surface/API contract tests green |
| `TSK-WEBRET-009` | index shellとttyd fallbackを廃止 | 完了。rootをGraph API landingへ縮退し、旧entrypointは410、ttyd assetsは404。Codex task/terminalがowner |
| `TSK-WEBRET-010` | SNS Growth専用Web UIを廃止 | 完了。Core API/ledger/automationを維持し、page、view、旧shell接続、共有旧CSS、UI/E2E testsを削除。static 404を固定 |

`TSK-WEBRET-001`から`010`まで完了した。Workflow Web、旧session shell、SNS専用Web UI、Admin Web、Setup Webは削除済みであり、Meeting Automation、Run台帳、SNS Core API/ledger、admin/setup REST backend、config正本はCoreとして残る。唯一のproduction Web UIである`device`は本人確認、OAuth、consent、pairingだけに限定し、承認者identityは認証済みtokenからサーバー側で確定する。
