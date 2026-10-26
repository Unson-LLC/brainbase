# 現在の状態

このページは、Brainbaseの思想、公開release、`develop`、将来計画を混同しないための境界表です。

配信中の正確なcommitは、各ページ下部の`Build <SHA>`で確認できます。

## Candidate — v0.47.1（npm公開前）

共通UIのタイトルだけの44px固定ヘッダーと必要時だけ開く右詳細drawerを公開候補に追加します。知識・議事録のdrawer表示は明示オプションで、既存のinline表示やデータ契約は維持します。npm公開・利用ホストへの取り込み・本番反映の完了は、この候補記録だけでは確認できません。

## Candidate — v0.47.0（npm公開前）

- `canonical_tasks` に bot task queue 用の nullable 列 `claimed_by`・`claimed_until`・`status_detail` を追加しました（`ADD COLUMN IF NOT EXISTS`）。`status_detail` の CHECK（started / waiting_for_review / blocked / NULL）、claim の組の CHECK、部分索引 `canonical_tasks_claimed_by_until_idx` を含みます。状態の5値 CHECK と GRANT は変えていません（#861）。
- 公開CIの正式リリース検証ジョブ `formal-release-validate-linux` を self-hosted runner で実行するようにしました。npm publish ジョブは `ubuntu-latest` のままです（#860）。
- これらは公開候補の記録であり、consumer検証、npm公開、registry readback、本番反映は未確認です。

## Candidate — v0.46.1（npm公開前）

- Plaud MCP 0.3.12+ が list / transcript 応答を `untrusted-user-data` ブロックで包む形式に対応しました。`payloadOf` で展開し、list の未知形状は空同期にせず失敗します。`listRevision` が 2 未満のときは 30 日分の再一覧を一度だけ行います（#856）。
- `@modelcontextprotocol/sdk` と `hono` を npm audit 対応の版へ更新しました（#857）。
- これらは公開候補の記録であり、consumer検証、npm公開、registry readback、本番反映は未確認です。

## Candidate — v0.46.0（npm公開前）

- Canonical Taskの作成と監査を同一DBトランザクションで確定できるよう、`CanonicalTaskRepository.createWithAudit`（任意）と、`CanonicalTaskAuditRepository.supportsTransactionClient` / `upsertAuditLog(entry, { client })` を追加しました。両方の能力が揃う場合だけ同一トランザクションを使い、監査writerが失敗した場合はTaskのINSERTをrollbackして `task_audit_unavailable` を返します。既存の構成の挙動は変わりません。
- PostgreSQL storeに `createWithAudit` を追加し、BEGIN → Task INSERT → 監査 → COMMIT を同一clientで実行します。失敗時はROLLBACKします。`CANONICAL_TASK_PG_TEST_URL` を指定した統合テストでcommitとrollbackを検証できます。
- これらは公開候補の記録であり、consumer検証、npm公開、registry readback、本番反映は未確認です。

## Candidate — v0.45.0（npm公開前）

- 今回追加する公開subpathは `./run-receipt-port`、`./meeting-source-mcp-adapters`、`./meeting-source-sync-common-adapter` の3つです。
- `./run-receipt-port` は `RunReceiptPort` と `assertRunReceiptPort` を提供し、実行記録の保存・照会をホストのportへ差し込めます。`./meeting-source-mcp-adapters` は Tactiq と Plaud のMCP応答を共通の会議ソースへ整形します。`./meeting-source-sync-common-adapter` は会議ソース同期の共通adapter契約を提供します。接続、OAuth、資格情報、保存は利用側のホストが担当します。
- 既存の `./mesh` を拡張し、`parseMeshEnvelope` を追加しました。既存の封筒・ノード・問い合わせの検査と整形、送信受付の `answer_status: "unknown"` の生成に加え、JSON文字列または値を同じ厳格な境界で検査できます。ネットワーク、認証、暗号、永続化は含みません。
- 既存の `./routines` を拡張し、3つのAPI（`assertRoutineProductionPorts`、`createRoutineProductionPorts`、`extractRoutinePersonalKgCandidates`）と、`RoutineProductionPorts` の11個のホストport（`reconcile`、`compress`、`buildNightOutput`、`verify`、`recallGraph`、`recallPersonalKg`、`generate`、`recordUsage`、`evaluateMetrics`、`createImprovementCandidates`、`listKnowledgeReviews`）を提供します。前者2つはportの組み立て時検査、後者は会議ごとのPersonal KG候補を `adopted`・`rejected`・`needs_review` に集計します。認証、DB、Personal KGへの昇格、保存、外部送信は利用側のホストが担当します。
- npm公開、registry readback、consumer確認、本番反映は、候補docsの記載だけでは未確認です。

## Candidate — v0.44.2（npm公開前）

- 世界の通常説明箱を見方と凡例へ移し、都市を選べないときの案内は残します。
- 空は1つのアイコンボタンで自動・昼・夕方・夜を巡回します。
- 通知の枠を共通 `workspaceNotificationCard` に統一し、注意はアンバー、重大なエラーは赤で示します。既存の通知・ロード表示も同じ枠を使います。
- npm公開・組織版の正式依存更新・本番反映は、それぞれ確認が必要です。

## Released — v0.19.0

目的・保存時点の現状・哲学・世界モデルを同じ範囲で読む共通UIと読み取りAPIを公開しました。共通UIはホストから読取portを受け取り、組織の認証と許可範囲は組織版が担当します。組織版への取込みと本番画面の確認は別の段階です。

公開確認済みの配布証跡は次のとおりです。

- npm package [`@unson/brainbase-mcp@0.19.0`](https://www.npmjs.com/package/@unson/brainbase-mcp/v/0.19.0)
- npmの`latest`は`0.19.0`を指し、registryの`gitHead`は`7cd7be975882fd1cbc797b7992b27a221f9fc02f`、integrityは`sha512-2xFtzRvppxqVFzVhdySNoGqelZsJItQIvxljM7IBWE2pgFVIE1etY0K8Vh4GwFz3W+tD/hNDxaANxBZ2jVDyYA==`
- GitHub Release [`v0.19.0`](https://github.com/Unson-LLC/brainbase/releases/tag/v0.19.0)は同じcommitを指し、正式版としてLatestに掲載
- 公開とlatestの照合を完了したworkflowの検証済みrun [`37415232781` attempt 2](https://github.com/Unson-LLC/brainbase/actions/runs/37415232781/attempts/2)
- 空の設定・キャッシュを使う独立したnpm consumerで、正確なversion・integrity、新しい公開口、CLIの起動とPersonal Onboardingを確認

公開用の一時タグ`release-7cd7be975882`の削除は、registry権限エラーで未完了です。正式版の配布、`latest`、GitHub Releaseの照合は完了しています。

## Released — v0.18.1

0.18.1で、OSSのプロジェクトワークスペースの余白、文字の強弱、境界線を整理し、組織版のシンプルなデザインに合わせました。package stylesheetの公開口は既存のままです。

公開確認済みの配布証跡は次のとおりです。

- npm package [`@unson/brainbase-mcp@0.18.1`](https://www.npmjs.com/package/@unson/brainbase-mcp/v/0.18.1)
- 公開時点のnpmの`latest`は`0.18.1`を指し、registryの`gitHead`は`9037a15719140c0e5c4e28f29975f98aa970c557`、integrityは`sha512-K0KYduvNDb/RIDiwocm1PI0Wk8C095KZdv+FBlsbyYZPRRiw0XgYMTXwfe4yrJzsXghL4u4dfiDBAPmv6pO4oA==`
- GitHub Release [`v0.18.1`](https://github.com/Unson-LLC/brainbase/releases/tag/v0.18.1)
- 公開とlatestの照合を完了したworkflowの検証済みrun [`37413609018`](https://github.com/Unson-LLC/brainbase/actions/runs/37413609018)

## Released — v0.18.0

0.18.0までのnpm packageとGitHub Releaseで公開済みのOSS範囲です。

公開確認済みの配布証跡は次のとおりです。

- npm package [`@unson/brainbase-mcp@0.18.0`](https://www.npmjs.com/package/@unson/brainbase-mcp/v/0.18.0)
- 公開時点のnpmの`latest`は`0.18.0`を指し、registryの`gitHead`は`0913d58555fe29ce69b49bb85bf6e21b6c9ed6d9`、integrityは`sha512-/EKrE3r61tJgo5s85GMYEDzqh7HVjwgZo9T8DtbuM0vLRK2V7kBcfs7sj1CgFmCT0DqHi02vR3ZsTpJgSZmIuA==`
- GitHub Release [`v0.18.0`](https://github.com/Unson-LLC/brainbase/releases/tag/v0.18.0)
- 公開workflowの検証済みrun [`37409099606` attempt 2](https://github.com/Unson-LLC/brainbase/actions/runs/37409099606/attempts/2)

- ローカル優先のPersonal Onboarding Kit
- MCPによる`get_context`、`search`、`resolve_entity`などの文脈参照
- Graph v2とRelation Registry
- Ontology 2.0.0と履歴versionの解釈
- Graphの候補発見・関係探索・根拠取得と、任意の埋め込み接続
- OSS Graphを設定した組織サービスへ移行・検索するための明示的な接続境界
- Evidence Receipt
- Judgment systemとしてのCore Philosophy
- Judgment DAGのarchitectureとroadmap
- typed DAG contractとpreflight validation
- ローカルの決定論的Judgment DAG runner
- content-addressedなrun artifactの保存・検証付き再読込
- 過去runのreplay、outcome attachment、version間evaluationのprimitive
- 判断が生んだ変化を機械可読に表すvalue-proof contractとrenderer
- npm consumer smokeと公開契約digest
- OSSとOrganizationで共用するoutcome knowledge UI（Mana委任UIとicon assetsは0.9.0で共通UIから外し、組織版の画面にした）
- Organization版が共通UIを再実装せず、OSS packageから利用するための公開subpath

- Company OSのObjective、Variable、Model、Constraintを扱うversioned ontology foundation
- 判断問題のsnapshot、下位DAG composition、problem candidateの選択、evaluation、learning adoption
- resource reservation、execution authority、durable wait、historical judgment viewと既存記録adapter
- Company OSの目的・世界モデル・判断・評価を一周する匿名ホテルfixture

- `brainbase web:serve`で、今日、目的と現状、プロジェクトと関係者、情報と関係を1つのローカルWebホストに載せる
- 手元のGraphを理由と履歴つきで訂正する処理と、変更されないGraphの版の読み取り
- 判断価値記録の一覧、本人の評価と直すこと、引き継いだ経験・根拠の層、判断の種類ごとの委任の地図
- 根拠を保ったまま知識の検索を続ける処理（knowledge continuation / knowledge lookup）
- Foundation草案をGraphへ渡す共通の書込契約と履歴SQL
- 組織版と共用するUI部品、見た目の定義、別のホストが操作だけを足せる拡張点
- 組織へ送ったGraphの束の一覧（`brainbase graph:bundles`）と、手元の記憶を選んで登録し直す操作（`brainbase memory:list`、`brainbase memory:register`）
- Graphの束の検証・検索に使う関係IDと埋め込みの生成の公開subpath（`canonical-graph`、`embedding-provider`、`graph-embedding-provider`）
- 知識を探す正本を内容の種類と相手から決める部品の公開subpath（`knowledge-resolution-service`）
- チームの文書を所有repoへ書き込むときの検査と読み戻しの照合、知識の取り込みと下書きの回答の検証、会議ソース（Tactiq・Plaud.ai）のカタログの公開subpath（`canonical-document-writer`、`knowledge-capture-preview`、`meeting-source-integration-catalog`）
- 判断の解決で判断Hookと解決の経路・サービスが共有するエラーの型・正規JSON・要求digestの公開subpath（`judgment-resolution-contract`）
- Graphの変更計画の組み立て・適用・スナップショットの検査とハッシュ、記憶の記録を見てよい範囲の判定の公開subpath（`graph-maintenance-engine`、`memory-scope-policy`）
- Graphのオントロジー（型と関係の定義の検査、決定の推論、版の候補の組み立て、署名つき公開の受領証の検証、版の登録簿）の公開subpath（`ontology-kernel`、`ontology-registry`、`ontology-publication`、`ontology-release-trust`）

- Mana委任UI（`ui/outcome-mana`、`ui/icons/mana`）と公開subpath（`./ui/outcome-mana`、`./ui/outcome-mana.css`、`./ui/icons/*`）を共通UIから外した。Unsonの実行基盤（Mana）に結びつくため、組織版の画面として組織版が持つ。0.8.0の公開subpathのうちこの3件を削除する互換を壊す変更なので、0.8.0からのminorにした。そのほかの0.8.0公開subpathは削除・変更していない

- プロジェクトの目的・対象・用語・関係者・タスク・判断・根拠をまとめる共通UI
- Sigma.jsによる2Dグラフと、記録の詳細・関係・出典をたどる表示
- 欠落・取得失敗・確認済みの空を区別する表示契約
- 保存された判断を、使われた参照・行った判断・実行・結果の履歴として読み返せる判断履歴UI。期間と検索で絞り込み、取得できた範囲と未接続・取得失敗・確認済みの空を区別して表示する

ここで示す公開確認はnpm packageとGitHub Releaseの配布状態を対象にします。公開manualのCloudflare Pages配信、Organization / Manaの本番接続、実案件での継続利用は、それぞれ別の確認対象です。

## Candidate — v0.44.1（npm公開前）

統合Canonical Taskの読み取り・保存処理と、段3の共通コアを追加します。共通コアは、ホストが渡す認証・テナント・保存portの境界を通して利用します。npm公開・本番配備・組織版ホストでの接続は未確認です。

## Candidate — v0.44.0（npm公開前）

議事録の詳細に「参加者」の行を足します。結べた人は名前で「人と会社」へのリンクにし、Google Meet の表示名などで人物が分からない参加者は「表示名（未確認）」の札にします。札を押すと、その場で候補を根拠つきで出し、1件ずつ人物・会社に結ぶか、人ではないと記録できます。結び付きの記録・権限・候補はホストが持ち、ホストが渡さなければ何も出しません。記録の型と認証・権限の契約は変更しません。組織版の画面への取り込みは別途行います。

## Candidate — v0.43.0（npm公開前）

左メニューを、押すとその画面が開く行き先そのものの並びに戻し、小見出し（会議・プロジェクト・調べる）で分けます。領域の中のタブは、画面が2つ以上ある行き先（設定）だけに出します。あわせて、受信箱の共通部品を足します。自分が対応しないと止まるものを「対応待ち」と「お知らせ」の2つのタブに集め、行ごとに「あとで」と「片付けた」を置きます。記録の型と認証・権限の契約は変更しません。組織版の画面への取り込みと、集約API（`/api/inbox`）は別途行います。

## Candidate — v0.42.0（npm公開前）

情報と関係に、本人だけが見られる画面「あなたの記憶」を足します。Brainbaseが自分について覚えていること（個人KG）を一覧で確かめ、1件を開くと、本文・状態・出どころ・AIが使う範囲・その記憶を使った判断を出します。判断の履歴の「本人の考え」からも、本人にだけ記憶を開けます。初版は読むだけで、訂正・取り消し・書き出しはできません。記録の型と認証・権限の契約は変更しません。組織版の画面への取り込みは別途行います。

## Candidate — v0.41.13（npm公開前）

左のメニューを6つの領域だけにし、領域の中の画面は本文の上のタブで切り替えます。領域を開くと、前回開いていた画面を開きます。世界の札に意味を添え、押すと理由と次にすることを出します。目的の行では、できることと、誰の何を待っているかを出します。記録の型と認証・権限の契約は変更しません。この版の npm 公開と、組織版の画面での確認は別途行います。

## Candidate — v0.41.12（npm公開前）

情報と関係を、一覧をその場で絞り込み、押した記録を1画面で開く「調べる」画面にします。引き継いだ自分の分と、情報の種類とつながり方の定義は別の画面へ移します。人と会社は、選んだ人・会社を詳細のページで開き、できる操作と、できないときの理由を見出しの下に出します。知識の組織全体の一覧は、Graphの状態を日本語で出します。記録の型と認証・権限の契約は変更しません。この版の npm 公開と、組織版の画面での確認は別途行います。

## Candidate — v0.41.11（npm公開前）

議事録の一覧で、キーワード・期間などで絞り込み、並べ替えられるようにします。会議を作れないときは理由を一言で出します。判断の履歴は、初めて見た人にも分かる言葉にし、1件を開くと、どの哲学・目的・世界モデルをどう使ったかと、本人の考え（個人KG）が入ったかが分かるようにします。記録の型と認証・権限の契約は変更しません。この版の npm 公開と、組織版の画面での確認は別途行います。

## Candidate — v0.41.10（npm公開前）

タスクの確認待ちに、待っている相手を人（Graphの人ID）としても持てるようにします。待っている相手・条件の自由記述は引き続き必須で、人は任意です。確認待ちへ移るたびに置き換え、確認待ちから出ると両方を消します。人を指定しない作成では欄を書かないので、列の無い保存先でも今のまま動きます。あわせて、議事録から、その会議で生まれたもの・残した場所・知らせた先へ移れるようにします。議事録の画面では、本文を直して新しい版として保存でき、作った本人は議事録を取り下げられます（npm の 0.41.10 は #809 のマージから公開されたため、この変更も含みます）。認証・権限の契約は変更しません。この版の npm 公開、保存先への列追加、組織版の画面での確認は別途行います。

## Candidate — v0.41.9（npm公開前）

共通部品に、中で検索できるプルダウンを足します。候補を名前と補足で絞り込み、キーボードと読み上げに対応し、候補が多いときは先頭だけを出して残りの件数を伝えます。あわせて、目的と現状で判断の哲学を「無い」と見せず、取り下げた記録で一覧を壊さないようにし、世界で押せそうな所は行き先へ進むか、押せない理由を見せます。認証・権限・正本データの契約は変更しません。この版の npm 公開、組織版への取り込み、本番画面の確認は別途行います。

## Candidate — v0.41.8（npm公開前）

知識の共通部品に、プロジェクトを選ばずに開ける一覧を足します。見られる範囲のすべてのプロジェクトと組織共通の知識・判断を、所属プロジェクト付きで並べます。他の画面で選んだプロジェクトに黙って絞りません。全体の一覧は閲覧だけで、登録や改訂はプロジェクトを選んでから行います。見出しが無い記録は、要旨か本文の最初の行を見出しにします。件数の上限に達したときと、記録が無い・条件に合わない・読めなかったときを分けて出します。認証・権限・正本データの契約は変更しません。この版の npm 公開、組織版への取り込み、本番画面の確認は別途行います。

## Candidate — v0.41.7（npm公開前）

議事録の一覧は、会議の日時が新しい順です。今日のまとまりは Asia/Tokyo の暦日です。会議の日時が無いときは、予定の開始・版の作成・取り込みなど、実際に使っている日付の意味で表示します。日時がまったく無い会議は、末尾の「会議の日時が未登録」にまとめます。

版の画面は読み取り専用です。会議を選んでいない詳細には案内を出します。確認されていない最新版は「確認待ち」と出します。古い版を開くと、最新版への案内を1回出します。編集できない旨の案内は灰色で1回です。本文の Markdown は見出しと箇条書きとして表示します。版の履歴は各版が2行で、作った人と確認した人を主体の ID で出します。表示名の別フィールドはありません。

予定と議事録の相互リンクは、予定 id の有無を確認するまで出しません。認証・権限・正本データの契約は変更しません。npm 公開後の版の読み戻しは、registry のキャッシュと反映の遅れがあっても収束するまで待ちます。この版の npm 公開、組織版への取り込み、本番画面の確認は別途行います。

## Candidate — v0.41.6（npm公開前）

判断の履歴の詳細を右パネルで表示し、詳細検索をボタン下の共通パネルへまとめます。右パネルは閉じると右へ薄く消え、呼び出した行へフォーカスを戻します。読み込み中は右上の共通通知へまとめ、完了後は通知を消します。取得失敗の理由・再試行と、未取得と登録なしの区別は維持します。

この版のnpm公開、組織版への取り込み、本番画面の確認は別途行います。

## Candidate — v0.41.5（npm公開前）

共通部品「人と会社」の一覧の見た目を整えます。人と会社に頭文字の印を付け、会社の種類（顧客・協業先・提案中）を色分けしたバッジで出します。種類の記録が無い会社にはバッジを出しません。社内・社外・会社ごと・所属未確認の見出しに人数を出し、上部に人と会社の件数と、その段へ移るボタンを置きます。一覧の行から内部IDを外し、右の欄には今までどおり出します。

段の構成、並び順、書き込みの操作、認証・権限と正本データの契約は変更しません。この版のnpm公開、組織版への取り込み、本番画面の確認は別途行います。

## Candidate — v0.41.4（npm公開前）

判断履歴の読み込みを速くします。journal の再読結果を保持し、読み取りを並列にして新しい記録から順に返します。複数の判断をまとめて照合する `findByResolutionIds` と `GET /api/judgment-history/resolutions` を追加し、範囲外と未存在はどちらも空として返します。判断履歴の画面は、一部だけ表示中と読み込み中の状態が分かる見た目に作り直します。

認証・権限と正本データの契約は変更しません。この版のnpm公開、組織版への取り込み、本番画面の確認は別途行います。

## Candidate — v0.41.3（npm公開前）

目的の一覧に保存時点の現状・確認待ち・確認日を並べ、行を選ぶと達成条件・確認の根拠・出典を共通モーダルで確認できます。哲学は初期展開、世界モデルは折りたたみ、説明は小さい共通ヘルプにまとめます。取得失敗・一部取得を通知へ渡す拡張と、スクロール後にふわっと消える共通の標準スクロールバーを追加します。

認証・権限と正本データの契約は変更しません。この版のnpm公開、組織版への取り込み、本番画面の確認は別途行います。

## Candidate — v0.41.2（npm公開前）

知識の「この判断を改訂」の入力欄を、表示幅に合わせて広げます。改訂の詳細を開いたときも本文欄がボタン列の固有幅に縮まず、狭い画面では画面幅に合わせて折り返します。これは入力内容と保存契約を変えず、共通UIの表示だけを調整するものです。

## Candidate — v0.41.1（npm公開前）

議事録の一覧と詳細に、ホストが解決した所属プロジェクトのラベルを表示します。会議の作成と議事録の編集は、ホストが渡す現在の許可状態に合わせて画面へ反映し、操作の直前にも再確認します。一覧や詳細の読み込みが逆順で完了しても古い応答を適用せず、絞り込みで対象外になった会議の詳細も再表示しません。認証・認可と所属の解決はホストが担当し、共有UIは渡されたラベルと操作可否を表示・制御します。

この版はnpm公開前の候補です。実際の公開状態と本番画面の確認は別途行います。

## Candidate — v0.41.0（npm公開前）

知識の保存競合時に入力・出典・提案を保持し、同じ下書きの最新版を確認してから、利用者が保持した内容を再適用して保存できます。目的の正本の確認結果、プロジェクトの関係者の取得状態、共通画面の取得失敗と再試行の案内を改善します。

## Candidate — v0.40.0（npm公開前）

「人を加える」で、その人が関わるプロジェクトを選べるようにします。人をプロジェクトに置くホスト（組織版）が選べるプロジェクトを渡したときだけ、選択欄を出して選ばないと保存しません。手元のPersonal Webは今までどおりです。

## Candidate — v0.39.0（npm公開前）

「人と会社」から、人と会社を作り、会社への所属を付け・終えられるようにします。終えた所属は消さずに終了日で残し、保存した後は正本から読み直して確かめます。会社は、属性とプロジェクトとの関係の役割から顧客・協業先・提案中を出し、関わるプロジェクトを「この会社のもの」と「顧客・協業先として関わるもの」に分けて出します。所属が分からない人には、人物の記録に文字で残っている会社名を「記録上のメモ」として出します（所属にはしません）。

## Candidate — v0.38.0（npm公開前）

Personal Web に「人と会社」を足します。Graphに登録された人を、所属する会社と自社から「社内」「社外（会社ごと）」「所属未確認」に分けて読み取り専用で並べます。自社が決まらないときは推測で分けず、「自社が未設定」と出します。メニューは組織版と同じ6つの領域の見出しで束ねます。

## Candidate — v0.37.0（npm公開前）

Taskの更新に `source_refs_append` を足します。今ある参照を上書きせずに新しい参照を追加でき、同じ参照は重複させません。同じ操作を再送しても版は増えません。

## Candidate — v0.36.0（npm公開前）

議事録の文書を取り下げる `withdraw_minutes` を足します。版と本文は消さず、取り下げた人と時刻を記録します。取り下げた文書は一覧の要約から外れ、詳細では履歴として読めます。

## Candidate — v0.35.0（npm公開前）

世界の部品に `waitingQueues` を足し、判断のほかの待ち行列（会議の振り分けなど）の件数と降り口を「待っている」に出せるようにします（前提台帳P17・D9）。件数が0の行列は出さず、読めない行列は0件と出しません。

## Candidate — v0.34.0（npm公開前）

Graphのオントロジー（型と関係の定義の検査、決定の推論、版の候補の組み立て、署名つき公開の受領証の検証、版の登録簿）を公開subpath `ontology-kernel`・`ontology-registry`・`ontology-publication`・`ontology-release-trust` として出します。brainbase-unsonの実装と同じ振る舞いで、版の登録簿は渡された設定フォルダから読みます。

## Candidate — v0.33.0（npm公開前）

世界に「あなたを待っている」判断の短い一覧が出ます（前提台帳U2）。新しい順に最大3件、本来の質問と「判断の履歴」への降り口を出し、超えた分は「ほかN件」と数えます。待っている判断が無ければ一覧を出さず、判断の記録を読めないときは0件とも出しません。あわせて、Graphの保守エンジンと記憶の範囲の判定を公開subpath `graph-maintenance-engine`・`memory-scope-policy` として出します。

## Candidate — v0.32.0（npm公開前）

世界の部品が、夜の記憶の整理の状態と、本人が決める記憶の候補の件数を `memoryStatus` で受け取り、「候補の確認」へ降りるリンクを出せるようになります（前提台帳P18）。渡されなければ「記憶の整理：未接続」と出し、候補の件数を0件とは出しません。Personal Webは結果を受け取る置き場が無いため、この表示になります。

## Candidate — v0.31.0（npm公開前）

判断の解決で、判断Hookと解決の経路・サービスが共有するエラーの型・正規JSON・要求digestを、新しい出口 `@unson/brainbase-mcp/judgment-resolution-contract` として追加します。brainbase-unsonの判断のサービスと同じ実装で、判断Hookの同じ写しもここから読むようにまとめました。OSSの既定の動作は変わりません。

## Candidate — v0.30.0（npm公開前）

Personal Webのナビの「今日」を「判断の履歴」に改め、組織版と同じ名前にします（前提台帳U1）。古いリンク `#today` と `#today?decision=<id>` は、判断の履歴の同じ判断へ転送します。世界の部品は、判断を開くリンクの行き先を `judgmentHref` で差し替えられるようになり、既定は `#value-proofs?decision=<id>` です。

## Candidate — v0.29.0（npm公開前）

所有repoへのチームの文書の書き込みの検査（`canonical-document-writer`）、知識の取り込みの提案の検証（`knowledge-capture-preview`）、会議ソースのカタログ（`meeting-source-integration-catalog`）を、新しい出口として追加します。brainbase-unsonの部品を処理を変えずに移したもので、外部のサービスを呼ばず、OSSの既定の動作は変わりません。

あわせて、会議ソースの接続ごとの同期（`meeting-source-connection`）が、期限の切れたアクセストークンをrefresh tokenで更新するよう直します。これまでは更新せずに同期が失敗していました。

## Candidate — v0.28.0（npm公開前）

知識を探す正本（Graph・所有repo・チームのDrive・個人KG・作業場）を、内容の種類と相手から決める部品を、新しい出口 `@unson/brainbase-mcp/knowledge-resolution-service` として追加します。brainbase-unsonの部品を処理を変えずに移したもので、外部のサービスを呼ばず、OSSの既定の動作は変わりません。

組織版への会社権限の部品の移設と、brainbase-unsonでの取り込みは別の段階です。

## Candidate — v0.27.0（npm公開前）

Graphの意味検索に使う埋め込みの生成（Gemini、`gemini-embedding-001:768:v2`）を、新しい出口 `@unson/brainbase-mcp/graph-embedding-provider` として追加します。問いと文書を区別して頼み、長い文を分けて平均します。組織側が保存済みの索引をそのまま使えるよう、モデルIDと次元は版をまたいで変えません。APIキーを渡したときだけ外部のサービスを呼ぶので、OSSの既定の動作は変わりません。

組織版への意味検索の本体の移設と、brainbase-unsonでの取り込みは別の段階です。

## Candidate — v0.26.1（npm公開前）

判断の枠組みの記録で、世界モデルの予測ごとに、何が観測されたら外れか、データで確かめたかを残せるようにします。採用案が確かめて外れた予測に頼るときは、人間へ戻します。記録の応答は、採用案の予測の確認件数を返します。`check` を使わない記録は従来どおりです。

## Candidate — v0.26.0（npm公開前）

世界の都市から、その事業で使う外の道具（社内の運用画面、Drive、GitHubなど）へ出られるようにします。`createWorldView` に任意の `businessExits(business)` を渡すと、都市の詳細と3Dを出せないときの一覧に「この事業の道具」の欄を足し、canvasでは状態を姿で表す駅（明かり・閉じた改札・霧）を区画の門の外に置きます。読めないときは0件として扱わず理由を出し、`https:` とホスト内の相対リンク以外は描きません。状態の言葉は語彙の `exit_states` で持ち主が与えられます。GPUを使えずWebGLがソフトウェア描画になる環境では、場面を作らず一覧で出します。

組織版での道具の台帳・権限・申請と、組織版の画面での表示確認は別の段階です。

## Candidate — v0.25.0（npm公開前）

同じPlaudやTactiqを複数のアカウントでつないでも、資格情報・読んだ位置・全文待ち・失敗・受け渡しが接続ごとに分かれる同期の部品を、新しい出口 `@unson/brainbase-mcp/meeting-source-connection` として追加します。接続の確認は一覧と全文の1ページ目を実際に読み、読めたものだけを能力として返します。同期は全文待ちを保留に残し、取得の失敗を「新しい会議が無い」と記録せず、同じ全文を二度渡しません。MCPのOAuthは組織接続の共通部品に差し込んで使い、tokenを読み戻し・状態・エラーに出しません。

本物のPlaud・Tactiqでの接続の実測、組織版での接続の記録・画面・定期実行、Manaの受付への受け渡しは別の段階です。

## Candidate — v0.24.1（npm公開前）

通常判断の詳細取得が待機中または失敗した場合も、一覧で取得できた当時の参照を詳細に残します。正本の詳細取得に成功した場合は読み戻した詳細を優先し、未確認の詳細を保存済みの証明として扱いません。部分取得・未接続・取得失敗の通知では、判断履歴画面の「再読み込み」を内容幅で押せるようにします。

npm公開、組織版の依存更新、実ブラウザの表示確認、本番配備と正本の読戻しは別の段階です。この候補の時点では本番画面を検証済みとはしません。

## Candidate — v0.24.0（npm公開前）

PlaudとTactiqの会議を、途中で切れない全文として読み出す部品を、新しい出口 `@unson/brainbase-mcp/meeting-source-reader` として追加します。MCPのツールを呼ぶ関数を受け取るだけで、接続・認証・保存先は持ちません。全文は最後のページまで読めたときだけ全文として返し、認可切れ・プランや許可の不足・取得枠・時間切れ・生成待ち・途中停止は、理由と次に試す時刻とともに返します。Tactiqの全文の取得枠（1時間に異なる会議10件）は呼ぶ前に数えます。録音サービスの要約は全文とは別に返します。

実アカウントでの読み出しの記録、組織版での接続と同期、Manaの受付への受け渡しは別の段階です。

## Candidate — v0.23.9（npm公開前）

知識・判断の一覧に種類・範囲・有効状態を添え、選択した項目の本文・出典・適用範囲・変更履歴へ進める階層を整えます。モバイルでは選択中の詳細へ移動する導線を表示します。詳細や履歴の取得に失敗した場合は正本未確認として再試行を示し、取得できるまで版の変更や失効を実行できません。検索結果が空または利用できないときは、前の選択と詳細を残しません。

Worldで事業・仕事・判断などの記録を読めない場合は、取得できた件数を総数として扱わず「件数未確認、0件とは確認できない」と表示します。ホスト全体が利用できない理由は対象欄ごとに折りたたんで確認できます。npm公開、組織版の依存更新、実ブラウザの表示確認、本番配備と正本の読戻しは別の段階です。この候補の時点では本番画面を検証済みとはしません。

## Candidate — v0.23.8（npm公開前）

Worldに任意の全画面キャンバス表示を追加します。都市の選択、空の切替、右端の区画詳細、地図上の仕事に追従する詳細、キーボード・タッチの操作経路を共通UIで提供します。取得失敗・一部取得・未接続と、仕事の記録上の要確認を区別します。既存の標準表示と正本の読取境界は維持します。

npm公開、組織版の依存更新、実ブラウザの表示確認、本番配備と正本の読戻しは別の段階です。この候補の時点では本番画面を検証済みとはしません。

## Candidate — v0.23.7（npm公開前）

Taskに任意の `completion_contract` を追加し、ゴールと一意な条件ID・条件本文を作成・取得・更新・一覧・検索で保持します。既存のversion/CAS・冪等性・監査を適用し、空・重複・不正型・未知項目・過大入力を拒否します。条件別の証拠照合、完了遷移の保護、Hostの停滞・予算制御は今回の範囲に含めません。

## Candidate — v0.23.6（npm公開前）

判断履歴の取得済み件数と全件数を区別します。全件数が未確認の場合は取得済み件数として示し、検索結果・ページ分割・総数不明の空応答も区別します。取得元や取得上限は変更しません。

## Candidate — v0.23.5（npm公開前）

明示的にprivate ACLを持つ哲学は、保存済みの所有者と履歴のACLを照合して読み取ります。共通Graph writer契約は同じ所有者、空の追加reader/writer、正確なversion、選択済みprojectへの適用を要求します。ACLのない既存の哲学は従来の扱いを維持します。Host側の保存には独立した保護migrationの適用が必要です。

## Candidate — v0.23.4（npm公開前）

判断履歴へ、呼び手が明示した公開用の要約と理由を厳密な入力として記録し、公開用digestを返す契約を追加しました。回答やツール出力から公開内容を推測せず、既存の全体digestにも公開入力を含めます。npm公開、利用側Hostの依存更新、実行中のHostでの確認は別に実施します。

## Candidate — v0.23.3（npm公開前）

通常の判断履歴を共通契約から読み取り、参照・行った判断・実行結果を期間と検索で確認できるAPIとUIを追加しました。未接続・取得失敗・確認済みの空は別状態で表示します。npm公開、利用側Hostの依存更新、実行中のHostでの確認は別に実施します。

## Candidate — v0.23.2（npm公開前）

Graph本文を読むための公開field pathとして`content`を明示し、`body`はソース投影が公開している場合だけ指定するよう、知識検索の案内を修正しました。npm公開、利用側Hostの依存更新、実行中のHostでの確認は別に実施します。

## Candidate — v0.23.1（npm公開前）

知識検索の時間予算を、lookup生成時ではなく最初の有効な取得予約から開始します。時間切れの予約は結果不明として残し、遅延結果で終端を再開しません。npm公開、利用側Hostの依存更新、実行中のHostでの確認は別に実施します。

## Candidate — v0.23.0（npm公開前）

判断に使う哲学・目的・世界モデルの本文を取得する共通APIを追加します。現在のcatalogのdigestと選択した参照を照合し、古いcatalog、不明な参照、本文不足を拒否します。既存の `@unson/brainbase-mcp/judgment-frame` から利用できます。参照と本文を確認するAPIであり、適切な記録の選択や判断への適用の品質はホストと実例で確認する必要があります。npm公開と利用側の依存更新、実行中のホストでの確認はそれぞれ別に実施します。

## Candidate — v0.22.6（npm公開前）

目的・哲学・世界モデルを、プロジェクト別の箱ではなく内容別にまとめる共通表示を追加します。各項目に所属を添え、正本の範囲・ID・版・digestが一致する組織共通記録は一度だけ表示します。全体の目的は行を選ぶと詳細を開き、変数参照は元のcatalog内で解決します。取得失敗は未確認として残します。npm公開と組織版の依存更新、本番画面の確認はそれぞれ別に実施します。

## Candidate — v0.22.5（npm公開前）

Objective画面の保存を、ホストの正規Graph草案writerへ接続できるようにします。信頼済みの本人とproject scopeからprivateな草案を作り、更新時の版競合と保存後の版・digestを確認します。ホスト側の接続と、一般のGraph読取経路でもprivate ACLを守る確認が必要です。接続されていないホストでは保存を有効にしません。

未設定の評価期間、連打、キャンセル後や選択変更後の古い保存結果を扱う共通UIも修正します。MCP SDKは既存の公開前監査を通すため、修正済みの1.31.0以上を要求します。npm公開、ホストの移行・配備、認証付き画面のreadbackは別々に確認し、この候補の時点では本番対応済みとしません。

## Candidate — v0.22.4（npm公開前）

選択済みプロジェクトの詳細と補足情報を一覧と並行して読み、一覧で対象を確認してから表示します。一覧の失敗・対象不在・選択変更では古い読み取りを適用しません。公開口は変わらないためpatchにします。npm配布と外部照合、本番での全表示時間の確認はそれぞれ別に行います。

## Candidate — v0.22.3（npm公開前）

世界の区画で、大通りが庁舎前の広場の下まで伸び、同じ高さで重なってちらついていたのを直します。大通りは広場の手前で止め、区画の数が多くても最初の列の現場が広場にかからないよう広場と庁舎を奥に置きます。公開口は変わらないためpatchにします。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.22.2（npm公開前）

0.22.1で、世界の画面がホストから渡されたdocumentにイベントの登録口（`addEventListener`）がある前提になり、イベントの無いdocumentで画面を組み立てると初期化に失敗していました。登録口が無いときは、タブから戻ったときの読み直しだけを止めて画面は描くようにします。公開口は変わらないためpatchにします。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.22.1（npm公開前）

世界の区画が記録から育ち、変化に応えるようにします。区画に入ると、この閲覧者が前回見たときから変わったこと（家が建った、道がつながった、雑草が生えた など）を街の言葉で出し、変わった区画に光の柱を立てます。区画を開いたまま別のタブから戻ると、仕事を読み直して変化を返します。完了して出典・成果の記録がある仕事を本設の建物、記録の無い完了をプレハブとして描き、本設の建物の数で区画が更地・村・町・街・都市と育ちます。点数は作りません。公開口と配信するファイルは変わらないためpatchにします。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.22.0（npm公開前）

会議・議事録・版・確認を、Google カレンダーやGitHubなどの外部連携なしで扱えるようにし、会議一覧、本文、版履歴、確認状態をOSSの共通画面から読み戻せるようにします。Brainbase内保存と会社が選んだ外部保存先は同じ会議・議事録として扱い、保存先の接続と会社ごとの配置はホストへ委譲します。議事録の特定版から判断・Task候補と採用対象を辿る系譜を持ち、訂正版の影響、取得不能、権限不足、digest不一致を現在の認可で確認します。公開口が増えるためminorにします。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.21.2（npm公開前）

世界の画面で、何も選んでいないときの右の欄に事業ごとの「区画に入る」ボタンを並べ、都市の名札からも区画に入れるようにします。名札や建物にマウスを乗せると「区画に入る ›」と出ます。区画の中も全体図と同じ空・光・道路・建物の質感で描きます（ホストは `ui/world/world-scenery.js` も配信します）。公開口は変わらないためpatchにします。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.21.1（npm公開前）

判断への適用条件が未記録の旧形式哲学を判断用一覧から除き、「目的と現状」の取得失敗を修正する候補です。元の記録と個別取得の厳密な検証は維持します。

## Candidate — v0.21.0（npm公開前）

世界の都市を選ぶと区画の中に入り、事業の仕事（タスク）が通りに面した現場として建つようにします。業務の状態（進行中・待ち・完了など）と、記録から把握できていないこと（担当の未接続、出典リンクなし、成果物の記録なし、見直し予定超過）を分け、取得失敗・権限外・実際の0件を混同しません。タスクに「何のための仕事か」の短い言葉（`purpose_label`）を1つ持たせ、区画を言葉ごとの通りに分けます。`@unson/brainbase-mcp/world` の公開口が増えるためminorにします。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.20.0（npm公開前）

プロジェクト概要の共通UIを拡張し、「このプロジェクトについて」から「次に確認すること」、プロジェクトに直接紐づく資料、関連資料の順で、確認の優先度と資料の関係を読み取れるようにします。資料の直接・関連、本文取得済み・未取得、確認済みの空・取得失敗を区別します。`@unson/brainbase-mcp/ui/project-overview` を公開し、組織版は自身のGraph投影と認証・許可範囲を渡して利用します。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.17.0（npm公開前）

プロジェクト一覧・詳細にアイコンを表示し、PNG/JPEG/WebP画像の登録・変更・削除をできるようにします。組織版と共用する `@unson/brainbase-mcp/ui/project-icon` を公開します。未登録時は名前の頭文字を表示します。公開する部品と関数が増えるためminorの0.17.0にします。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.16.0（npm公開前）

Personal Webが本人のトークンで組織のGraphを読み取る検証用の経路（C1）を外します。`web:serve` の `--organization-graph` と `--organization-web` は無くなり、渡すと案内つきで失敗します。Personal Webは手元のGraphだけを描き、組織のGraphは組織版で見ます。公開していた `openInMemoryGraph` や `readOrganizationJudgments` などの出口も無くなるので、版を0.16.0に上げます。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.15.7（npm公開前）

世界の建物・地面・街並みの作りを上げます。地面と海は繰り返しの絵柄をやめて縞を無くし、窓は壁だけに付け、事業の種類ごとに建物の形を作り込み、都市を街区に、道を歩道つきのアスファルトにし、夜は街灯の光だまりを出します。建物の形・高さ・明かりの意味は変えません。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.15.6（npm公開前）

世界を街の景色にします。都市の外側に陸・海・山並み、広場に噴水、道に並木と街灯を描き、空は時刻に合わせて変わります（固定もできます）。完了した案件は記念の公園になり、前回開いてから動いた都市と広場の建物に光の印が出ます。景色はデータを表しません。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.15.5（npm公開前）

世界の都市の読み方を分けます。都市の広さは進行中の案件の数、目印の建物の高さと窓の明かりは最近30日の動き（その事業の決定と、置かれた判断）で決めます。完了・終了した案件は更地のまま残し、広さには数えません。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.15.4（npm公開前）

世界の画面で、案件が1〜3件の事業を描くときに区画の置き場が無く、描画が止まってそれ以降の事業も描かれなかった不具合を直します。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.15.3（npm公開前）

世界の画面を、組織版でも同じ部品のまま載せられるようにします。組織のGraph APIが返すプロジェクトと用語の記録から世界を描く純関数を `@unson/brainbase-mcp/world` に公開し、画面にはプロジェクトを開く行き先をホストが渡せる口と、判断の記録が未接続であることの表示を加えます。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.15.2（npm公開前）

Canonical Taskの共通CRUDに、ホストのpolicyが指定する保存scopeを加えます。読み取り・変更・競合の読み戻し・操作の再実行・監査まで同じscopeを渡し、別scopeの結果の再利用を拒否します。組織の認証とDBの分離predicateはホストが持ち、scopeを指定しないローカル利用の契約は維持します。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.15.1（npm公開前）

知識取得の継続（`@unson/brainbase-mcp/knowledge-continuation`）で、質問を初回の有効な計画で固定し、試行をモデルが付けた `attempt_id` で識別するように直します。目的ベースのlookup（`@unson/brainbase-mcp/knowledge-lookup`）のfinish応答は、根拠を挙げていない必須欄だけを `missing_fields` に示します。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.15.0（npm公開前）

Foundationの草案を採用するMCPのtool `foundation_adopt`（`@unson/brainbase-mcp/foundation-authenticated-tools`）を加えます。採用者が `foundation_read` で確かめた版とdigestを渡し、正本APIの採用の経路を呼びます。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.14.0（npm公開前）

Foundationの草案を、判断と評価に使える版にする「採用」の書き込みの検査（`validateFoundationGraphAdoption`・`normalizeFoundationGraphAdoption`、`@unson/brainbase-mcp/foundation-graph-write`）を加えます。採用者が確かめた版と中身のまま次の版を作り、実行への使用は含めません。誰が採用できるかの照合はホストが行います。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.13.0（npm公開前）

予約と実行開始が照合する問題のスナップショットを、HTTPで作って読み戻す入口（`@unson/brainbase-mcp/judgment-problem-snapshot-http`）を加えます。保存・照合・読み取り方針は既存の処理のままで、主体と参照の照合（Foundationなど）はホストが渡します。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.12.0（npm公開前）

個人KG v1から組織へ共有した記憶を、本人が撤回したときの取消を共通昇格処理（`@unson/brainbase-mcp/knowledge-promotion`）に加えます。審査待ちの申請は「取消済み」になって承認できなくなり、既に組織のGraphに入った事実は撤回済み・検索対象外になります。承認の記録と系譜は残します。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.11.0（npm公開前）

組織の実行hostが、外部作用を自分で持たずに実行を登録できるようにします。登録は検査・予約の開始印・許可の発行までで、外部作用の結果は作用を持つ側が報告します。実行の帰属（本人・代行サービス・委任）を記録し、保存先を差し替えられます。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Candidate — v0.10.15（npm公開前）

判断の枠組みのMCPツール（`brainbase_judgment_frame_catalog`・`brainbase_judgment_frame_record`）の定義と処理を `@unson/brainbase-mcp/judgment-frame` に加えます。呼び出し側はGraphの記録の読み方だけを差し込みます。読み取りの失敗や上限いっぱいの応答では、短い一覧を返さず失敗にします。npm配布と外部照合が完了するまでは公開済みとして扱いません。

## Develop — release前

`develop`には存在するが、v0.10.0の公開範囲に含めていない範囲です。公開サイトの説明更新はpackageの機能追加とは別に配信されます。

- 密集したグラフのラベル重なりを抑制し、近傍を複数の輪に分散
- 関係探索で取得した別プロジェクトの記録を概要へ混入させない
- このページを含む公開サイトの現行化と、公開OSS版・組織版・未完成範囲の表示整理

`develop`にあることは、npmへ公開済み、production ready、組織導入可能という意味ではありません。

## Planned — 未実装または未完成

- outcomeとevaluationを実運用データへ継続接続する運用
- human / agent / committee runnerの運用契約
- authority graphとapproval workflow
- Personal → Project → Organizationのscope promotion
- マルチユーザー、RBAC、監査保持、managed connector、hosted runtime、HA
- 実案件での継続利用とexpert escalation削減の計測

計画文書やacceptance criteriaがあることは、実装や実証の完了を意味しません。

## 現在の製品境界

### OSS Brainbase

- 判断nodeとedgeの意味モデル
- ローカルSSOTとMCP
- 依存関係の検証
- ローカル実行runtime
- version、artifact、replay、evaluationへ進むための共通契約
- personal / project / organization scope primitive

### Organization / Enterprise

同じ判断モデルへ、次の運用機能を追加します。

- 組織identityとdirectory integration
- RBACとauthority graph
- 承認・例外・escalation
- multi-user concurrency
- managed connector
- auditとretention
- hosted runtimeとHA
- cross-project governance

組織版は別の脳を作るのではなく、共通のJudgment DAGへ組織運用上の制約を追加します。

## 公開内容の更新経路

```text
Brainbase GraphのPhilosophy / Decision
        ↓ snapshot hash付きcandidate
人間の承認
        ↓
GitHub PR
        ↓ docs check / build / smoke
merge to develop
        ↓
Cloudflare Pages deploy
        ↓
公開URL readback
```

Graphを直接Webへ表示しません。未承認情報や誤ったcandidateが公開されないよう、PRとCIを必須にします。

詳しい契約は[公開説明の昇格](/reference/cloudflare-pages#brainbase-graphから公開説明を昇格する)を参照してください。
