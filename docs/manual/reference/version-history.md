# バージョン履歴

このページでは、公開マニュアルと公開packageに関係する履歴を記録します。実装済み・`develop`・計画中の境界は[現在の状態](/guide/status)を優先してください。

## Unreleased — develop

- Graphの埋め込みの生成（Gemini、`gemini-embedding-001:768:v2`）の公開subpath `graph-embedding-provider` を追加。brainbase-unsonの部品を処理を変えずに移したもので、APIキーを渡したときだけ呼ぶ（`story-graph-embedding-provider-exit-v1`）
- 0.10.0公開後の配布状態に合わせ、公開manualの状態表示を現行化

## 0.26.0 candidate — npm公開前

- 世界に任意の `businessExits(business)` を追加。都市の詳細（canvasの右端・standardのrail）と3Dなしの一覧に「この事業の道具」の欄を出す（`story-world-business-exits-v1`）
- canvasの区画の門の外に、道具ごとの駅を置く。明かり＝使える、閉じた改札＝権限が必要、霧＝未確認・読めない。駅を選ぶと都市の詳細の該当行を選び、外へは直接移らない
- 語彙に `exit_states` を追加。既定は「使える」「権限が必要」「未確認」「読めない」
- `failIfMajorPerformanceCaveat` でWebGLを作れない環境（GPUなし）では一覧で出す

## 0.25.0 candidate — npm公開前

- 新しい出口 `@unson/brainbase-mcp/meeting-source-connection` を追加。接続の記録の型（接続IDはBrainbaseが発行、秘密値を拒否）、`ConnectionRuntime` とMCP SDKで呼ぶ `NativeMcpRuntime`、接続IDごとの資格情報の差し込み口（メモリ・0600のファイル）
- 接続の確認は一覧と全文の1ページ目を実際に読み、読めたものだけを能力として返す。読み出しに1ページ目だけを読む `probeTranscript` を追加
- 接続ごとの同期。全文待ちの保留、失敗の記録、`digest` での重複防止と版、Tactiqの1時間10件の枠、止まっていた期間の取り直し。別のproviderの同じ会議は同じテナント・持ち主の中だけで候補として示す
- MCPのOAuth（RFC 9728/8414の探索・動的なクライアント登録・PKCE・token交換）を組織接続の共通部品の `providerAdapter` として差し込む

## 0.24.1 candidate — npm公開前

- 判断履歴の通常判断で、詳細取得が待機中または失敗しても一覧で取得できた当時の参照を表示し、正本の詳細取得に成功した場合は詳細の参照を優先
- 部分取得・未接続・取得失敗の通知で、判断履歴画面の再読み込み操作を内容幅で左寄せ
- npm公開、組織版の依存更新、本番反映と本人の画面確認は別途検証する

## 0.24.0 candidate — npm公開前

- 新しい出口 `@unson/brainbase-mcp/meeting-source-reader` を追加。Plaudの全文を `next_cursor` が無くなるまで、Tactiqの全文を `hasMore` が偽になるまで読み、最後まで読めたときだけ全文として返す
- 一覧はPlaudを最後のページまで、Tactiqを上限50件に達した期間を分けて取り直す。Tactiqの全文の取得枠（1時間に異なる会議10件、読み直しは数えない）を呼ぶ前に数える
- 読めない会議を、認可切れ・許可不足（Tactiqは `get_access_options` で理由を取得）・取得枠・時間切れ・生成待ち・途中停止に分けて返す。要約は全文と別の結果にする

## 0.23.9 candidate — npm公開前

- 知識・判断の一覧に種類・範囲・有効状態を添え、選択した項目の本文・出典・適用範囲・変更履歴へ進む階層を整備。モバイルには選択中の詳細へ移動する導線を追加
- 詳細・履歴の取得失敗を正本未確認として表示し、再試行を提供。確認できるまで版の変更・失効を実行できず、検索結果が空または利用できない場合は前の選択・詳細を解除
- Worldの事業・仕事・判断などで、取得できた件数を総数とみなさず、件数未確認を0件と区別。ホスト全体が利用できない理由は対象欄ごとに折りたたんで確認できる

## 0.23.8 candidate — npm公開前

- Worldの任意の全画面キャンバス表示、実データ由来の警告、右端の区画詳細、仕事に追従する詳細とキーボード・タッチ操作を追加
- 取得失敗と未確認を0件にせず、遅い応答・再読込・選択解除時の状態を保持。npm公開、利用側の依存更新、実ブラウザ確認と本番反映は別途検証する

## 0.23.7 candidate — npm公開前

- Canonical Taskに任意の `completion_contract` を追加し、ゴールと一意な条件ID・条件本文を作成・取得・更新・一覧・検索で保持する。既存のversion/CAS・冪等性・監査を適用し、空・重複・不正型・未知項目・過大入力を拒否する
- 条件別の証拠照合、完了遷移の保護、Hostの停滞・予算制御は今回の範囲に含めない。npm公開、利用側の依存更新、実行中のHostでの確認は別に実施する

## 0.23.6 candidate — npm公開前

- 判断履歴の取得済み件数と全件数を区別。全件取得と有効な総数を確認できた場合だけ全件数を表示し、検索結果・ページ分割・総数不明の空応答も区別

## 0.23.5 candidate — npm公開前

- 明示的なprivate Philosophyの現在・履歴に保存されたowner ACLを読み取りへ適用し、呼び手を所有者として投影する問題を修正
- 同じowner、private ACL、空の追加reader/writer、正確なversionとproject適用を検証する共通Graph writer契約を追加。ACLのない既存の哲学は互換を維持

## 0.23.4 candidate — npm公開前

- 判断履歴へ、呼び手が明示した公開用の要約と理由を受け付ける厳密な入力契約を追加。公開用digestを返し、回答・ツール出力・内部推論から公開内容を生成せず、全体digestにも公開入力を含める

## 0.23.3 candidate — npm公開前

- 通常の判断履歴を共通契約から読み取り、参照・行った判断・実行結果を期間と検索で確認できるAPIとUIを追加。未接続・取得失敗・確認済みの空を区別して表示

## 0.23.2 candidate — npm公開前

- Graph本文を読む公開field pathとして`content`を案内し、`body`はソース投影が明示的に公開する場合だけ指定するよう、知識検索の説明とschemaを修正

## 0.23.1 candidate — npm公開前

- 初回取得前に検索時間予算を消費する不具合を修正。最初の有効な取得予約から計測し、保存再開でも予算を保持する
- 期限切れの予約を結果不明として残し、遅延結果による終端再開を防止。旧状態の互換と有限Stopを維持する

## 0.23.0 candidate — npm公開前

- 判断の枠組みの本文取得APIを既存の `@unson/brainbase-mcp/judgment-frame` に追加。catalogのdigest、参照、本文の版・digestを照合し、本文不足や不明な参照を拒否する
- 公開APIの追加のためminorを更新。世界モデル・目的・哲学の選択と適用が適切かどうかは、実例による検証が必要

## 0.22.6 candidate — npm公開前

- 目的・哲学・世界モデルを項目別にまとめる共通表示を追加。所属は項目に添え、同じ範囲・ID・版・digestの組織共通記録は一度だけ表示
- 全体表示では目的を選ぶと詳細を開き、同名IDの選択と変数参照を元のcatalogごとに分離。取得失敗を0件にせず、取得済み範囲を明示

## 0.22.5 candidate — npm公開前

- Graph Objective保存の未接続部分に、ホストの正規草案writerを渡せる接続口を追加。private ACL・草案限定・CAS・同一transaction内の版とdigestの読戻しを維持する。ホストでは一般Graph読取経路のACL分離も確認してから有効にする
- 評価期間が空の草案保存、保存の連打、キャンセルや選択変更後の古い非同期結果を修正
- 公開前の依存監査で検出したGHSA-6qxp-vccf-f47hに対応し、MCP SDKの最低版を修正済み1.31.0へ更新

## 0.22.4 candidate — npm公開前

- 選択済みプロジェクトの詳細・補足情報を一覧と並行して読み、一覧で対象を確認してから表示するようにした。一覧の失敗・対象不在・選択変更では古い読み取りを適用しない。全表示3秒以内の本番確認は組織版への反映後に行う

## 0.22.3 candidate — npm公開前

- 世界の区画で、大通りが庁舎前の広場の下で重なってちらついていたのを直した。大通りは広場の手前で止め、区画が多くても最初の列の現場と通りの看板が広場にかからないようにした

## 0.22.2 candidate — npm公開前

- 世界の画面が、イベントの登録口を持たないdocumentでも初期化できるようにした（0.22.1で入った、タブから戻ったときの読み直しの登録が初期化を止めていた）

## 0.22.1 candidate — npm公開前

- 世界の区画に入ると、この閲覧者が前回その区画を見たときからの変化を街の言葉で出し、変わった区画に光の柱と輪を立てるようにした。完了や着工は建物が地面からせり上がり、後退した変化は灰色で出す。前回の状態はブラウザにだけ覚える
- 区画を開いたまま別のタブ（タスク画面など）から戻ると、仕事を読み直して変化を返すようにした
- 完了して出典・成果の記録がある仕事を本設の建物、記録の無い完了をプレハブとして描き、本設の建物の数で区画が更地・村・町・街・都市と育つようにした。右の欄に段階、本設とプレハブの数、次の段階までの軒数を出す

## 0.22.0 candidate — npm公開前

- 会議・議事録・版・確認を、Google カレンダーやGitHubなどの外部連携なしで扱い、会議一覧、本文、版履歴、確認状態をOSSの共通画面から読み戻せるようにした
- Brainbase内保存と会社が選んだ外部保存先を同じ会議・議事録として扱う保存契約を追加し、保存先の識別子、版、digest、権限、保持、編集責任を分けて管理する。外部保存先の接続や会社ごとの配置はホストへ委譲する
- 議事録の特定版から判断・Task候補と採用対象を辿る系譜を追加し、訂正版の影響、取得不能、権限不足、digest不一致を現在の認可で確認できるようにした

## 0.21.2 candidate — npm公開前

- 世界の画面で、何も選んでいないときの右の欄に事業ごとの「区画に入る」ボタンを要確認の多い順に並べ、都市の名札からも区画に入れるようにした。名札や建物にマウスを乗せると「区画に入る ›」と出る
- 区画の中を全体図と同じ景色の部品（時刻で変わる空と光、まだらな芝、角の丸い敷地、歩道と中央線のある道路、街灯、木、窓の描かれた外壁と夜の窓明かり）で描くようにした。部品は新しい `ui/world/world-scenery.js` に置き、全体図と共有する。組織版などのホストは、このファイルも配信する必要がある

## 0.21.1 candidate — npm公開前

- 判断への適用条件が記録されていない旧形式の哲学を判断用一覧から除き、「目的と現状」の取得失敗を解消する。元の記録と個別取得の厳密な検証は維持する。

## 0.21.0 candidate — npm公開前

- 世界の都市を選ぶと区画の中へ入り、事業の仕事を通りに面した現場として描くようにした。業務の状態と、記録から把握できていないこと（担当の未接続・出典リンクなし・成果物の記録なし・見直し予定超過）を分け、記録された関係・推定した関係・読めなかった関係を別の線で描く
- タスクに「何のための仕事か」の短い言葉 `purpose_label`（1行30文字以内、空で解除）を持たせ、区画を言葉ごとの通りに分けた。ラベル無しの作成では欄を書かないので、列の無い保存先でもそのまま動く。保存先の列追加は組織側が担当する

## 0.20.0 candidate — npm公開前

- プロジェクト概要の共通UIを、「このプロジェクトについて」→「次に確認すること」→「プロジェクトに直接紐づく資料」→「関連資料」の順で表示するよう拡張した。直接・関連の関係、本文取得済み・未取得、確認済みの空・取得失敗を区別する。`@unson/brainbase-mcp/ui/project-overview` の公開口を追加するためminorにした。組織版の認証・許可範囲とGraph投影は組織側が担当する

## 0.19.0

- 選んだ範囲の目的・保存時点の現状・哲学・世界モデルを読む共通表示を追加。未確定・未検証・取得失敗を区別し、多数の世界モデルは検索とページ分けで確認できる。共通UIの公開口と読み取りAPIが増えるためminorにした。観測実績・判断記録への接続は今回の範囲に含めない
- npmの配布物と公開元commit、`latest`、正式なGitHub Releaseを照合し、独立したregistry consumerで確認。一時公開タグの削除だけはregistry権限エラーで未完了。配布証跡は[現在の状態](/guide/status)を参照

## 0.18.1

- プロジェクトワークスペースの余白、文字の強弱、境界線を整理し、組織版のシンプルなデザインに合わせる。package stylesheetの公開口は既存のまま。公開APIの追加・変更はないためpatchにした

## 0.18.0

- 保存された判断を、使われた参照・行った判断・実行・結果の履歴として読み返せるUIを追加。期間と検索で絞り込み、取得できた範囲と未接続・取得失敗・確認済みの空を区別して表示する

## 0.17.1

- プロジェクト一覧・詳細で指定したプロジェクトが一時的に一覧に無い場合、先頭の別プロジェクトへ切り替えず、指定した識別子の未検出状態を保つ。プロジェクトの識別子と表示内容の取り違えを防ぐ

## 0.17.0 candidate — npm公開前

- プロジェクト一覧・詳細のアイコン表示と、PNG/JPEG/WebP画像の登録・変更・削除を追加。共有部品 `@unson/brainbase-mcp/ui/project-icon` を公開し、組織版にも同じ表示と画像検証を提供する。画像は256 KiB以下に制限し、未登録時は名前の頭文字を表示する。公開の関数と出口が増えるためminorにした

## 0.16.0 candidate — npm公開前

- 検証用の経路C1を外す。`web:serve --organization-graph` / `--organization-web`、本人のトークンで組織のGraphを読む `createOrganizationGraphSource`、ホストの組織モード（状態の `organization_graph`、`readGraph`、訂正の403）、メモリ上の読み手 `openInMemoryGraph`、OSSホストの `organization-judgments`、Personal Webの組織版へのリンクを消す。組織版が使う `projectOrganizationWorld` と記録の写し方は残す。公開していた出口を消すのでminorを上げた

## 0.15.7 candidate — npm公開前

- 世界の描画の品質を上げる。地面・海・山を頂点の色で塗って絵柄の繰り返しによる縞を無くし、窓を壁だけに付け、種類ごとの建物（塔・館・ドーム・事務所棟）、家、公園、街区、道、木、夜の光だまり、奥の雲を作り込む。データとの対応（形＝種類、高さ・明かり＝最近30日の動き）と応答の形は変えないので、patchにした

## 0.15.6 candidate — npm公開前

- 世界に景色（陸・海・山並み・林・畑・噴水・並木と街灯）と時刻に合わせた空を加え、完了した案件を記念の公園として描く。前回開いた時刻をブラウザに覚え、それより新しい決定・判断の場所に光の印を出す。`world-placement.js` に `skyAt` と `changesSince` を加えた。応答の形は変えないので、patchにした

## 0.15.5 candidate — npm公開前

- 世界の都市を、広さ＝進行中の案件の数、高さと窓の明かり＝最近30日の動き（決定と判断）で描く。`WorldBusiness` に `activity`（30日の決定件数と最新の決定日）を加え、決定は組織Graphの範囲コードか手元Graphの `governs` で事業に結び付ける。組織Graphの決定の `decided_at` を手元の形へ運ぶ。応答への項目の追加だけで既存の項目は変えないので、patchにした

## 0.15.4 candidate — npm公開前

- 世界の画面で、案件が1〜3件の事業の区画が都市の中央（目印の場所）にしか取れず、描画が例外で止まって以降の事業も描かれなかった。区画の置き場は足りるまで格子を広げて取る（`districtLots`）。公開の口・応答の形は変えない修正なので、patchにした

## 0.15.3 candidate — npm公開前

- 世界の画面を組織版でも同じ部品のまま載せるため、`@unson/brainbase-mcp/world` を公開し、組織のGraph APIのプロジェクト・用語の記録から世界を描く `projectOrganizationWorld` を加える。画面の `createWorldView` には、プロジェクトを開く行き先をホストが渡す `projectHref` と、判断の記録が未接続（`judgment_journal_not_connected`）であることの表示を加える。既存の口・応答の形は変えない追加なので、patchにした

## 0.15.2 candidate — npm公開前

- Canonical Taskのpolicy指定storageScopeを、repositoryの全操作、主体と操作キーのclaim、競合の読み戻し、監査、準備済みdeleteの再実行に渡す。scopeを省略したlocal-first consumerの契約を保持する互換修正なのでpatchにした。組織の認証とSQL predicateはホストが担当する

## 0.15.1 candidate — npm公開前

- `knowledge-continuation` の `prepareKnowledgeAction` は、質問を `required_fields` と同じく初回の有効な取得計画で固定する。Hostが最初に持つ依頼文との一字一句の一致は求めない。初回のfinishは必ず拒否し、固定もしない。固定後の変更は引き続き `question_changed`、空の質問は `question_invalid`、不正な `attempt_id` は `attempt_id_invalid` で拒否する
- `recordKnowledgeResult` は、試行をその呼び出しの `attempt_id`（無ければtool ID）で識別する。finishの `field_evidence` はこの値でreadの試行と照合する
- `knowledge-lookup` のfinish応答の `missing_fields` を、`reference_ids` の中で根拠を挙げていない必須欄にした。状態のキーや結果の種類は増やしていないので、patchにした

## 0.15.0 candidate — npm公開前

- 草案を採用するMCPのtool `foundation_adopt`（`foundationAdoptionTools`・`handleFoundationAdoptionToolCall`）を `@unson/brainbase-mcp/foundation-authenticated-tools` に追加。確かめた版とdigestで `POST /api/company-os/foundation-adoptions` を呼び、応答が次の版でなければ成功にしない。公開の関数が増えるのでminorにした

## 0.14.0 candidate — npm公開前

- Foundationの草案の採用 `validateFoundationGraphAdoption` / `normalizeFoundationGraphAdoption` を `@unson/brainbase-mcp/foundation-graph-write` に追加。確かめた版とdigestが今の版と同じ、持ち主以外、判断と評価の検査を通る草案だけを、中身を変えない次の版（approved・ontology・draft/judgment/evaluation）にする。公開の関数が増えるのでminorにした

## 0.13.0 candidate — npm公開前

- 問題のスナップショットを作って読み戻すHTTPの入口 `@unson/brainbase-mcp/judgment-problem-snapshot-http` を追加。`POST /judgment-problem-snapshots` で保存して受領を返し、`GET /judgment-problem-snapshots/{snapshot_id}` で今の参照で照合して読み戻す。主体と参照の照合はホストが渡す。公開の出口が増えるのでminorにした

## 0.12.0 candidate — npm公開前

- 共通昇格処理 `@unson/brainbase-mcp/knowledge-promotion` に、本人が個人KG v1の記憶を撤回したときの共有の取消（`withdrawPersonalShares`）を追加。審査待ちの申請を「取消済み」（`source_withdrawn`）にし、承認済みの事実は組織のGraphで撤回済み・検索対象外にする。状態に`source_withdrawn`が増えるため、申請の状態を厳密に検査している利用者は対応が必要。0.11からのminorにした

## 0.11.0 candidate — npm公開前

- 実行開始に「登録」（`register`）と「作用結果の報告」（`reportEffect`）を追加。登録は検査・予約の開始印・許可の発行までを行い、状態`registered`を返す。外部作用の結果は作用を持つ側が同じ実行IDで報告する
- 実行の帰属（本人のみ、本人の代行サービス、サービス自身、委任、相関ID）を、hostの信頼済み文脈からだけ受け取り、検査・許可・記録へ残す
- 実行記録の保存先を`ExecutionIntentStore`として差し替え可能にする。既定はこれまでのsidecar
- HTTPホスト向けの小さな共通部品`@unson/brainbase-mcp/server-support`（`AppError`・`ErrorCodes`・`asyncHandler`・秘密を隠すJSON logger）を追加。組織やテナントの概念を持たない
- 実行記録の状態に`registered`が増えるため、実行記録の応答を厳密に検査している利用者は対応が必要。0.10からのminorにした

## 0.10.15 candidate — npm公開前

- 判断の枠組みのMCPツール `brainbase_judgment_frame_catalog`・`brainbase_judgment_frame_record` を `@unson/brainbase-mcp/judgment-frame` に追加（Graphの読み方は呼び出し側が差し込む）
- 読み取りの失敗・例外・上限いっぱいの応答は、空や短い一覧ではなく失敗として返す

## 0.10.14 candidate — npm公開前

- 判断の枠組みの共通部品 `@unson/brainbase-mcp/judgment-frame` を追加（一覧の組み立て・モデル向けの表示・記録の構造照合）
- 置き換え済み・無効の記録と、元の哲学を言い直しただけの分解草案は一覧から理由付きで外す。草案・未検証はラベルとして残す
- 目的が無いまま選ぶとき、選んだ案が哲学に反する・緊張するときは、人間に戻す印を返す

## 0.10.13 candidate — npm公開前

- `brainbase_knowledge_lookup` の `next_action` を、種類ごとに項目・必須項目を宣言する形へ変更。分岐の外の項目を表示しないエージェントでも、読み取り（`entity_id`・`entity_type`）と完了の宣言（`status`・`field_evidence` など）を書ける
- 受け付ける値と検証処理は変更しない

## 0.10.12 candidate — npm公開前

- 個人KG v1の共有（本人承認→組織レビュー）と組織候補（組織内承認）を同じ処理で組織のGraphへ渡す共通昇格処理 `@unson/brainbase-mcp/knowledge-promotion` を追加
- 本人の承認が無い共有、組織の承認が無い登録、却下後の承認、古い版の登録を止め、承認の種類・元・受領記録・知識イベント・Graphの系譜を残す
- 保存、元の読み取り、知識イベント、Graph、組織の審査規則は差し込み口とし、無ければ止まる

## 0.10.11 candidate — npm公開前

- ローカルWebホストに、名前空間で分離した私有画面・静的資産・APIを登録できる拡張口を追加
- 既存ホストのループバック接続、認証、CSPを拡張にも適用し、拡張の画面IDと資産を検証
- 医療固有の画面・データ・判断は公開packageに含めない

## 0.10.10 candidate — npm公開前

- プロジェクト概要のタスク・判断・知識・用語集を区分ごとの入口へ整理し、長い本文を概要から除く
- 区分ごとに最大16件ずつ表示する一覧、検索・絞り込み、項目詳細と一覧への復帰を追加
- 読み込み中、取得失敗、未接続、未確認を区分ごとに区別する

## 0.10.9 candidate — npm公開前

- プロジェクト内のタスク行を全体のタスク一覧と同じ表示に揃え、名前・担当者・期限・状態を一覧で確認できるようにする
- 名前からタスク詳細を開けるようにする

## 0.10.8 candidate — npm公開前

- プロジェクト画面の配色、見出し、指標、一覧を共通デザインに合わせる

## 0.10.7 candidate — npm公開前

- プロジェクト概要で取消済み・完了済みの仕事を「今日」の対象から除外
- 総数が未取得の場合は表示中の件数と総数未確認を区別

## 0.10.6

- プロジェクト個別ページを概要、仕事一覧・詳細、記録詳細へ分け、多件数を個別画面で確認できるようにする
- 概要では優先する仕事、変化、最近の記録、関係者の情報階層を明確にする
- Sigma.jsのGraphと実IDに基づく記録への遷移を維持し、未取得・失敗・0件を区別する

## 0.10.5 candidate — npm公開前

- Graph HTTP adapterから目的の一覧・詳細・版指定・readinessを読み取れるように修正
- 認証済みの本人・組織・選択プロジェクトと、現在のGraphの閲覧権限を維持
- 履歴・版・参照先プロジェクトの不整合を空結果として返さず、取得失敗として扱う
- 0.10.4の公開subpathを維持した修正

## 0.10.4 candidate — npm公開前

- 先に取得したタスク・知識を読み込み中のスケルトンより前に表示
- 概要では補足情報を目的・関係者の直後へ配置し、後着更新でも表示順とグラフ状態を維持
- 0.10.3の公開subpathを維持した修正

## 0.10.3

- プロジェクトの読み込み中に、目的・関係者・判断などの欄をスケルトンで表示
- ホストが先に取得したタスクや知識を、ほかの読み込み完了を待たずに順次表示
- 補足情報の更新中もグラフのタブ・選択・表示位置を維持し、失敗した欄と読み込み中の欄を区別
- 0.10.2の公開subpathを維持した修正

## 0.10.2

- Sigma.jsの密集グラフで、選択した点だけ名前を常時表示し、近傍と線のラベル重なりを抑制
- 多数の近傍を複数の輪に分散し、点の大きさを制限
- 関係探索で取得した別プロジェクトの判断を、元のプロジェクト概要へ混入させない
- プロジェクトを選択した直後に個別ページの見出しと読み込み状態を表示し、Graphの一覧・詳細を後から読み込む
- 一覧や詳細の遅い応答が別プロジェクトの表示を上書きしないようにする
- 0.10.0の公開subpathを維持した修正

## 0.10.0

- npm registry、gitHead、fresh install、GitHub Releaseのreadbackを完了した公開版

- プロジェクトの目的、扱う対象、用語、関係者、タスク、判断、根拠をまとめてたどる共通UIを追加
- Sigma.jsによる2Dグラフと、選んだ記録の詳細・関係・出典を表示。任意の型と関係を保持
- 取得できない情報と確認済みの空状態を区別し、未決の判断や待ちをデータなしに作らない
- 組織版が同じUIを利用するため、project-workspace、project-graphと関連assetsの公開subpathを追加
- 0.9.0の公開subpathを維持した機能追加

## 0.9.0

- npm registry、dist-tag、`gitHead`、integrity、fresh install、GitHub Releaseのreadbackを完了した公開版
- Mana委任UI（`ui/outcome-mana`、`ui/icons/mana`）と公開subpath（`./ui/outcome-mana`、`./ui/outcome-mana.css`、`./ui/icons/*`）を削除し、組織版の画面へ移した。公開subpathを外す互換を壊す変更のため、0.8.0からのminor
- そのほかの0.8.0公開subpathを削除・変更せずに維持
- 公開manualで、npm packageとGitHub Releaseの0.9.0配布証跡を表示

## 0.8.0

- npm registry、dist-tag、`gitHead`、integrity、fresh install、GitHub Releaseのreadbackを完了した公開版
- `brainbase web:serve`で、今日、目的と現状、Graphの画面を1つのローカルWebホストに載せる
- 手元のGraphを理由と履歴つきで訂正する処理と、変更されないGraphの版の読み取りを追加
- 判断価値記録の一覧、本人の評価、引き継いだ経験・根拠の層、委任の地図を追加
- 根拠を保ったまま知識の検索を続ける処理（knowledge continuation / knowledge lookup）を公開subpathへ追加
- Foundation草案をGraphへ渡す共通の書込契約と履歴SQLを追加
- 組織版と共用するUI部品、見た目の定義、ホストの拡張点を追加
- `brainbase graph:bundles`、`brainbase memory:list`、`brainbase memory:register`を追加
- Graphの束の関係IDと埋め込みの生成を公開subpath（`canonical-graph`、`embedding-provider`）へ追加
- 0.7.0公開subpathを削除・変更せずに維持
- 公開manualで、npm packageとGitHub Releaseの0.8.0配布証跡を表示
- 0.8.0公開後の配布状態に合わせ、公開manualの状態表示を現行化

## 0.7.0

- npm registry、dist-tag、`gitHead`、integrity、fresh install、GitHub Releaseのreadbackを完了したCompany OS公開版
- Company OSのObjective、Variable、Model、Constraintを扱うversioned ontology foundationを追加
- 判断時の目的・前提・権限を固定するProblem Snapshotと、下位判断を組み合わせるDAG compositionを追加
- problem candidateの選択、evaluation、learning adoption、前提変更のimpact reviewを追加
- resource reservation、execution authority、durable wait、historical judgment viewと既存記録adapterを追加
- 匿名ホテルfixtureでCompany OSの目的・世界モデル・判断・評価を一周する共通契約を追加
- 0.6.0公開subpathを維持し、追加subpathを同一tarballから利用できる公開版へ更新
- 公開manualで、npm packageとGitHub Releaseの0.7.0配布証跡を表示
- 0.7.0公開後の配布状態に合わせ、公開manualの状態表示を現行化
- 狭いデスクトップとモバイルで、heroの本文・画像・CTAが重ならない表示へ調整
- Organization先行案内に、公開OSS版との違い、非公開検証中、未完成の範囲を追加

## 0.6.0

- outcome knowledgeとManaの共通UIをOSS packageへ移し、Organization版が公開subpathから利用できる境界を追加
- 共通UIのJavaScript、CSS、icon assetsをnpm packageへ同梱
- OSS、Organization、顧客設定repoのUI所有原則を文書化し、同じUIの二重実装を禁止
- package consumer contractと共通UIの振る舞いを検証するtestを追加

## 0.5.0

- Graphの候補発見、関係探索、根拠取得を行うportableな検索と、任意の埋め込み接続を追加
- OSS Graphを設定済みの組織サービスへ明示的に移行・検索する接続境界を追加
- content-addressedなJudgment DAG run artifactの保存と検証付き再読込を追加
- 過去runのreplay、outcome attachment、version間evaluationのprimitiveを追加
- 判断が生んだ変化を機械可読に表すvalue-proof contractとrendererを追加
- npm tarballをfresh consumerから利用し、公開subpathとartifact contractを検証

## 0.4.1

- production-safeなAutonomy Gate canaryを追加

## 公開サイト更新（0.4.x期間）

- 公開コピーを「自分の判断力を、ひとり分で終わらせない。」へ更新
- OSS版の中心価値を、資料検索や説明削減ではなく、本人の判断による壁打ちの深掘りと複数AIへの判断共有へ変更
- 「頭のいい自分を、壁打ち相手にも、実行部隊にも。」を体験コピーとして追加
- 自分らしさと判断品質を薄めず、調査・設計・執筆・開発を並列に進められる価値を具体化
- Google Driveなどの資料連携との違いはメイン訴求から下げ、「共通の資料室」と「共通の判断OS」の違いとして本文で説明
- Brainbaseはエージェントを増やす製品ではなく、Codex、Claude Code、Manaなどの対応エージェントへ同じ判断を渡す基盤だと明示
- 主CTAを「自分の判断を1つ、AIへ渡してみる」へ変更
- 現行OSSのローカル優先・単一所有者向け価値を、組織版の将来価値より先に説明
- 個人で判断基盤を育て、権限・承認・例外・監査が必要な段階でOrganization / Enterpriseへアップグレードする経路を追加
- 人間が目的・判断基準・委任範囲を決め、AIが探索・反証・承認範囲の実行を担う境界を明示
- Judgment DAGの利用者向け説明とReleased / Develop / Plannedの状態ページを追加
- `public-message.json`からREADME、manual、Core Philosophy、agent instructions、package descriptionを同期
- Brainbase Graphのsnapshot hash付きcandidateから、review用PRを作るpromotion workflowを追加
- pull requestでdocs check / build / smokeを行い、`develop` merge後にCloudflare Pagesへ自動deploy
- 配信後に公開URLをreadbackし、コピーとbuild SHAを確認

## 0.4.0

- Brainbaseをmemory retrievalだけでなくjudgment systemとして定義
- OSSと組織版で共有するJudgment DAG architectureとroadmapを追加
- typed DAG contract、`depends_on` mirror、layer、scope、cycle、missing dependencyのpreflight validationを追加
- 公開contract schema、fixture、source lock、digestをpackageへ同梱
- Graph v2、Ontology 2.0.0、Relation Registry、`resolve_entity`、Evidence Receiptを継続提供

`executeJudgmentDAG`のローカルrunnerは0.4.0 release後に`develop`へ追加されたため、0.4.0公開範囲と混同しません。

## 0.3.1

- 初回回答を「覚えていたこと」「つながったこと」「次にできること」の3つへ整理
- 正規Graphの事実と、回答時点で未確認の内容を分けて表示
- ID、パス、digest、tool traceなどの内部証跡を初期表示から外し、必要なときだけ確認できる構成へ変更
- 実CLI、実MCP、実Codexを使ったCycle 10で、32の合成ペルソナすべてが10分以内の初回価値と再利用意向を認識

Cycle 10は公開候補tarballと合成ペルソナによる証拠です。実際の人間、実機、支援技術、およびnpm registry公開版を使った価値認識は公開前には確認していません。

## 0.3.0

- Graph v2で人物、組織、プロジェクト、判断を安定IDのedgeで接続
- Relation Registryにより、関係名、接続可能な型、探索方向を一元管理
- Graph v1を自動更新せず、preview digest付きの`ontology:migrate`で原子的に移行
- Ontology 2.0.0を追加し、1.0.0を変更せず履歴解釈として保持
- `resolve_entity`で文章中の表現を正規entity IDへ接続し、本文を保持しないEvidence Receiptを返却
- 生成tarballを新しい利用環境へinstallし、公開CLIと実MCP readbackを検証するconsumer smokeを追加
- 候補tarballの取得から実CLI、実MCP、実Codexによる相談メモまでを51,069msで完了し、32の合成ペルソナすべてが初回価値と再利用意向を認識
- Cycle 09で既知の知識構造Major 0件、新規Major 0件を確認

Cycle 09はローカル候補tarballと合成ペルソナによる証拠です。人間の利用観察、実機・支援技術評価、npm registry版を使った利用者価値の確認は含みません。公開完了は、Actionsの成功だけでなくnpm registryのversion、`gitHead`、integrity、dist-tag、fresh install、GitHub Releaseを照合して判定します。

## 0.2.0

- 接続済みsourceを最小scopeで取り込み、候補の確認から最初の価値検証まで進めるConnected-world onboardingを追加
- 初心者向けオンボーディングで、復旧手順とMCP導入後の次行動をより明確に表示
- Codexの`UserPromptSubmit`、`PostToolUse`、`Stop`を1つのportable judgment episodeとして扱うローカルHostを追加
- 返答の先頭に、実際に参照したユーザー発言と判断結果を`🧠 判断参照:`として短く表示
- 判断証跡と実際のBrainbase MCP呼び出しを分け、検索・取得・参照先と0回だった事実を`📚` / `⚠️`で表示
- 参照元を特定できない追従依頼は成功に見せず、確認質問または警告として表示
- receipt、順序付きtool event、表示行を同じjournalに保存し、重複・競合・破損・orphan Stopをfail closedで処理
- `doctor --judgment-hooks`による3 Hookの導入検証を追加

## 2026-07-10

- 導入手順を、準備、仕事の前提、最初の価値、必要な情報源、運用開始の5フェーズへ再構成
- 重複していた概要ページを全体像へ統合
- 利用者が整理する情報と、実際の正本file構造を分けて説明
- sourceごとの対応範囲と、Skills、routine、MCPを使った運用開始手順を追加

## 0.1.0

- Brainbase VitePress manualを追加
- MCP導入、project文脈、source hearing、日次routineの初版を作成
- 既存の設計docsを公開manualのnavigationから分離
