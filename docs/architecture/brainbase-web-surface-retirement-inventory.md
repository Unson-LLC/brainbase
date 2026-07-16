# Brainbase Web Surface Retirement Inventory

Status: accepted

Decision: `ADR-017-agent-first-product-surface`

Story: `story-brainbase-web-ui-retirement-v1`

## Purpose

Brainbase Webを画面名だけで一括廃止せず、各surfaceが持つ能力、API、browser-local state、後継面、削除条件をcurrent HEADの実装から固定する。この文書はWeb UI削除順の正本であり、MCP parityがない能力を「CodexやClaude Codeで代替済み」と扱わない。

## Evidence boundary

- `server/bootstrap/static-routes.js`は`/admin`、`/`、`/device`、`/setup`、`/workflows`を明示配信し、`express.static(publicDir)`が残りのHTMLを直接配信する。
- `mcp/brainbase/src/server.ts`のBrainbase MCPはGraph、Wiki、Personal KG検索を中心とし、`mcp/brainbase/src/tools/mesh-tools.ts`は`mesh_query`と`mesh_peers`だけを追加する。
- Workflow、Run、Session、SNS Growth、Admin visualization、setup、device authorizationのREST APIは存在するが、現在のBrainbase MCPには同等toolがない。
- `docs/brainbase-capabilities/capabilities/codex.app-server.yml`はClaude CodeとApp Server metadataのないCodex sessionについてxterm fallbackを維持すると定義する。
- 廃止前の`public/test-infrastructure.html`はproduction code、test、scriptから参照されず、外部`jsonplaceholder.typicode.com`を使う手動デモだった。`TSK-WEBRET-001`で削除し、static 404をcontract testで固定した。

## Surface inventory

| Surface | Current capability and dependency | Target owner | Current parity | Disposition | Retirement gate |
|---|---|---|---|---|---|
| `public/test-infrastructure.html` | 廃止済み。EventBus、Store、DI、HttpClientの手動デモで、実データではなく外部test APIへ通信していた | CLI/unit test | 完了。各componentは自動テスト対象で、production導線なし | `deleted` | `TSK-WEBRET-001`完了。参照0件、static 404、static route tests green |
| `public/meeting-workflow-pack.html` | 画面内の固定`ORGS`、`WF`、`RUNS`で動くprototype。Workflow APIを呼ばない。`/workflows`からdeep-linkあり | Workflow Core + MCP + Companion | 実データparityなし。ただしprototype自体は正本能力ではない | `delete_prototype` | `/workflows`のdeep-linkを除去し、必要な設計知見をStory/Specへ残すこと |
| `public/admin.html` | overview、Graph、candidate store、Personal KG、context preview、data flow、healthのread-only visualization。JWT/localStorageとCSRFに依存 | MCP。接続不全はCompanion projection候補 | Graph/Wiki/Personal KGは一部あり。candidate、context preview、data flow、healthは未提供 | `move_to_mcp_then_delete` | admin read tools、project/actor scope、unavailable表現、audit evidenceをMCPで検証 |
| `public/setup.html` | JWT取得後に`/api/setup/config`を読み、user/project情報と`config.yml`をdownload | MCP bootstrap/config export。必要ならauth完了結果だけWeb | 未提供 | `shrink_or_delete` | config生成・取得をMCP化し、ブラウザdownloadが必須か再判定 |
| `public/device.html` | device code検証、Slack OAuth開始、approve/deny。sessionStorageとlocalStorageでcallbackを連結 | 最小Web | ブラウザ本人確認/OAuthのためWebが正規 | `keep_minimal_web` | verify、login、approve、deny以外の表示・依存を持たないこと |
| `public/sns-growth.html` | review pack、post一覧/更新、publish、feedback、account default/health。index shellにもoverlay導線あり | automation + MCP、承認・失敗・feedbackはCompanion | REST APIのみ。MCP/Companion parityなし | `move_then_delete` | read/update/publish-dry-run/feedback tools、外部送信確認、Companion projectionを検証 |
| `public/workflows.html` | Workflow CRUD、draft/test/publish、run/rerun、human-step resolve、control resources、Meeting Pack bootstrap、Run Receipt Inbox | Core + MCP + Companion | REST APIのみ。Brainbase MCP parityなし | `move_then_delete` | Workflow/Run/Inbox toolsとauthorization/audit、Companionの要介入projectionを検証 |
| `public/index.html` | Project/session作成・復旧、terminal、Codex App Server transcript、Tasks、Wiki、Live Feed、Inbox、Workflow/SNS overlay等の統合shell | Codex/Claude Code + MCP。auth/bootstrap/recoveryだけ最小Web | 能力ごとに不均一。Session/terminalとbrowser-local authへの依存が大きい | `delete_last` | 全機能を分解してMCP/Companion/Webへ移管し、最小Web entrypointを独立させること |
| `public/ttyd/custom_ttyd_index.html` | ttyd/xtermの実行時index。session runtimeが`--index`へ渡し、terminal bridge/testが直接依存 | native Codex/Claude Code。限定的runtime fallback | 未完。Claude Codeと旧Codex sessionはfallback依存 | `keep_transition` | Claude Codeを含むsession操作・復旧の代替とbreak-glass経路を実証 |
| `public/ttyd/ttyd_index.html` | ttyd upstream bundleの保管artifact。runtimeはcustom版を優先 | build/vendor artifactまたは削除 | runtime primaryではないがfallback関係を要確認 | `review_vendor_artifact` | custom版生成元・fallback・再生成手順を確認して保管要否を決定 |

## Capability gaps before deletion

Brainbase MCPに次のcontrol-plane tool群が必要である。REST endpointを直接呼べることだけではAgent-first parityとしない。

1. `project` / `auth scope`: project catalog、actor grant、stale credentialの明示。
2. `session` / `runtime`: create、list、state、resume、stop、diagnose。途中状態を成功へ丸めない。
3. `workflow` / `run`: list/get/create/update、draft/test/publish、run/rerun、human-step resolve、audit参照。
4. `run receipt inbox`: filter、latest collapse、history、blocked/unconfirmed/no_data/unavailableの保持。
5. `admin read`: candidate、context preview、data flow、healthをactor/project scope付きで参照。
6. `sns growth`: review、schedule、publish dry-run、feedback、account health。実投稿は明示確認を維持。
7. `bootstrap/config`: setup configの安全な生成・取得。secret値は返さない。

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
| `TSK-WEBRET-002` | Meeting Pack mock prototypeとdeep-linkを削除 | `/workflows`にdead linkなし、Workflow API/E2Eは維持、設計docは保持 |
| `TSK-WEBRET-003` | Brainbase MCP control-plane foundationを追加 | tool contract tests、auth/project scope、unavailable/error/audit evidence |
| `TSK-WEBRET-004` | Workflow/Run/Run Receipt Inbox MCP parityを追加 | CRUD/draft/run/resolve/filter/historyとfailure statesのcontract tests |
| `TSK-WEBRET-005` | Agent Run InboxをMac Companionへ投影 | 要介入だけ表示、取得不能を0件化しない、feedback loop evidence |
| `TSK-WEBRET-006` | Admin/SNS/setupの残能力をMCPへ移管 | 各surfaceのretirement gateをcurrent HEADで満たす |
| `TSK-WEBRET-007` | 最小Web auth/pairing/recovery surfaceを抽出 | browser必須能力だけがWebに残り、日常一覧・設定UIがない |
| `TSK-WEBRET-008` | index shellとttyd fallbackを廃止 | Codex/Claude Code sessionの作成・復旧・診断代替とrollback evidence |

`TSK-WEBRET-001`と`TSK-WEBRET-002`はMCP parityを待たずに実装できる。`TSK-WEBRET-003`以降は後継能力を先に出荷し、同じ変更で旧画面を削除しない。
