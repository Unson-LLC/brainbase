# Brainbase Web Surface Retirement Inventory

Status: accepted

Decision: `ADR-017-agent-first-product-surface`

Story: `story-brainbase-web-ui-retirement-v1`

## Purpose

Brainbase Webを画面名だけで一括廃止せず、各surfaceが持つ能力、API、browser-local state、後継面、削除条件をcurrent HEADの実装から固定する。この文書はWeb UI削除順の正本であり、MCP parityがない能力を「CodexやClaude Codeで代替済み」と扱わない。

## Evidence boundary

- `server/bootstrap/static-routes.js`は`/admin`、`/`、`/device`、`/setup`、`/workflows`を明示配信し、`express.static(publicDir)`が残りのHTMLを直接配信する。
- `mcp/brainbase/src/server.ts`のBrainbase MCPはGraph、Wiki、Personal KG検索に加え、`TSK-WEBRET-003`で認証済みproject catalogのcontrol-plane tool `brainbase_projects`を提供する。Workflow、Run、Inbox等は後続taskである。
- Workflow、Run、Session、SNS Growth、Admin visualization、setup、device authorizationのREST APIは存在するが、現在のBrainbase MCPには同等toolがない。
- `docs/brainbase-capabilities/capabilities/codex.app-server.yml`はClaude CodeとApp Server metadataのないCodex sessionについてxterm fallbackを維持すると定義する。
- 廃止前の`public/test-infrastructure.html`はproduction code、test、scriptから参照されず、外部`jsonplaceholder.typicode.com`を使う手動デモだった。`TSK-WEBRET-001`で削除し、static 404をcontract testで固定した。

## Surface inventory

| Surface | Current capability and dependency | Target owner | Current parity | Disposition | Retirement gate |
|---|---|---|---|---|---|
| `public/test-infrastructure.html` | 廃止済み。EventBus、Store、DI、HttpClientの手動デモで、実データではなく外部test APIへ通信していた | CLI/unit test | 完了。各componentは自動テスト対象で、production導線なし | `deleted` | `TSK-WEBRET-001`完了。参照0件、static 404、static route tests green |
| `public/meeting-workflow-pack.html` | 廃止済み。画面内の固定`ORGS`、`WF`、`RUNS`だけで動き、Workflow APIを呼ばないprototypeだった | Workflow Core + MCP + Companion | prototype廃止。Workflow Core、Meeting Pack bootstrap、実データpanelは維持 | `deleted_prototype` | `TSK-WEBRET-002`完了。page、専用runtime、deep-link、専用E2E、CSP例外を削除し、設計文書を`retired`で保持 |
| `public/admin.html` | overview、Graph、candidate store、Personal KG、context preview、data flow、healthのread-only visualization。JWT/localStorageとCSRFに依存 | MCP。接続不全はCompanion projection候補 | Graph/Wiki/Personal KGは一部あり。candidate、context preview、data flow、healthは未提供 | `move_to_mcp_then_delete` | admin read tools、project/actor scope、unavailable表現、audit evidenceをMCPで検証 |
| `public/setup.html` | JWT取得後に`/api/setup/config`を読み、user/project情報と`config.yml`をdownload | MCP bootstrap/config export。必要ならauth完了結果だけWeb | 未提供 | `shrink_or_delete` | config生成・取得をMCP化し、ブラウザdownloadが必須か再判定 |
| `public/device.html` | device code検証、Slack OAuth開始、approve/deny。sessionStorageとlocalStorageでcallbackを連結 | 最小Web | ブラウザ本人確認/OAuthのためWebが正規 | `keep_minimal_web` | verify、login、approve、deny以外の表示・依存を持たないこと |
| `public/sns-growth.html` | review pack、post一覧/更新、publish、feedback、account default/health。index shellにもoverlay導線あり | automation + MCP、承認・失敗・feedbackはCompanion | REST APIのみ。MCP/Companion parityなし | `move_then_delete` | read/update/publish-dry-run/feedback tools、外部送信確認、Companion projectionを検証 |
| `public/workflows.html` | 廃止対象のWorkflow CRUD、draft/test/publish、manual runと、移管対象のRun/Run Receipt/Human Approval/Meeting Automationが混在 | Automation Run Core + MCP + Companion | REST APIのみ。Brainbase MCP parityなし | `move_run_surfaces_then_delete` | 汎用Workflowを移植せず、Run/Receipt/Meeting Automationのauthorization/auditとCompanionの要介入projectionを検証 |
| `public/index.html` | Project/session作成・復旧、terminal、Codex App Server transcript、Tasks、Wiki、Live Feed、Inbox、Workflow/SNS overlay等の統合shell | Codex/Claude Code + MCP。auth/bootstrap/recoveryだけ最小Web | 能力ごとに不均一。Session/terminalとbrowser-local authへの依存が大きい | `delete_last` | 全機能を分解してMCP/Companion/Webへ移管し、最小Web entrypointを独立させること |
| `public/ttyd/custom_ttyd_index.html` | ttyd/xtermの実行時index。session runtimeが`--index`へ渡し、terminal bridge/testが直接依存 | native Codex/Claude Code。限定的runtime fallback | 未完。Claude Codeと旧Codex sessionはfallback依存 | `keep_transition` | Claude Codeを含むsession操作・復旧の代替とbreak-glass経路を実証 |
| `public/ttyd/ttyd_index.html` | ttyd upstream bundleの保管artifact。runtimeはcustom版を優先 | build/vendor artifactまたは削除 | runtime primaryではないがfallback関係を要確認 | `review_vendor_artifact` | custom版生成元・fallback・再生成手順を確認して保管要否を決定 |

## Capability gaps before deletion

Brainbase MCPに次のcontrol-plane tool群が必要である。REST endpointを直接呼べることだけではAgent-first parityとしない。

1. `project` / `auth scope`（`TSK-WEBRET-003`完了）: `brainbase_projects`が署名検証済みgrantとMCP設定の積集合だけを返し、ok/unavailable/error、actor、role、scope、request_id、sourceを保持する。
2. `session` / `runtime`: create、list、state、resume、stop、diagnose。途中状態を成功へ丸めない。
3. `automation run`: run detail、許可されたretry/cancel、human-step resolve、audit参照。汎用Workflow create/update/draft/test/publish/manual runは移植しない。
4. `run receipt inbox`: filter、latest collapse、history、blocked/unconfirmed/no_data/unavailableの保持。
5. `meeting automation`: source sync状態、ingest/reconcile診断、明示的に許可された再実行。汎用Workflow実行へfallbackしない。
6. `admin read`: candidate、context preview、data flow、healthをactor/project scope付きで参照。
7. `sns growth`: review、schedule、publish dry-run、feedback、account health。実投稿は明示確認を維持。
8. `bootstrap/config`: setup configの安全な生成・取得。secret値は返さない。

## Retirement order

1. **Isolated developer artifact**: `test-infrastructure.html`。
2. **Non-canonical prototype**: `meeting-workflow-pack.html`と`/workflows`のdeep-link。
3. **MCP control plane foundation**: project/auth、workflow/run/inbox、admin read、SNS、setup config。
4. **Companion focus projection**: human approval、blocked、failed、waiting_human、unconfirmed、no_data、feedback。
5. **Dedicated operational pages**: admin、setup、SNS Growth、Workflowsをevidence単位で廃止。
6. **Minimal Web extraction**: login/OAuth、device pairing、bootstrap result、break-glass recoveryだけを独立。
7. **Main shell and terminal**: index/ttydはsession/runtime fallbackを解消した最後に廃止。

## Implementation tasks

全taskの作業branchは`codex/run-receipt-inbox-v1`とする。各taskは個別commit可能な境界で実施する。

| Task | Scope | Completion evidence |
|---|---|---|
| `TSK-WEBRET-001` | `test-infrastructure.html`を削除 | 完了。参照0件、static 404、static route tests green |
| `TSK-WEBRET-002` | Meeting Pack mock prototypeとdeep-linkを削除 | 完了。static 404、`/workflows`にdead linkなし、Workflow Core/API testsと残存panel E2E green、設計docは`retired`で保持 |
| `TSK-WEBRET-003` | Brainbase MCP control-plane foundationを追加 | 完了。`brainbase_projects`をMCP registryへ追加。RESTでtoken検証とgrant scopeを強制し、MCPでtoken/config scopeの積集合、`ok`/`unavailable`/`error`、audit evidenceを返す。MCP 51 tests、REST 13 tests、MCP build green |
| `TSK-WEBRET-004` | Automation Run/Run Receipt Inbox MCP parityを追加 | detail/resolve/filter/history/diagnosisとfailure statesのcontract tests。汎用Workflow CRUD/draft/publish/manual runは対象外 |
| `TSK-WEBRET-005` | Agent Run InboxをMac Companionへ投影 | 要介入だけ表示、取得不能を0件化しない、feedback loop evidence |
| `TSK-WEBRET-006` | Workflow Mission Control Webと汎用Workflow製品面を廃止 | `/workflows`と専用UI/test/導線を削除し、Meeting AutomationとRun Core testsを維持 |
| `TSK-WEBRET-007` | Admin/SNS/setupの残能力をMCPへ移管 | 各surfaceのretirement gateをcurrent HEADで満たす |
| `TSK-WEBRET-008` | 最小Web auth/pairing/recovery surfaceを抽出 | browser必須能力だけがWebに残り、日常一覧・設定UIがない |
| `TSK-WEBRET-009` | index shellとttyd fallbackを廃止 | Codex/Claude Code sessionの作成・復旧・診断代替とrollback evidence |

`TSK-WEBRET-001`と`TSK-WEBRET-002`はMCP parityを待たずに実装できる。`TSK-WEBRET-003`は後継基盤だけを出荷し、旧画面は削除していない。`TSK-WEBRET-004`以降も後継能力を先に出荷し、同じ変更で旧画面を削除しない。
