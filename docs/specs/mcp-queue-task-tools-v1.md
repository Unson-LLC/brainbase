# Spec: 公開MCP queue task tools v1

Story ID: `story-mcp-queue-task-tools-v1`
親Story: [公開MCPでTask queueの仕事を進める](../stories/story-mcp-queue-task-tools-v1.md)

状態: Planned / Unreleased。本PRは文書のみ。以下の「規定」は実装候補の契約であり、Releasedの機能ではない。

## 決定

- 日時: 2026-11-01 18:19 JST
- 決定者: owner
- 原文: 「brainbase#929 は get_task と claim_task を足した7つで進めてよい」

これにより公開queue toolsは`get_task` / `claim_task`を含む7 toolsで確定した（owner承認済み、2026-11-01）。2 toolsのサーバー側専用APIの形は未確認のままで、host adapterの契約として扱う。実装は未着手。

## 根拠と所有境界

確認した公開実装:

- `src/tools.ts`: local SSOTの取得関数。MCP名は`src/server.ts`の`get_context`、`resolve_entity`等のsnake_caseに揃う。queue toolsはまだ含まれない。
- `src/mcp-runtime.ts`: `createLocalMcpServer`へtool定義とhandlerを注入できる。例外の汎用テキスト化では業務エラーのcodeを保持できないため、queue handler内で結果へ変換する。
- `src/streamable-http.ts`: `authenticate` / `requestScope` / `createServer`のDIとsession管理。認証省略を許す汎用transport自体はagent認可を保証しない。
- `src/canonical-task-service.ts`: `listTasks` / `getTask` / `updateTask` / `transitionTask`、policy、CAS、audit、operation repository。queueのclaim / renew / evidence専用メソッドはない。
- `src/canonical-task-contract.ts`: canonical状態は`pending | in_progress | waiting | completed | cancelled`。
- `src/canonical-task-operations.ts`: operation keyとfingerprintによる再送・競合、writer / readiness制約。

operator overlayの固定snapshotからtool定義・handler・tests・server登録をread-onlyで確認した。queueとして確認できたのは`list_my_tasks`、`claim_next`、`renew_claim`、`update_status`、`attach_evidence`。`get_task`は別の汎用read経路にあり、agent限定の詳細readであることは未確認。ID指定claimと独立したclose / complete toolは確認できなかった。従って「そのまま移植すれば全要件が満たされる」とは扱わない。

公開packageはschema、結果検証、tool登録、`QueueTaskBackend` interfaceを所有する。hostはbackendと検証済みagent contextを注入する。HTTP route、URL、credential、認証更新、HTTP body / headerへの変換はhost adapterだけが所有し、公開packageに特定サービス向けHTTP clientを含めない。有効化とはbackend注入を意味し、別の有効化flagは設けない。backend未注入ならqueue toolsを登録せず、既存local-first動作にhosted serviceを要求しない。

`QueueTaskBackend`の規定案は`list(context, input)`、`get(context, input)`、`claim(context, {mode: "next" | "by_id", ...input})`、`renew(context, input)`、`evidence(context, input)`、`status(context, input)`。すべてPromiseで下記の成功queueまたは構造化エラーを返す。contextはhostが検証したagent identityを持ち、MCP入力とは分離する。inputは下表のschemaに従い、writeは解決済みidempotency keyを含む。get / by_idはowner承認済み（2026-11-01）のため、他のqueue toolsと同じく有効にする。backendは認可・atomic claim・CAS・冪等性を保証し、公開handlerは成功shapeを検証する。ローカルのin-memory reference backendを契約テストfixtureとして用意し、外部サービスなしで全scenarioを実行する。これは永続queueの提供を意味しない。

## tool一覧とcanonical operationへの対応

全入力はJSON object、`additionalProperties: false`。表の`?`は省略可能、その他は必須。入力にprincipal / assignee / scope / API URL / tokenを受け付けない。

| MCP名 | 入力JSON shape | canonical operation / API要求 | 確認区分 |
| --- | --- | --- | --- |
| `list_my_tasks` | `{"statuses"?: Status[], "limit"?: integer, "cursor"?: string}` | agent queue list。`listTasks`相当のreadだがagent限定backendを使う | 確認済み |
| `get_task` | `{"task_id": string}` | agent限定get。`getTask`相当 | owner承認済み（2026-11-01）。専用APIは未確認 |
| `claim_task` | `{"task_id": string, "idempotency_key"?: string}` | 指定Taskをagentとしてatomic claim | owner承認済み（2026-11-01）。operation / APIは未確認 |
| `claim_next` | `{"idempotency_key"?: string}` | backend claim (mode: next)へ同じoperation keyを渡す | 確認済み |
| `renew_claim` | `{"task_id": string, "idempotency_key"?: string}` | backend renew | 確認済み |
| `attach_evidence` | `{"task_id": string, "expected_version": integer, "kind": EvidenceKind, "ref": object, "idempotency_key"?: string}` | backend evidence | 確認済み |
| `update_status` | `{"task_id": string, "expected_version": integer, "to_status": QueueStatus, "waiting_on"?: string, "idempotency_key"?: string}` | backend status | 確認済み |

`Status = pending | in_progress | waiting | completed | cancelled`。
`QueueStatus = started | waiting_for_review | blocked | done`。
`EvidenceKind = pull_request | ci | production_readback`。

- `task_id`は1〜256 Unicode code pointsの不透明な文字列で空白のみを拒否する。HTTP adapterではpath segmentとして一度だけencodeし、`/`をpath階層にしない。
- `limit`は1〜50の整数。cursorは不透明な文字列。省略時のAPI既定limit・cursor有効期限は未確認。tool呼出しは1ページだけ返し、自動巡回しない。consumerへの推奨として、全件取得は空ページでも次cursorへ進めるが、同一cursor再出現または100ページ到達時は巡回を停止し、部分結果を全件取得済みと表示しない。この停止はconsumer側の制御であり、公開toolのエラーコードやAC-2の検収対象には含めない。
- `expected_version`は1以上の整数。`ref`はplain JSON objectで、配列・nullを拒否する。kindごとの必須ref項目は未確認。merged PRの参照を渡しても、マージ済み判定はAPI側が行う。
- `blocked`では1〜2000 Unicode code pointsで空白のみでない`waiting_on`が必須。他の状態では禁止する。
- close / completeは別名toolを追加せず、`update_status`の`to_status: "done"`に統一する。人間の承認をagentから捏造しない。
- queue状態からcanonical状態への変換はAPI所有。`started → in_progress`、`blocked → waiting`、`done → completed`が想定だが、`waiting_for_review`を含め実際の変換は未確認。clientで推測変換しない。
- claimを`updateTask`のassignee変更、evidenceを`source_refs_append`、closeを直接`transitionTask`で代用しない。queueの認可・lease・完了gateを迂回するためである。

HTTP route・query・header・bodyの詳細とサービス固有の拒否codeはhost adapter内に閉じる。公開契約は上記backend interfaceであり、特定routeへの接続を前提としない。

## 出力JSONとMCP envelope

確認済みqueue handlerは成功時にAPIのplain objectを加工せず`queue`へ返す。field単位の検証はまだない。以下のPage / read / evidence / renewal / statusの最小shapeは公開規定案であり、server実応答との一致は未確認。ownerが確認するまでは互換を断定しない。

```json
{"status":"ok","queue":{"items":[],"next_cursor":null}}
```

```json
{"status":"ok","queue":{"task":{"id":"task_1","version":1,"status":"pending"}}}
```

```json
{"status":"ok","queue":{"status":"claimed","task":{"id":"task_1","version":1,"status":"pending"},"claimed_until":"2026-11-01T01:00:00Z","replayed":false,"renew_interval_minutes":5}}
```

```json
{"status":"ok","queue":{"status":"no_claimable_task"}}
```

- listは`items: Task[]`、`next_cursor: string | null`を必須とする規定案。空queueは成功。totalや全件取得を推定しない。
- get / evidence / statusは`task: Task`必須という規定案。renewalは`task: Task, claimed_until: string`必須という規定案。その他のAPI fieldは保持する。
- `Task`の最小shapeは`{id: string, version: integer >= 1, status: Status}`。title等はcanonical recordの追加fieldとして保持する。上のJSONは最小例であり完全なTask recordではない。
- claim nextの2種類の応答とclaimedのfieldはoverlayのfixtureで確認済み。ID指定claimにもclaimed shapeを使う規定案。APIがTaskを返さない場合の補完readは勝手に行わず契約を確定する。
- APIで書込みが成功しても、契約不正なら成功を作らず`task_contract_error`とする。確認できないversionやreceiptを生成しない。

業務エラーのshape:

```json
{"status":"error","error":{"code":"agent_scope_denied","message":"Task scope denied","http_status":403,"details":{}}}
```

```json
{"status":"unavailable","error":{"code":"task_api_unavailable","message":"Task API unavailable","http_status":503,"details":{"server_code":"task_store_unavailable","body":{}}}}
```

`error.code` / `message`は必須。`http_status`はAPI応答がある時、`details`は安全に公開できる詳細がある時のみ。資格情報・内部stack・運用設定を含めない。通常の非機密API bodyは保持し、機密値が混在する場合のredaction policyはhostが決める。

MCP `tools/call`は`content: [{type: "text", text: JSON.stringify(result)}]`。`status !== "ok"`なら`isError: true`、成功時は省略またはfalse。`structuredContent`はv1必須にしない。HTTPの200は業務成功の証明ではなくresult.statusで判定する。入力JSON-RPC自体の不正と業務エラーを混同しない。

## 認証・認可

principalは呼出し時に認証したagent自身であり、引数の値や共有service identityではない。hostは呼出しごとに検証済みidentityとagent専用credentialを結びつける。資格情報がない・空・更新失敗ならAPIへ送らず`task_auth_unavailable`。person credential / shared service tokenへのfallbackは禁止する。

一覧・詳細は自身に割当済み、またはAPI policyが自身にassignableと判定したTaskだけを返す。claimもその範囲に限る。evidence / 状態更新 / renewは有効な自分のclaim等、APIが要求する所有条件を満たす必要がある。全Task閲覧、他agentの代理、`*`によるscope拡大を認めない。不明なauthorityは拒否し、単なるlist filterを認可として扱わない。

`canonical-task-principal.ts`には現在agent型がない。agentをpersonに偽装したり、公開kernelへ新しい型を無断追加しない。agent identityと既存principalのhost側binding方式は未確認で、owner判断が必要。公開toolsは注入されたbackendを経由するのでkernelのprincipal型変更を前提にしない。

HTTPでは認証を各requestで行い、session IDを権限として扱わない。同じsession IDを別agentが送っても既存agentのhandler権限を使わせない。現行transportにはidentity一致の明示検査がないため、host側session binding / 呼出し時検証を契約テストで必須化する。stdioは起動hostから信頼されたidentity providerを注入し、tool argumentsから変更できなくする。

## 冪等性と競合

全writeで任意の`idempotency_key`を受ける。空白のみと予約prefix `api:` / `workflow:`を拒否する。未指定は1回の論理呼出しで生成した`mcp:<opaque-id>`を使う。backend再試行でも同じキーを保つ。新しいMCP呼出しの自動生成キーは前回の再送保証にならないので、agentが再送する時は明示キーを再利用する。

- claimを同じagent・同じキー・同じ入力で2回呼ぶと同じTaskのclaim結果をreplayし、次のTaskを取らない。backendへ同じoperation keyを渡す。HTTP adapterで複数箇所へ転送する場合も一致させる。別agentへの結果漏洩を禁止する。
- 同じキーを異なる入力へ使うと`idempotency_conflict`。versionを取り直して別入力にする場合は新しいキーを使う。
- 同じevidenceを同じキー・同じexpected_versionで再送しても追加数・versionを増やさない。objectキー順を変えた場合も同一入力とする公開規定案。異なるキーで同じrefを添付した場合の重複除去は未確認であり保証しない。
- doneの同一操作再送は成功結果をreplayし、再完了・二重auditを起こさない。別キーで既にcompletedのTaskをcloseした場合は成功を捏造せず、APIのversion / transition拒否を返す。具体的server codeは未確認。
- replay時もprincipal / scope / 現在の認可を検証する。失効claim / 変更後scopeを以前の成功結果だけで許可しない。拒否の具体codeとlease更新のreplay結果は未確認。
- CAS競合はAPIの拒否を返す。clientでversionを上げて自動再適用しない。通信切断後の書込み成否はunknownのまま同じキーで確認する。

以上の永続的保証はAPI側の責務。overlayで確認できたのはキー生成・転送とfixtureでのreadbackであり、serverの重複排除実装やdurable replayは未確認。必要な保証がAPIにない場合、このdocsだけでserver変更を承認した扱いにせず別Storyに分ける。

## エラー規定

### 公開handler

| 条件 | status / code | 動作 |
| --- | --- | --- |
| schema不正、未知field、wildcard scope入力 | `error / task_input_invalid` | backend未呼出し |
| agent認証を取得できない | `unavailable / task_auth_unavailable` | fallback・backend呼出しなし |
| backendがthrow / rejectする | `unavailable / task_api_unavailable` | writeは`details.outcome: "unknown"`。handlerは未送信を証明できず、例外本文を公開しない。自動再送せず同じキーでのみ再確認する |
| backend結果がJSON objectでない、成功またはエラーshapeが不正 | `error / task_contract_error` | 成功扱いしない。writeのoutcomeはunknown |

### QueueTaskBackendの結果契約

backendは成功queueまたは上記の構造化エラーを返す。公開handlerはshapeを検証し、妥当なstatus / code / 安全なdetailsを保持してMCP結果へ変換する。HTTP応答を解析しない。

| 条件 | status / code | 動作 |
| --- | --- | --- |
| 通信不能・サービス障害 | `unavailable / task_api_unavailable` | writeでは`details.outcome: "not_sent" | "unknown"`必須。backendが未送信を証明できる場合のみnot_sent。それ以外はunknown |
| backendの認証拒否 | `unavailable / task_auth_unavailable` | writeでは`details.outcome: "not_sent" | "unknown"`必須。backendが未送信を証明できる場合のみnot_sent。それ以外はunknown。自動再送や別credentialへのfallbackなし |
| 非機密な業務拒否 | `error / backendのcode` | 拒否codeを保持する |

### host HTTP adapterの契約

以下はhost所有のHTTP変換であり、公開handlerのHTTP処理ではない。共有runnerのhost-adapter専用scenarioをoperator overlayが非本番HTTP fixtureで実行する。

| HTTP条件 | backend結果への変換 | 動作 |
| --- | --- | --- |
| network例外、5xx | `unavailable / task_api_unavailable` | 未送信をadapterが証明した場合のみnot_sent。送信後timeout・応答喪失・5xxはunknown。5xxはhttp_statusと安全なserver_code / bodyを保持 |
| 401 | `unavailable / task_auth_unavailable` | 他4xxのcode抽出より優先。fallbackなし。送信済みwriteはunknown |
| 401以外の4xx | `error / APIのcode` | codeがなければ文字列error、両方なければtask_api_error |
| redirect / opaque redirect | `error / task_api_error` | redirectを追わずcredentialを転送しない |
| 非JSONまたは不正な成功body | `error / task_contract_error` | 成功扱いしない。送信済みwriteはunknown |

401は業務上の拒否ではなく、認証済みagentとしてbackendを利用できない状態を示すため、errorではなく`unavailable / task_auth_unavailable`へ変換する。

host側の正確なテスト名は`host adapter maps HTTP failures without forwarding credentials`とする。ファイルはhost所有の`tests/queue-task-backend-http.test.ts`、共有scenarioの配布元は`src/testing/queue-task-tools-contract.ts`。このファイルとテスト名は別repositoryのoperator overlay側への実装契約であり、本PRと公開CIではその存在・実行結果を検証できない。公開側はこのHTTP処理を実装せず、AC-8で各変換後の構造化結果をfixture backendから返して検査する。

backendの非機密な拒否codeはそのまま保持し、`no_claimable_task`へ置換しない。`idempotency_conflict`は公開operation coordinatorで確認済みだがqueue backendでのcode一致は未確認。not found、lease失効、stale version、既完了、完了gate不足の具体codeはhost契約で確認する。

## annotations

| tools | readOnlyHint | destructiveHint | idempotentHint | openWorldHint |
| --- | --- | --- | --- | --- |
| `list_my_tasks`, `get_task` | true | false | true | true |
| `claim_task`, `claim_next`, `renew_claim`, `attach_evidence`, `update_status` | false | true | false | true |

writeはキー省略時に別操作になるため、無条件のidempotentHintを宣言しない。状態・割当・evidenceを変更するので保守的にdestructiveHintをtrueとする。annotationsは認可の代わりにならない。overlayのqueue定義そのものにはannotationsがなく、公開規定案である。

## transport parityと共有契約テスト

`createLocalMcpServer`へ同じdefinitions / handlersを登録し、実stdio subprocessと`createStreamableHttpHandler`を使うloopback HTTPで`initialize → tools/list → tools/call`を実行する。mock handlerを直接呼ぶだけではparity検証にならない。HTTP session削除・認証拒否も確認する。既存`tests/mcp-contract.test.ts`の18 toolsを無条件に増やさず、queueを有効にした別fixtureで検証する。

将来の`src/testing/queue-task-tools-contract.ts`は共通scenario関数をexportし、`connect` / `close` / QueueTaskBackend fixture制御をadapterとして受ける。公開側2 transportとoperator overlayが同じscenarioを実行する。scenarioのコピーは禁止する。API fixtureはsyntheticなTaskと役割IDだけで、実Taskへ書き込まない。状態変化・呼出し回数・keysもassertし、応答fixtureを返すだけで冪等性成功と扱わない。

公開の`@unson/brainbase-mcp/queue-task-tools`と、test専用`@unson/brainbase-mcp/testing/queue-task-tools-contract`のsubpath追加を規定案とする。後者はVitestをruntime dependencyにせずassertion / fixture adapterを受ける。`rootDir: src`のbuildで`dist/testing/queue-task-tools-contract.js`と`.d.ts`を生成し、test専用subpathのexportsをそこへ向ける。tarballのdistへ含める。既存packageのexportsにはまだ存在しない。配布方式はowner判断が必要。operator overlayは公開subpathと同じversionのtest runnerをimportし、自身のstdio / HTTP adapterで同じscenario名を実行する。ローカルの共通fixtureと利用側APIの非本番contract確認は別の証拠として残す。

移行条件は、公開packageが必要toolsとstdio / HTTP契約を提供し、operator overlayが公開packageを参照して同じcontract testsを通すこと。その後に利用側で重複を削除する。公開側テスト成功だけで移行完了としない。

## 受け入れ条件と追加するテスト

get_task / claim_taskはowner承認済み（2026-11-01）であり、backend注入時に他の5 toolsと同じく登録する。AC-1は7 toolsの登録をassertする。同じtransport別describe内へ次の2つの`it`を必ず追加する。getは`AC-2 reads an approved task by id`、by_idは`AC-4 claims an approved task by id without duplicates`。2 toolsの専用APIは未確認のため、これらはhost adapter契約に従うfixture backendで検証する。

以下は実装時に追加する正確なファイルと`it`名。共通scenarioはAC-2〜AC-9を両transportへ適用する。`tests/queue-task-tools-transport.test.ts`はAC-2〜AC-9だけを`describe.each(["stdio", "http"])`内へ下表と完全一致する`it`名で登録する。AC-10とAC-11は同じファイルのtop-level `it`とし、AC-10は両transportを比較、AC-11はHTTPだけを検証する。srcの共通scenario自体はtest discovery対象にしない。これらは現時点では未実装である。

| AC | 検証する条件 | テストファイル | 正確なテスト名 |
| --- | --- | --- | --- |
| AC-1 | backend注入時にowner承認済みの7 toolsを登録、未注入時は登録しない、既存local surface維持 | `tests/queue-task-tools.test.ts` | `AC-1 registers approved queue tools only when a backend is injected` |
| AC-2 | listの1ページ応答、空queue、opaque cursorの転送・次cursorと終端の保持 | `tests/queue-task-tools-transport.test.ts` | `AC-2 reads only visible tasks and forwards opaque cursors one page per call` |
| AC-3 | agent認証必須、共有token fallback禁止、他agent / wildcard拒否、replay再認可 | `tests/queue-task-tools-transport.test.ts` | `AC-3 binds every call and replay to the authenticated agent` |
| AC-4 | next claimの再送、競合、空結果、lease更新 | `tests/queue-task-tools-transport.test.ts` | `AC-4 claims next and renews without duplicate claims` |
| AC-5 | 3種のevidence、同じキーとキー順違い再送で重複なし | `tests/queue-task-tools-transport.test.ts` | `AC-5 attaches evidence once for the same operation` |
| AC-6 | blocked条件、done再送、別キー既完了拒否、CAS / 完了gate拒否 | `tests/queue-task-tools-transport.test.ts` | `AC-6 completes through queue status without bypassing gates` |
| AC-7 | 全入力schema、task_id / waiting_on長、予約key、backend入力変換 | `tests/queue-task-tools-transport.test.ts` | `AC-7 validates inputs before calling the queue backend` |
| AC-8 | 構造化backendエラーの保持、not_sent / unknown、throw / rejectのunknown変換、不正成功・エラーshape、isError（HTTP解析はhost専用scenario） | `tests/queue-task-tools-transport.test.ts` | `AC-8 preserves structured failures without leaking credentials` |
| AC-9 | tools/listでannotationsとschemaが規定どおり | `tests/queue-task-tools-transport.test.ts` | `AC-9 advertises conservative queue tool annotations` |
| AC-10 | 実stdio / HTTPでAC-2〜AC-9の結果が一致 | `tests/queue-task-tools-transport.test.ts` | `AC-10 runs the same queue contract over stdio and Streamable HTTP` |
| AC-11 | HTTP 401、sessionの別agent再利用拒否、削除cleanup | `tests/queue-task-tools-transport.test.ts` | `AC-11 rejects cross-agent HTTP sessions and cleans up transports` |
| AC-12 | tarball外部import、test subpath共有、overlay形式adapterで同一scenario実行 | `tests/queue-task-tools-consumer.test.ts` | `AC-12 imports public queue tools and reuses the contract suite from a consumer` |

AC-3〜AC-6はin-process API fixtureで認可・永続再送の効果をassertする。実APIの未確認保証は別途consumerの非本番contract検証を必要とし、fixture成功を実環境保証へ読み替えない。AC-12のadapterは汎用consumer fixtureであり、operator overlayの切替・削除をこのPRから実行しない。

## PR単位の実装順とversion

7 toolsはowner承認済みのため、read（`list_my_tasks` / `get_task`）とwrite（`claim_task` / `claim_next` / `renew_claim` / `attach_evidence` / `update_status`）を1つの実装PRにまとめてよい。分ける場合はreadを先に出す。段階公開するかは未確認事項5で判断する。

- 範囲: 共通DI / schema / result / errors、agent binding、キー転送、CAS、再送、contract runnerとstdio / HTTP fixture。AC-1で7 toolsの登録を確認し、全ACを通す。
- ID指定claim / 詳細read / 応答shape / APIの冪等性が未確認のまま完了扱いにしない。server変更が必要なら別Storyへ分ける。

各実装PRでは`npm run build`の後、対応するVitestファイルと外部consumer検証を実行する。docs PRではdocs checkとdiff確認を実行し、未実装ACの成功を記録しない。

changelogは実装PRでUnreleasedに「agent限定queue toolsと共通stdio / Streamable HTTP契約」を追記する。公開時はadditiveなminor bumpとする（現在0.49.0、実際の次versionはrelease時に決定）。本docs PRでversion / lockfileを変更しない。既存toolの意味・認証条件・schemaを破壊する変更はminor追加に紛れ込ませない。

## owner / Directorへの未確認事項

1. 7 toolsを承認するかは決着済み（owner、2026-11-01）。残りは、ID指定claimとagent限定詳細readの正式API・認可範囲、自身に未割当だがassignableなTaskをlistに含めるか。
2. Page / get / evidence / renew / statusの実応答schema、queue状態とcanonical状態の対応、kind別refの必須項目。公開規定案との差をどちらで吸収するか。
3. 同一キーのdurable replay、agent namespace、key保持期間、lease失効後のreplay、evidenceのキー順同一視、別キー既完了の正確なエラーcode。APIが満たさない場合の別Storyのowner。
4. agent principalのhost bindingとsession identity保護の責任境界。機密を含むAPI error bodyのredaction範囲。
5. test専用subpathの配布・version同期方式と、read / write段階公開の可否。overlayの同一contract成功を移行条件として確認する役割。
