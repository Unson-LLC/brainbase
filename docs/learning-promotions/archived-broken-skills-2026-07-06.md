# アーカイブ: 学習抽出パイプラインが誤生成した壊れSkill（2026-07-06 大掃除）

2026-07-05 の learn-extractor 暴発により、教訓一言メモが `.claude/skills/<日本語全文>/SKILL.md` として
105件登録された。`skill-auto-proposal.md` の正規プロセス（提案→承認）を経ておらず、
ディレクトリ名が日本語全文・再利用不能な体裁のため全件削除。内容（教訓）は将来の参照用に本ファイルへ退避する。


**削除件数**: 105件 / **根本原因**: `server/services/learning-service.js` の `slugify` が日本語文字を保持し、`deriveSkillTargetRef` がsummary全文をディレクトリ名に採用していたため（本PRで品質ゲート追加）。


---


## 1. `brainbase-ai-著作物は自由文で受け取らず-fingerprint-schema-validator-で嘘`

- **教訓**: AI 著作物は自由文で受け取らず、fingerprint + schema + validator で嘘を弾く
- **手順/メモ**:
  - 1. `vibepro report fingerprint --kind pr-body --include-instructions` のように、AI が参照してよい事実だけを JSON 化する
  - 2. AI の出力範囲を `summary`, `review_focus`, `risks_synthesis`, `open_questions` などの slot に限定する
  - 3. `vibepro report write --from-stdin` で schema、参照 ID、数値 claim を検証する
  - 4. 固定 skeleton に検証済み narrative だけを差し込む


## 2. `brainbase-aws-ssm経由で本番ec2を調査・操作する時は-region明示とbashスクリプト化で失敗`

- **教訓**: AWS SSM経由で本番EC2を調査・操作する時は、region明示とbashスクリプト化で失敗を避ける
- **手順/メモ**:
  - 1. EC2状態確認: `aws --profile ncom --region ap-northeast-1 ec2 describe-instances --instance-ids <id>`
  - 2. SSM疎通確認: `aws --profile ncom --region ap-northeast-1 ssm describe-instance-information --filters Key=InstanceIds,Values=<id>`
  - 3. `/tmp/script.sh` を作成し `SCRIPT_B64=$(base64 < /tmp/script.sh | tr -d '\n')`
  - 4. `ssm send-command --parameters "commands=[\"echo $SCRIPT_B64 | base64 -d > /tmp/q.sh && bash /tmp/q.sh && rm /tmp/q.sh\"]"`
  - 5. DB確認で `psql` が無い場合は、アプリ配下で `sudo -u ubuntu node -e` + `@prisma/client` を使う


## 3. `brainbase-brainbaseのdirty表示は正規repoではなくセッションworktreeの状態を見てい`

- **教訓**: Brainbaseのdirty表示は正規repoではなくセッションworktreeの状態を見ている場合がある
- **手順/メモ**:
  - UIのセッションworktree pathを確認
  - git -C <session-worktree> status --short
  - git -C <session-worktree> log --oneline -5
  - 必要ならorigin/mainとの差分やbehindを確認
  - git clean/merge後、最大30秒待つかタブ復帰・セッション切替でrefreshを促す


## 4. `brainbase-brainbaseのセッション名検索はstate-jsonだけを正とせず-sqlite-stat`

- **教訓**: brainbaseのセッション名検索はstate.jsonだけを正とせず、SQLite state.dbも確認する
- **手順/メモ**:
  - 1. まず state.json を検索する
  - jq '.sessions[] | select(.name | contains("署名問題")) | {id,name,project}' /Users/ksato/workspace/shared/var/state.json
  - 2. 見つからない場合は SQLite を確認する
  - sqlite3 /Users/ksato/workspace/var/state.db "select id,name,project from sessions where name like '%署名問題%';"
  - 3. 見つかったIDで復旧する
  - export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 LC_CTYPE=en_US.UTF-8 && export BRAINBASE_SESSION_ID='session-...' && claude


## 5. `brainbase-capability-map-skillだけが存在し-正本ディレクトリが未作成のケースがある`

- **教訓**: capability-map Skillだけが存在し、正本ディレクトリが未作成のケースがある
- **手順/メモ**:
  - 1. `.claude/skills/brainbase-capability-map/SKILL.md` を読む
  - 2. `ls docs/brainbase-capabilities/` で正本ディレクトリを確認
  - 3. なければ `README.md`, `capabilities/`, `runbooks/`, `troubleshooting/` を先に作る
  - 4. 個別能力は `docs/brainbase-capabilities/capabilities/<capability>.yml` に追加する


## 6. `brainbase-claude-codeの会話ログは-claude-projects配下のjsonlを更新時刻とキーワードで探す`

- **教訓**: Claude Codeの会話ログは~/.claude/projects配下のjsonlを更新時刻とキーワードで探す
- **手順/メモ**:
  - find ~/.claude/projects -name '*.jsonl' -mtime -3 -print
  - rg -n 'AI駆動|実験台|会社名|人名' ~/.claude/projects/**/*.jsonl
  - 候補が出たら jq/rg で user message と assistant text を抽出して復元する


## 7. `brainbase-claude-hooks-の-tsx-実行は-node-esbuild-のcpuアーキテクチャ不`

- **教訓**: Claude hooks の tsx 実行は Node/esbuild のCPUアーキテクチャ不一致で全フックがノイズ化する
- **手順/メモ**:
  - node -p "process.arch" && uname -m
  - which node npm npx && file $(which node)
  - file /usr/local/bin/node 2>/dev/null
  - ls node_modules/@esbuild/
  - cd /Users/ksato/workspace/code/brainbase
  - rm -rf node_modules/esbuild node_modules/@esbuild
  - PATH=/Users/ksato/.nvm/versions/node/v22.22.0/bin:$PATH npm install --no-audit --no-fund
  - ls node_modules/@esbuild/  # darwin-arm64 を確認
  - PATH=/Users/ksato/.nvm/versions/node/v22.22.0/bin:$PATH node -e "require('esbuild').transformSync('const x = 1', {})"


## 8. `brainbase-decision必要事項と止まり検知の件数差をそのまま流さず-差分理由を明示する`

- **教訓**: Decision必要事項と止まり検知の件数差をそのまま流さず、差分理由を明示する
- **手順/メモ**:
  - 1. Decision対象リストと止まり検知リストを集合比較する
  - 2. 差分があれば「Decision対象外だが監視対象」「軽微なため後段扱い」など分類する
  - 3. 見出しは「Decision必要6件＋監視1件」のように差分を含めて書く


## 9. `brainbase-decision項目の選択肢を要約時に別ラベルへ置き換えない`

- **教訓**: Decision項目の選択肢を要約時に別ラベルへ置き換えない
- **手順/メモ**:
  - Decision項目を処理する前に、各項目の「選択肢」と「推奨」を抽出する
  - 出力では「今日中にShip / ブロッカーを相談 / 優先度見直し」など入力の選択肢を維持する
  - 表現を短縮する場合も、意味が変わる語（期限延長、担当変更など）へ置換しない


## 10. `brainbase-docxはreadできないためpython-docx等で抽出・生成する`

- **教訓**: DOCXはReadできないためpython-docx等で抽出・生成する
- **手順/メモ**:
  - which pandoc || which python3
  - python3 -c "from docx import Document; doc=Document('/path/file.docx'); ..."
  - ModuleNotFoundError: No module named 'docx' の場合:
  - pip3 install python-docx


## 11. `brainbase-e2eはウォーム状態だけでなくハードリフレッシュ直後のコールド切替を必ず検証する`

- **教訓**: E2Eはウォーム状態だけでなくハードリフレッシュ直後のコールド切替を必ず検証する
- **手順/メモ**:
  - 1. Playwrightでページをhard reload相当に再読み込みする
  - 2. 事前に全セッションを開かず、未ウォームのセッションへ切り替える
  - 3. 期待するセッション固有の文字列が表示されることを確認する
  - 4. 旧セッション固有文字列が残っていないことを確認する
  - 5. 一定時間後もblank/blackのままではないことを確認する


## 12. `brainbase-gh-pr-merge後にjjのローカルmainが更新されない場合はmain-originへ合わ`

- **教訓**: "gh pr merge後にjjのローカルmainが更新されない場合はmain@originへ合わせる"
- **手順/メモ**:
  - gh pr view <pr> --json state,mergeCommit,mergedAt
  - jj git fetch --remote origin
  - jj log -r "main@origin" --no-pager -n 3
  - jj bookmark set main -r main@origin
  - jj log -r "main" --no-pager -n 3
  - If a Git worktree has `main` checked out, inspect it after the bookmark update:
  - `git status --short --branch`
  - `git diff --name-status`
  - `git diff --cached --name-status`
  - `git reflog --date=iso -8 HEAD`
  - `git reflog --date=iso -8 main`
  - If `main` advanced through `jj export` / bookmark sync but the Git index or worktree still represents the old tree, the dirty state may be a stale reverse diff. Compare:
  - `git diff --stat <old-main> main`
  - `git diff --stat main <old-main>`
  - `git diff --cached --stat`
  - Only clean after proving the dirty diff is exactly the inverse of changes already in `main`; otherwise treat it as possible user work.


## 13. `brainbase-gmダッシュボードでは入力の推奨を根拠なく強めない`

- **教訓**: GMダッシュボードでは入力の推奨を根拠なく強めない
- **手順/メモ**:
  - 1. Decision項目ごとに入力の選択肢と推奨をそのまま保持する
  - 2. 追加提案は「根拠: 期限超過/待機中/Ship 0件」などを確認してから書く
  - 3. 根拠が弱い場合は「状況確認」「優先度確認」「ブロッカー確認」に留める


## 14. `brainbase-gmダッシュボード生成時はメンバー名の表記ゆれをそのまま別人扱いしない`

- **教訓**: GMダッシュボード生成時はメンバー名の表記ゆれをそのまま別人扱いしない
- **手順/メモ**:
  - 1. メンバー一覧を生成する前に name を正規化候補でグルーピングする
  - 2. 例: `卯田` / `卯田剛史` / `卯田 剛史` は同一人物候補として扱う
  - 3. 同一人物と確定できない場合は、ダッシュボード上で重複候補としてGM確認事項に出す
  - 4. 期限超過数やWork中タスクを合算する場合は、確定済みの同一人物だけに限定する


## 15. `brainbase-gm向けダッシュボードでは話者推定由来の-speaker-1-などをそのまま表示しない`

- **教訓**: "GM向けダッシュボードでは話者推定由来の `Speaker 1` などをそのまま表示しない"
- **手順/メモ**:
  - 1. メンバー一覧に `Speaker <number>` / `話者<number>` / `未定` が含まれるか確認する
  - 2. 実名・担当・タスクと紐づかないものは dashboard の主要メンバー欄から除外する
  - 3. 必要なら末尾に「未特定メンバーあり」とだけ注記する


## 16. `brainbase-gm向け報告では入力にないリスク評価や状態判定を断定しない`

- **教訓**: GM向け報告では入力にないリスク評価や状態判定を断定しない
- **手順/メモ**:
  - 例: 入力に「介入推奨」「期限超過12件」がある → 「介入が必要な状態」は可
  - 例: 入力に案件ロスの記載がない → 「案件ロスリスクが高い」と断定せず「案件状況の確認を優先」
  - 例: statusが待機中・current_taskなし → 「順調」と断定せず「現在の停止要因なし」


## 17. `brainbase-gog-drive-downloadは-oではなく-outを使う`

- **教訓**: gog drive downloadは-oではなく--outを使う
- **手順/メモ**:
  - gog drive download --help
  - # 正しい例
  - gog drive download <fileId> --account <email> --out /tmp/example.pdf


## 18. `brainbase-gog-driveはlsを使い-非対話削除は-forceが必要`

- **教訓**: gog driveはlsを使い、非対話削除は--forceが必要
- **手順/メモ**:
  - gog drive ls --account info@unson.jp --parent <folder_id>
  - gog drive delete --force --account info@unson.jp <file_id>


## 19. `brainbase-gogで共有driveフォルダが空に見える時はアカウント不一致を疑う`

- **教訓**: gogで共有Driveフォルダが空に見える時はアカウント不一致を疑う
- **手順/メモ**:
  - gog auth list
  - # folder IDをURLから取り出す
  - gog drive ls --parent <folderId> --account <候補メール> --json
  - # 見えたアカウントでPDF等を取得
  - gog drive download <fileId> --account <email> --out /tmp/file.pdf


## 20. `brainbase-hook設定には未実装・存在しないスクリプトを先行登録しない`

- **教訓**: hook設定には未実装・存在しないスクリプトを先行登録しない
- **手順/メモ**:
  - 1. settings.json内のhook commandから .ts パスを抽出する
  - 2. 各ファイルが存在するか確認する
  - 3. npx tsx <hook-file> を最小入力で単体実行して起動エラーがないか見る
  - 4. 未実装hookはsettingsから外し、実装時に復活させる
  - 5. 最後にsettings.jsonをJSON.parseして構文確認する


## 21. `brainbase-human-in-the-loopは1回に統合-story-architectureを分けない`

- **教訓**: Human-in-the-Loopは1回に統合（Story+Architectureを分けない）
- **手順/メモ**:
  - Confirm the linked wiki guidance first.
  - Execute the corrective workflow consistently.
  - Record any new deviations as fresh learning episodes.


## 22. `brainbase-jj-export後にgit-worktreeが古いindexをdirtyとして見せる場合がある`

- **教訓**: "BrainbaseのJJ運用で jj export / bookmark sync 後にGit worktreeやindexが古いtreeをdirtyとして見せる場合の確認手順"
- **手順/メモ**:
  - `git status --short --branch`
  - `git diff --name-status`
  - `git diff --cached --name-status`
  - `git diff --stat`
  - `git diff --cached --stat`
  - `git reflog --date=iso -8 HEAD`
  - `git reflog --date=iso -8 <branch>`
  - `git diff --stat <old> <new>`
  - `git diff --stat <new> <old>`
  - `git diff --name-status <old> <new>`
  - `git diff --name-status <new> <old>`


## 23. `brainbase-knowledge-graphではcognitive-typesをgraph真理に直入れせずca`

- **教訓**: Knowledge Graphではcognitive typesをGraph真理に直入れせずcandidate-storeで扱う
- **手順/メモ**:
  - 1. raw activityはローカルまたはsource systemに残す
  - 2. dreaming/ingestでcandidateを作る
  - 3. PII/secret scanとpromotion gateを通す
  - 4. private preferenceなど安全な一部だけauto-promote可能にする
  - 5. Graphにはpromoted entity + derived_from/provenance edgeのみ書く
  - 6. Meshはcentral Graphの代替にせず、各nodeにしかないlocal context問い合わせ専用にする


## 24. `brainbase-livekit-agentsの応答速度はmetrics-collectedをログ出力すると段階別`

- **教訓**: LiveKit Agentsの応答速度はmetrics_collectedをログ出力すると段階別に測れる
- **手順/メモ**:
  - from livekit.agents import MetricsCollectedEvent, metrics
  - @session.on("metrics_collected")
  - def _on_metrics(ev: MetricsCollectedEvent) -> None:
  - metrics.log_metrics(ev.metrics)
  - 確認例:
  - lk agent logs --log-type=run | grep -i metrics
  - Console UI下部のMetricsタブでAverage End-To-End Latencyも確認する


## 25. `brainbase-livekit-realtime音声品質はvad-turn-detection-noise-ca`

- **教訓**: LiveKit Realtime音声品質はVAD/turn_detection/noise cancellationを一括変更すると原因切り分け不能になる
- **手順/メモ**:
  - 1. 既知の良好エージェントの構成を確認する
  - 2. xAI Realtimeではまずpluginデフォルトのturn_detectionで試す
  - 3. silero VAD有無、min_silence_duration、BVC/BVCTelephonyを1項目ずつ変更する
  - 4. 変更ごとにConsoleで音声認識品質とEnd-To-End Latencyを確認する


## 26. `brainbase-loki-でログが-0-件の時は検索語ではなく時間窓・label・収集範囲を先に疑う`

- **教訓**: Loki でログが 0 件の時は検索語ではなく時間窓・label・収集範囲を先に疑う
- **手順/メモ**:
  - curl -sf http://localhost:3100/ready
  - curl -sf http://localhost:3100/loki/api/v1/labels
  - curl -sf http://localhost:3100/loki/api/v1/label/app/values
  - まず {app="brainbase-ui"} だけで対象時間帯にログがあるか確認
  - 検索語付き query はその後に実行する
  - 0件なら直近1時間などで最新ログの timestamp を取り、session 作成時刻とのずれを確認する


## 27. `brainbase-loop-の-12h-実行は-dynamic-schedulewakeup-ではなく-fixed`

- **教訓**: /loop の 12h 実行は dynamic ScheduleWakeup ではなく fixed-interval CronCreate を使う
- **手順/メモ**:
  - fixed interval: `/loop 12h <prompt>` → CronCreate cron=`0 */12 * * *` 相当
  - dynamic mode: interval なし → ScheduleWakeup fallback、最大 3600s
  - 誤って dynamic chain を作った場合は、次回発火時に ScheduleWakeup を呼ばず終端し、CronCreate job を公式 chain にする


## 28. `brainbase-mana管理の議事録探索はgithub-repo名の推測ではなくchannels-jsonとproject設定から洗う`

- **教訓**: mana管理の議事録探索はGitHub repo名の推測ではなくchannels.jsonとproject設定から洗う
- **手順/メモ**:
  - aws s3 cp s3://brainbase-context-593793022993/channels.json /tmp/channels.json
  - jq -r '.channels[] | "\(.channel_id)\t\(.channel_name)\t\(.project_id)\t\(.workspace)"' /tmp/channels.json
  - # mana側の解決ロジック確認
  - gh api repos/Unson-LLC/mana/contents/api/channel-project-resolver.js | jq -r '.content' | base64 -d
  - # 保存先候補repoを洗う
  - gh repo list Unson-LLC --limit 200 --json name,description


## 29. `brainbase-mcp-apiの検索結果はクエリ条件を信用せずレスポンス本体で再検証する`

- **教訓**: MCP/APIの検索結果はクエリ条件を信用せずレスポンス本体で再検証する
- **手順/メモ**:
  - freee invoice検索後の確認例:
  - query.partner_id と invoice.partner_id が一致するか
  - partner_name が想定取引先か
  - payment_date が対象月末か
  - payment_status が unsettled か
  - cancel_status が uncanceled か
  - 一致しない行は集計から除外する


## 30. `brainbase-mcp-toolのbodyにはjson文字列ではなくオブジェクトを渡す`

- **教訓**: MCP toolのbodyにはJSON文字列ではなくオブジェクトを渡す
- **手順/メモ**:
  - NG: { "body": "{\"company_id\":11589192,...}" }
  - OK: { "body": { "company_id": 11589192, "lines": [...] } }
  - エラー例: Expected object, received string


## 31. `brainbase-mergeはdevelop-main統合に使わず-セッション差分prに限定する`

- **教訓**: /mergeはdevelop→main統合に使わず、セッション差分PRに限定する
- **手順/メモ**:
  - 1. merge前に `git log --oneline main..develop` と差分件数を確認
  - 2. developが大きく先行していたら直接PR/mergeしない
  - 3. 対象機能だけ `cherry-pick` して `feature/<topic>` PRを作る
  - 4. develop→main一括統合は別PR・別タスクでコンフリクト解消する


## 32. `brainbase-nocodb-mcpが見つからない場合でもrest-apiでテーブル探索・レコード取得できた`

- **教訓**: NocoDB MCPが見つからない場合でもREST APIでテーブル探索・レコード取得できた
- **手順/メモ**:
  - テーブル一覧:
  - curl -s -H "xc-token: $NOCODB_TOKEN" "$NOCODB_URL/api/v1/db/meta/projects/$BASE_ID/tables" | jq '.list[] | {id,title}'
  - レコード取得:
  - curl -s -H "xc-token: $NOCODB_TOKEN" "$NOCODB_URL/api/v1/db/data/noco/$BASE_ID/$TABLE_ID?where=(ステータス,neq,解決済み)&limit=200"


## 33. `brainbase-nocodbの同名テーブルでもプロジェクトごとにカラム構造が違った`

- **教訓**: NocoDBの同名テーブルでもプロジェクトごとにカラム構造が違った
- **手順/メモ**:
  - まず各テーブルのサンプルキーを確認:
  - python3 - <<'PY'
  - import json
  - r = records[0]
  - print(list(r.keys()))
  - PY
  - 例: title = タイトル or 要求 or ID
  - 例: date = 会議日 or 作成日 or CreatedAt
  - 例: id = Id or 番号 or ID


## 34. `brainbase-nocodbへ一括投入する前にtable-schemaとselect-optionを必ず取得する`

- **教訓**: NocoDBへ一括投入する前にtable schemaとselect optionを必ず取得する
- **手順/メモ**:
  - 1. table idごとにfields/columns metadataを取得
  - 2. API bodyは実カラム名に合わせる（例: Brainbaseは`タイトル`,`担当者`,`ステータス`など日本語column_name）
  - 3. select値は有効optionへマッピング（例: `川合秀明`→`川合`）
  - 4. まず1件POSTして200/201と返却Idを確認
  - 5. 成功後にbulk投入し、最後に代表レコードをGETして検証


## 35. `brainbase-rag代替技術は競合扱いせずレイヤ別に評価する`

- **教訓**: RAG代替技術は競合扱いせずレイヤ別に評価する
- **手順/メモ**:
  - FTS: 条文番号・固有名詞・数値などの完全一致レイヤ
  - Vector/semantic: 言い換え吸収・候補文書検索レイヤ
  - Corpus2Skill: コーパス全体の階層ナビゲーションレイヤ
  - PageIndex: 1文書/1冊の章立て・ページ参照レイヤ
  - 評価時は精度だけでなく、分岐ミス率、出典粒度、token消費、更新コストを比較する


## 36. `brainbase-readme-の画像解決ルールが-viewer-実装に固定されておらず-markdown-内の相対パスをページ-url-基準で解釈していた`

- **教訓**: README の画像解決ルールが viewer 実装に固定されておらず、Markdown 内の相対パスをページ URL 基準で解釈していた。
- **手順/メモ**:
  - Markdown renderer で相対画像パスを README のディレクトリ基準で解決する
  - repo 内画像は session file asset route に変換する
  - 外部画像 URL は placeholder を返す
  - 読み込み失敗時は 404 のままにせず viewer 内 placeholder にフォールバックする


## 37. `brainbase-realtime音声エージェントでは長いsystem-promptがターンごとの応答遅延要因にな`

- **教訓**: Realtime音声エージェントでは長いSystem promptがターンごとの応答遅延要因になる
- **手順/メモ**:
  - 1. SYSTEM_INSTRUCTIONSの文字数を計測する
  - 2. 厳守ルール、口調、tool利用原則だけを残す
  - 3. 料金・空室・FAQなど可変情報はtool結果を読む設計にする
  - 4. import確認後にdeployし、Metricsで短縮効果を確認する


## 38. `brainbase-session-ui-state-changed-は-更新された-session-と-status-から消えた-session-の両方を必ず通知`

- **教訓**: SESSION UI STATE CHANGED は「更新された session」と「status から消えた session」の両方を必ず通知
- **手順/メモ**:
  - [session-indicators.js](/Users/ksato/workspace/code/brainbase/public/modules/session-indicators.js)
  - `sessionStatusMap` の二重管理を撤去
  - hook status の正本を `sessionUi.byId[sessionId].hookStatus` に一本化
  - `SESSION_UPDATED` で hook status を流す旧ルートを削除
  - `SESSION_UI_STATE_CHANGED` は「更新された session」と「status から消えた session」の両方を必ず通知
  - [session-ui-state.js](/Users/ksato/workspace/code/brainbase/public/modules/session-ui-state.js)
  - `deriveSessionUiState()` に `goalSeek` を正式に含めた
  - 差分検出用の `getSessionHookStatusMap()` を追加して、polling 側も store ベースに統一
  - [session-view.js](/Users/ksato/workspace/code/brainbase/public/modules/ui/views/session-view.js)
  - `getSessionStatus()` / `updateSessionIndicators()` 依存を削除
  - 行描画、timeline ソート、sort timestamp の hook status 参照を全部 `deriveSessionUiState()` に統一
  - [session-list-renderer.js](/Users/ksato/workspace/code/brainbase/public/modules/session-list-renderer.js)
  - goal-seek 表示を `sessionUiState.goalSeek` に統一
  - `thinking` は見た目を `working` と同じオレンジに統一
  - [session-indicators.test.js](/Users/ksato/workspace/code/brainbase/tests/unit/session-indicators.test.js)
  - [session-ui-state.test.js](/Users/ksato/workspace/code/brainbase/tests/unit/session-ui-state.test.js)
  - [session-view.test.js](/Users/ksato/workspace/code/brainbase/tests/ui/session-view.test.js)
  - `node --check` 通過
  - `npm -s exec vitest run tests/unit/session-indicators.test.js tests/unit/session-ui-state.test.js tests/ui/session-view.test.js tests/ui/integration/app-switch-session-runtime.test.js`
  - 24 tests passed


## 39. `brainbase-slack-の直叩き失敗を-slack-全体の利用不能と判断しない`

- **教訓**: Slack の直叩き失敗を Slack 全体の利用不能と判断しない
- **手順/メモ**:
  - 1. Slack 直叩きが失敗したら「投稿 API 直叩き失敗」とだけ記録する
  - 2. Slack MCP の conversations_history / search で対象 channel の直近投稿を確認する
  - 3. 投稿元 bot / workflow / webhook の既存経路を特定する
  - 4. 既存経路がある場合は独自 NocoDB incident 等を追加しない


## 40. `brainbase-slackドラフトは同一チャンネル内で見つけにくく-thread-tsとdraft-idまで記録`

- **教訓**: Slackドラフトは同一チャンネル内で見つけにくく、thread_tsとdraft_idまで記録する
- **手順/メモ**:
  - 1. `slack_send_message_draft`実行後、tool resultの`draft_id` / `channel_id` / `channel_link`を記録する
  - 2. スレッド宛なら送信時に指定した`thread_ts`も併記する
  - 3. ユーザーには「どのドラフトか」を `宛先 + スレッド文脈 + draft_id + channel link` で返す
  - 4. 同一チャンネル内に複数ドラフトがある場合は、該当スレッドを開いて返信欄を見るよう明記する


## 41. `brainbase-slack検索で所在が特定できない法務・契約相談は-検索範囲を明示してdmドラフトに退避する`

- **教訓**: Slack検索で所在が特定できない法務・契約相談は、検索範囲を明示してDMドラフトに退避する
- **手順/メモ**:
  - 1. 人名、契約名、主要キーワード、channel searchを複数パターンで検索する
  - 2. 見つからなければ「現在のワークスペースでは未発見」と限定して表現する
  - 3. 関係者DMにドラフトを作る場合は、DM宛であることと本来のスレッドではない可能性を明記する
  - 4. 本文はスレッドへ転記しやすいよう、背景・相談事項・期限の構成で独立させる


## 42. `brainbase-stale-git-index-lock-が残ると-worktree-作成が-silent-fa`

- **教訓**: stale .git/index.lock が残ると worktree 作成が silent fail し、セッションが main repo で起動し続ける
- **手順/メモ**:
  - sqlite3 /Users/ksato/workspace/var/state.db "SELECT data FROM sessions WHERE id = '<session-id>';" | jq '.path,.worktree'
  - ls -l /Users/ksato/workspace/code/brainbase/.git/index.lock
  - lsof /Users/ksato/workspace/code/brainbase/.git/index.lock
  - lockfile が stale なら mtime と lsof を確認して unlink し、次の jj workspace add を retry する
  - 実装側では _isIndexLockError / _isStaleLockfile / _recoverStaleLockfile のように判定・復旧・再試行を worktree service に閉じ込める


## 43. `brainbase-symlink-を必ず解決してから比較する`

- **教訓**: symlink を必ず解決してから比較する
- **手順/メモ**:
  - **許可判定を絶対パスの親子関係でやる**
  - `home配下ならOK` みたいな雑ルールはやめる
  - 許可済み roots を配列で持つ
  - 例: `workspaceRoot`, `brainbaseRoot`, `projectsRoot`, `active session.path`, `active session.worktree.path`
  - `realpath()` で解決したあとに「どれかの配下か」で判定する
  - **symlink を必ず解決してから比較する**
  - 比較前に `fs.realpathSync()` で `cwd` と `targetPath` と `allowedRoots` を全部正規化
  - これやらないと symlink 経由だけ通る/落ちる、みたいな事故が出る
  - **`cwd` 単体を信用しない**
  - クライアントから来た `cwd` はヒント扱いにする
  - 本命は `sessionId` からサーバー側でセッションの実パスを引くこと
  - つまり `open-file` は ideally `path + sessionId` を受けて、`cwd` は server が決める
  - **相対パス優先にする**
  - terminal から選ばれた文字列が相対なら、まず session root 基準で解決
  - 絶対パスは「許可 roots 配下ならOK」に限定
  - こうするとログ出力の表記揺れに強い
  - **許可 roots を設定化する**
  - コードに `/workspace/` 文字列埋め込みはやめる
  - config で `allowedPathRoots` を持てるようにする
  - デフォルトは
  - current repo root
  - configured projects root
  - known session/worktree roots
  - 必要ならユーザー環境で外部SSDを追加できる
  - **deny by default + diagnostics を出す**
  - 拒否は維持でいい
  - ただしエラー文を
  - `resolvedTarget`
  - `resolvedBase`
  - `matchedAllowedRoot: none`
  - そうすると次の環境差分で秒で詰められる
  - **テストで環境差分を固定する**
  - 少なくともこれを API テストに入れる
  - `/Users/...` の通常ディレクトリ
  - `/Volumes/...` の外部SSD想定パス
  - symlink 経由の workspace
  - relative path + session root
  - absolute path inside allowed root
  - absolute path outside allowed root
  - `..` traversal
  - broken symlink


## 44. `brainbase-ui状態の検証でapiを自作シミュレートすると実hooksの不具合を見逃す`

- **教訓**: UI状態の検証でAPIを自作シミュレートすると実hooksの不具合を見逃す
- **手順/メモ**:
  - 1. ユーザーが開いているURLを確認する（例: localhost / bb.brain-base.work / bb.unson.jp）
  - 2. そのURLのstatus APIとWebSocket endpointを直接確認する
  - 3. サーバーログで実hookイベントが届いているか確認する
  - 4. PlaywrightでDOM上のindicator classとAPI状態を比較する
  - 5. DNS/Cloudflare/nginx経由が別インスタンスを向いていないか確認する


## 45. `brainbase-untrackedファイルがorigin-mainに同一内容で存在するとff-mergeをブロッ`

- **教訓**: untrackedファイルがorigin/mainに同一内容で存在するとff mergeをブロックする
- **手順/メモ**:
  - git fetch origin main
  - git diff --no-index <untracked-file> <(git show origin/main:<path>) 相当で内容一致を確認
  - または一時ファイルにgit show origin/main:<path>を書き出してdiff
  - 一致かつlocal独自変更でない場合のみrm -f <files>
  - git merge --ff-only origin/main
  - git status --shortでclean確認


## 46. `brainbase-userpromptsubmit-hook-が存在しない-enforce-nocodb-lookup-ts-を参照して毎回失敗していた`

- **教訓**: UserPromptSubmit hook が存在しない enforce-nocodb-lookup.ts を参照して毎回失敗していた
- **手順/メモ**:
  - 1. hookエラー確認: rg 'enforce-nocodb-lookup' .claude ~/.claude
  - 2. 参照先確認: test -f .claude/scripts/hooks/enforce-nocodb-lookup.ts
  - 3. ファイルがない場合は、hook参照を削除するかスクリプトを正本側に追加してSessionStart配布対象に含める
  - 4. 修正後に新規セッションまたは該当hook実行で ERR_MODULE_NOT_FOUND が消えたことを確認する


## 47. `brainbase-vercel-cliで詳細が出ない失敗deployはrest-apiでerrormessageを`

- **教訓**: Vercel CLIで詳細が出ない失敗deployはREST APIでerrorMessageを確認する
- **手順/メモ**:
  - TOKEN=$(jq -r .token ~/Library/Application\ Support/com.vercel.cli/auth.json)
  - TEAM_ID=$(curl -s -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v2/teams?slug=<team-slug>" | jq -r '.id')
  - curl -s -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v9/projects?teamId=$TEAM_ID&search=<project>" | jq '.projects[] | {id,name}'
  - curl -s -H "Authorization: Bearer $TOKEN" "https://api.vercel.com/v6/deployments?projectId=<projectId>&teamId=$TEAM_ID&state=ERROR&limit=10" | jq '.deployments[] | {uid, branch:.meta.githubCommitRef, state:.readyState, errorMessage}'


## 48. `brainbase-vercel失敗メールはgit連携とgithub-actionsの二重deployで発生し得る`

- **教訓**: Vercel失敗メールはGit連携とGitHub Actionsの二重deployで発生し得る
- **手順/メモ**:
  - 1. Gmailで `from:notifications@vercel.com` を検索し、失敗メールのdeployment/project/branchを特定する
  - 2. `vercel ls <project> --scope <team>` と `vercel inspect <deployment-url> --scope <team>` で失敗deployが0ms/即失敗か確認する
  - 3. GitHub Actionsで同じpushに対する `vercel deploy` が成功していないか確認する
  - 4. 二重deployなら Vercel Dashboard の Project Settings > Git で自動deployを止める、または `vercel.json` に `{ "git": { "deploymentEnabled": { "develop": false, "*": false } } }` を追加する


## 49. `brainbase-vibepro-の-spec-は人間が手書きする契約書ではなく-ai-が整合性検査に使う内部表現`

- **教訓**: VibePro の Spec は人間が手書きする契約書ではなく、AI が整合性検査に使う内部表現にする
- **手順/メモ**:
  - 1. `vibepro spec fingerprint --include-instructions` で Story+Code+Test の判断材料をまとめる
  - 2. AI に fingerprint を読ませて `spec.json` を生成させる
  - 3. `vibepro spec write --from-stdin --caller <agent>` で origin 実在・pattern 一致・clause id を検証する
  - 4. `vibepro spec drift` で Code/Test/PR との不整合だけを人間に提示する


## 50. `brainbase-vibepro-は-spec-がないと-graphify-しても-generic-task-しか`

- **教訓**: VibePro は spec がないと Graphify しても generic task しか出ない
- **手順/メモ**:
  - 1. `vibepro story add` / `story select`
  - 2. `docs/specs/<story-id>.md` を作成し、対象ファイル・AWS resource・根拠・受入条件・phase を明記
  - 3. `vibepro story diagnose --run-graphify` を再実行
  - 4. PR は clean worktree で作り、`.vibepro/` は `.gitignore` に入れて evidence state を混入させない


## 51. `brainbase-vibeproのspec-gateはimplicit-fallbackだと実質ノーチェックになる`

- **教訓**: VibeProのSpec gateはimplicit fallbackだと実質ノーチェックになる
- **手順/メモ**:
  - 1. Storyごとに docs/specs/<story-id>-spec.md を作る
  - 2. Specには Invariants / Contracts / Scenarios / Anti-patterns / Verification を書く
  - 3. clause ID（INV-1, S-1, AP-1等）をテスト名に含める
  - 4. vibepro pr prepare の gate-dag で spec: implicit や acceptance_criterion: missing がないことを確認する


## 52. `brainbase-vibeproのstory-htmlはmarkdownと別経路で古いdiagnostics-ru`

- **教訓**: VibeProのStory HTMLはMarkdownと別経路で古いdiagnostics runを参照しうる
- **手順/メモ**:
  - fixture repoで複数runを作る
  - vibepro diagnose . --run-id old-run
  - vibepro diagnose . --run-id latest-run
  - vibepro story report . --id <story-id>
  - 生成されたindex.htmlの全hrefを抽出
  - HTMLファイル所在地を基準にpath.resolveしてexists確認
  - summary.md / risk-register.md / evidence.json等がlatest-run側を指すことをassert


## 53. `brainbase-worktreeで動くclaude-hookはuser-levelではなくproject側に配置する`

- **教訓**: worktreeで動くClaude hookはuser-levelではなくproject側に配置する
- **手順/メモ**:
  - 1. hook本体を`/Users/ksato/workspace/code/brainbase/.claude/scripts/hooks/<event>/`に配置
  - 2. 既存worktreeで即時利用する場合は`/Volumes/UNSON-DRIVE/brainbase-worktrees/session-*-brainbase/.claude/scripts/hooks/<event>/`にもコピー
  - 3. `~/.claude/settings.json`のcommandは`npx tsx .claude/scripts/hooks/<event>/<file>.ts`のままにする
  - 4. `launchctl`やStop hookの実行前に、現在のworktreeからその相対パスが解決できるか確認する


## 54. `brainbase-x-twitter投稿の調査はwebfetchやnitterではなくx-research-ski`

- **教訓**: X/Twitter投稿の調査はWebFetchやnitterではなくx-research-skillのCLIを最初に使う
- **手順/メモ**:
  - cd /Users/ksato/.claude/skills/x-research-skill
  - source ~/.config/env/global.env
  - bun run x-search.ts tweet <tweet_id> --json
  - bun run x-search.ts thread <tweet_id>
  - bun run x-search.ts profile <username> --count 10
  - 必要なら投稿内URLをWebFetchで深掘りする


## 55. `brainbase-x-twitter投稿取得でwebfetchが402になる場合はoembed-apiを試す`

- **教訓**: X/Twitter投稿取得でWebFetchが402になる場合はoEmbed APIを試す
- **手順/メモ**:
  - curl -s "https://publish.twitter.com/oembed?url=<x_status_url>&omit_script=true" | jq
  - html内のblockquoteから本文・author_name・投稿日時を読む
  - 画像やスレッド全文が必要な場合は別ソースで追加確認する


## 56. `brainbase-xterm-jsのフォーカスレポート混入で入力遅延・順序崩れが起きる`

- **教訓**: xterm.jsのフォーカスレポート混入で入力遅延・順序崩れが起きる
- **手順/メモ**:
  - 1. クライアントのsendText/onDataで \x1b[I と \x1b[O を検出する
  - 2. 通常テキストだけをバッチ送信・ローカルエコー対象にする
  - 3. フォーカスレポートは即時送信または無視する
  - 4. サーバー側sendInputでもフォーカスのみ入力は早期returnする
  - 5. 高速タイピング、フォーカス切替混入、Backspaceを含む回帰テストを追加する


## 57. `brainbase-xterm-transportでは既存のtype-to-focus除外が復旧不能の原因になり得る`

- **教訓**: xterm transportでは既存のtype-to-focus除外が復旧不能の原因になり得る
- **手順/メモ**:
  - `this._isXtermTransportActive(sessionId)` の早期returnを確認
  - xtermがfocusedか判定する
  - unfocusedなら `focusTerminal()` / `terminal.focus()` を実行
  - トリガーキーは `terminalTransportClient.sendKey()` または `sendText()` で送信
  - HTTP post経路と二重送信しない


## 58. `brainbase-xterm入力停止はwebsocket断ではなくフォーカス喪失で起きる場合がある`

- **教訓**: xterm入力停止はWebSocket断ではなくフォーカス喪失で起きる場合がある
- **手順/メモ**:
  - DevTools Consoleで `[TTC-PROBE]` を確認
  - `onData` / `sendText` / `dispatch` / `focusin` / `focusout` を時系列で見る
  - 最後が `focusout { relatedTarget: undefined }` で止まり、その後 `onData` が出ない場合はxterm focus復旧不備を疑う
  - `window.focus` 復帰時とterminal host click時に `terminal.focus()` する経路を実装する


## 59. `brainbase-ダッシュボードで入力に担当者名がない場合に-誰に何を-を汎用の担当者表現で埋めない`

- **教訓**: ダッシュボードで入力に担当者名がない場合に「誰に何を」を汎用の担当者表現で埋めない
- **手順/メモ**:
  - 1. 入力JSONに owner/assignee/GM/person があるか確認する
  - 2. なければ Graph SSOT またはタスクDBで project -> owner を引く
  - 3. それでも不明なら「誰に: 担当者未特定」「何を: owner確認後に期限超過上位N件を整理」と書く


## 60. `brainbase-ブリーフィング生成では-上位n件の可視リストだけで集計値を上書きしない`

- **教訓**: ブリーフィング生成では、上位N件の可視リストだけで集計値を上書きしない
- **手順/メモ**:
  - 1. 入力に集計値があるか確認する（例: 今日期限のタスクが9件）。
  - 2. タスク一覧が全件か部分リストか確認する（例: 上位10件）。
  - 3. 部分リストから数える場合は「上位10件内では4件確認」と書く。
  - 4. 全体表現では明示集計を優先して「今日期限は9件」と扱う。


## 61. `brainbase-ブリーフィング生成では件数を手計算せず-入力データと注意書きの整合を必ず検算する`

- **教訓**: ブリーフィング生成では件数を手計算せず、入力データと注意書きの整合を必ず検算する
- **手順/メモ**:
  - 1. deadline == 今日 のタスクを抽出して件数を数える
  - 2. deadline < 今日 かつ未完了のタスクを抽出して件数を数える
  - 3. 入力の「重要な注意点」にある件数と照合する
  - 4. ズレた場合はタスク名一覧を見直してから本文に反映する


## 62. `brainbase-ブリーフィング生成時に-入力にない依存関係を断定しない`

- **教訓**: ブリーフィング生成時に、入力にない依存関係を断定しない
- **手順/メモ**:
  - 1. タスク名・期限・ステータス・優先度から確実に言えることだけを本文に書く
  - 2. 依存関係を推測した場合は「依存している可能性があるため確認」と表現する
  - 3. 推奨アクションには「依存関係の確認」を入れてもよいが、「完了していないと成立しない」と断定しない


## 63. `brainbase-人物・組織分析ではgraphの公開urlを固定せず-ローカルauth設定のserver-urlと`

- **教訓**: 人物・組織分析ではGraphの公開URLを固定せず、ローカルauth設定のserver_urlと権限ヘッダーを正とする
- **手順/メモ**:
  - jq '.server_url' ~/.brainbase/config.json ~/.brainbase/auth.json
  - jq '{role,projects,clearance,server_url}' ~/.brainbase/auth.json
  - curl -s \
  - H "Authorization: Bearer $TOKEN" \
  - H "x-brainbase-role: $ROLE" \
  - H "x-brainbase-projects: $PROJECTS_JSON" \
  - H "x-brainbase-clearance: $CLEARANCE_JSON" \
  - "$SERVER_URL/api/info/graph/entities?type=person&limit=500"


## 64. `brainbase-人物分析では称賛・神話化に寄せず-強みと副作用を必ずセットで扱う`

- **教訓**: 人物分析では称賛・神話化に寄せず、強みと副作用を必ずセットで扱う
- **手順/メモ**:
  - 1. 強みを1つ挙げる
  - 2. 同じ行動が生む副作用を1つ挙げる
  - 3. 発動条件と破綻条件を書く
  - 4. 「OS」「特殊能力」「核能力」など酔いやすいラベルを削る


## 65. `brainbase-会議メモは現在プロジェクト直下だけでなく関連顧客・別プロジェクト配下にあることがある`

- **教訓**: 会議メモは現在プロジェクト直下だけでなく関連顧客・別プロジェクト配下にあることがある
- **手順/メモ**:
  - 1. まず想定場所を確認: ls meetings/minutes/ | grep '2026-05-01\|湘南\|中谷\|shonan'
  - 2. 見つからなければ横断検索: grep -RIlE '湘南|中谷|Shonan|nakatani|セミナー講師' .
  - 3. 見つかったminutesだけでなく transcript_ref の原文も確認する
  - 4. プロジェクトIDと保存ディレクトリ名が違っても、本文の日時・相手・決定事項で同一案件か判定する


## 66. `brainbase-低再現率の入力欠落は入力パイプライン全体にprefix付き計測を入れてから直す`

- **教訓**: 低再現率の入力欠落は入力パイプライン全体にprefix付き計測を入れてから直す
- **手順/メモ**:
  - client: `onData` 発火、`sendText` entry、pending buffer長、dispatch sent/enqueued/droppedをログ
  - client: websocket close時のpending buffer長とqueue sizeをログ
  - client: reconnect/drain時に送れたか捨てたかをログ
  - server: input message受信時にlen/owner/drop理由をログ
  - prefix例: `[TTC-PROBE]` に統一してConsoleとserver logを突き合わせる


## 67. `brainbase-修正前に開発サーバーが実際に読んでいるソースディレクトリを確認する`

- **教訓**: 修正前に開発サーバーが実際に読んでいるソースディレクトリを確認する
- **手順/メモ**:
  - 1. 起動中プロセスのcwdを確認する: lsof -i :<port> などでPIDを特定し、pwdx相当またはps情報を確認
  - 2. ブラウザが叩いているportとdev serverの起動ディレクトリを照合する
  - 3. worktreeではなくL2が配信元なら、実際の配信元にも同じ修正を反映する
  - 4. E2Eは配信元が修正済みであることを確認してから実行する


## 68. `brainbase-出力内で入力のプロジェクト名-baao-を-baaa-と誤記していた`

- **教訓**: 出力内で入力のプロジェクト名 BAAO を BAAA と誤記していた
- **手順/メモ**:
  - 1. 入力に出た project_name/link label を一覧化する
  - 2. 出力前に本文内の固有名詞が一覧と一致するか確認する
  - 3. 類似文字列（BAAO/BAAA など）が出たら入力値へ修正する


## 69. `brainbase-効いている-と言うときは-どのファイル-ログ-プロセスで確認したかを必ず示す`

- **教訓**: 「効いている」と言うときは、どのファイル/ログ/プロセスで確認したかを必ず示す
- **手順/メモ**:
  - repo: /Users/ksato/workspace/code/brainbase
  - runtime server: http://localhost:31013
  - current worktree/session: /Volumes/UNSON-DRIVE/brainbase-worktrees/session-1774143351256-brainbase
  - branch: develop
  - .claude bootstrap は server/services/session-manager.js に入っていて、worktree には .claude/settings.json / skills は存在する
  - Codex hook bridge 実装は scripts/codex-app-repl.mjs に入れ、scripts/ensure_session_runtime.sh の BRAINBASE_CODEX_APP_SERVER default は 1 に変更済み
  - 単体テストは通っている:
  - tests/unit/codex-app-repl.test.js
  - tests/unit/server-session-manager.test.js
  - tests/server/session-manager-env.test.js
  - この session-1774143351256 はまだ旧経路で動いている
  - 実プロセスは `codex resume 019d1a7a-...` で、codex-app-repl.mjs ではない
  - .claude/output/codex-app-server/session.json はまだ無い
  - userpromptsubmit log はあるが 2026-03-25 01:23 の古い実行痕跡だけ
  - つまり「server 再起動」ではなく「この tmux session 内 Codex の再起動/切替」が必要
  - 実際に session-1774143351256 を新経路へ切り替える
  - その session で codex-app-repl.mjs が起動していることを確認する
  - UserPromptSubmit hook がその session の入力時に実行されていることを確認する
  - skills reminder が Codex に届いていることを確認する
  - 確認は推測禁止。実プロセス、tmux、ログ、生成ファイル、必要なら Playwright/CLI で end-to-end まで見る
  - 直したら「何が原因だったか」「何を変えたか」「どう確認したか」を簡潔に報告する
  - `ps` / `tmux` 上で session-1774143351256 が codex-app-repl.mjs 経路になっている
  - /Volumes/UNSON-DRIVE/brainbase-worktrees/session-1774143351256-brainbase/.claude/output/codex-app-server/session.json が生成される
  - UserPromptSubmit hook 実行の新しい痕跡が出る
  - 実際の user turn 後に skills/context reminder が injected されていると確認できる
  - 「効いている」と言うときは、どのファイル/ログ/プロセスで確認したかを必ず示す


## 70. `brainbase-同一人物らしい表記ゆれを別メンバーとして強調しない`

- **教訓**: 同一人物らしい表記ゆれを別メンバーとして強調しない
- **手順/メモ**:
  - 例: `金田 光平` と `金田光平` を別行で強調する前に照合する
  - 1. 空白・敬称・全半角を正規化
  - 2. Graph SSOTまたは入力内の担当情報で同一人物か確認
  - 3. 同一なら合算、未確定なら「同一人物の可能性あり」として扱う


## 71. `brainbase-定期ジョブ内のcodex出力を-dev-nullに捨てると失敗原因が特定不能になる`

- **教訓**: 定期ジョブ内のcodex出力を/dev/nullに捨てると失敗原因が特定不能になる
- **手順/メモ**:
  - 避ける例:
  - `codex exec ... >/dev/null 2>&1`
  - 推奨例:
  - `codex exec ... > "$LOG_DIR/codex.$id.out" 2> "$LOG_DIR/codex.$id.err"`
  - 失敗時に記録する項目:
  - `date`, `PATH`, `which codex`, `which node`, `node -p 'process.arch'`, exit code, stderr tail


## 72. `brainbase-実作業はcodex-execで委譲-claudeはマクロ判断に専念-コンテキスト汚染回避`

- **教訓**: 実作業はcodex execで委譲、Claudeはマクロ判断に専念。コンテキスト汚染回避
- **手順/メモ**:
  - Confirm the linked wiki guidance first.
  - Execute the corrective workflow consistently.
  - Record any new deviations as fresh learning episodes.


## 73. `brainbase-批判を受けた直後は批判文の粗探しより運用改善を優先する`

- **教訓**: 批判を受けた直後は批判文の粗探しより運用改善を優先する
- **手順/メモ**:
  - 1. 批判の本筋を1行で認める
  - 2. 採用する修正を最大3点に絞る
  - 3. 捨てる表現・行動を明示する
  - 4. 次の実地アクションを1つだけ決める


## 74. `brainbase-技術プロダクト告知は-課題の仕込み-一行対比コピー-公開-裏付け-の型が再利用できる`

- **教訓**: 技術プロダクト告知は「課題の仕込み→一行対比コピー→公開+裏付け」の型が再利用できる
- **手順/メモ**:
  - 1. 数日前から課題・実害・背景技術を投稿する
  - 2. 公開投稿は「何ではなく何から、何を実現するか」を1行で言う
  - 3. 略称と正式名称をセットで出す
  - 4. 画像・デモ・OSSリンクを添える
  - 5. 同日に論文、技術記事、Zenn/noteなどの詳説を別投稿する
  - 例: 「コードではなくStoryからズレを見つける」


## 75. `brainbase-担当者情報がない時に-誰に何を-を満たすため担当者を仮置きしない`

- **教訓**: 担当者情報がない時に「誰に何を」を満たすため担当者を仮置きしない
- **手順/メモ**:
  - 入力に assignee / owner / GM / lead があるか確認する
  - なければ「誰に」は「担当未特定」または「PJオーナー要確認」とする
  - 例: 「senrigan: 担当未特定。まずPJオーナーを確認し、続行/一時停止の判断を依頼」


## 76. `brainbase-指定された資料パスが依頼内容と合わない場合は-無理に変換せず不一致の根拠と選択肢を出す`

- **教訓**: 指定された資料パスが依頼内容と合わない場合は、無理に変換せず不一致の根拠と選択肢を出す
- **手順/メモ**:
  - 1. 共有パス配下の代表ファイル名と内容を確認する
  - 2. 当初依頼の対象と一致するか判定する
  - 3. 不一致なら「別物に見える」と明示する
  - 4. 正しい資料パスの提示、意図変更、見立て整理などの選択肢を提示する


## 77. `brainbase-日次ブリーフィングでは古い期限を機械的に最優先にしない`

- **教訓**: 日次ブリーフィングでは古い期限を機械的に最優先にしない
- **手順/メモ**:
  - 1. 今日の日付と各タスクの deadline/status/priority を確認する
  - 2. 進行中・外部待ち・近日イベント連動を最優先候補にする
  - 3. 長期期限超過タスクは TOP3 に入れる場合でも、推奨アクションは「現状確認・継続判断・期限再設定」にする
  - 4. TOP3 と時間帯別アクションの順序が矛盾していないか最後に確認する


## 78. `brainbase-日次ブリーフィング入力に過去日付や季節外れの予定が混ざる前提で検算する`

- **教訓**: 日次ブリーフィング入力に過去日付や季節外れの予定が混ざる前提で検算する
- **手順/メモ**:
  - 例: 2026/04/26 のブリーフィングに「1月中旬」「2026-01-20期限」が出た場合
  - 期限超過日数を明示する
  - 今日やる作業は実行ではなく、担当者確認・期限更新・不要ならクローズ判断にする
  - 近日イベントなど現在も効いている制約だけを実行計画に残す


## 79. `brainbase-最新議事録や外部repo情報を読む前にpullする`

- **教訓**: 最新議事録や外部repo情報を読む前にpullする
- **手順/メモ**:
  - cd <対象repo>
  - git status --short
  - git pull --ff-only
  - rg '<会議名|日付|参加者名|キーワード>' meetings docs .


## 80. `brainbase-朝ブリーフィングでは全体進捗率に引きずられず-対象タスク群だけの停滞を明示する`

- **教訓**: 朝ブリーフィングでは全体進捗率に引きずられず、対象タスク群だけの停滞を明示する
- **手順/メモ**:
  - 1. 入力タスクを担当者向け対象群として集計する
  - 2. 未着手件数、期限超過件数、最古の超過日数を算出する
  - 3. 全体進捗率は補足情報に留め、対象群の停滞を主文脈にする
  - 例: 「スプリント80%」でも「EXPO系5件はすべて未着手」と明示する


## 81. `brainbase-朝ブリーフィングでは期限だけでなく実行可能日・曜日制約も織り込む`

- **教訓**: 朝ブリーフィングでは期限だけでなく実行可能日・曜日制約も織り込む
- **手順/メモ**:
  - 1. ブリーフィング日付の曜日を確認する
  - 2. タスクを「今日実行可能」「相手都合で次営業日実行」「期限超過」に分ける
  - 3. 電話・対面確認は休日なら確認事項整理を今日の作業にする
  - 4. 次営業日の具体時刻（例: 09:00）を推奨アクションに入れる


## 82. `brainbase-朝ブリーフィングでは期限超過タスクを-古さ・進行中・高優先度・顧客影響で順位付けする`

- **教訓**: 朝ブリーフィングでは期限超過タスクを、古さ・進行中・高優先度・顧客影響で順位付けする
- **手順/メモ**:
  - 1. 今日の日付と各deadlineを比較し、期限超過日数を算出する
  - 2. 進行中かつ最古の期限超過タスクを最優先候補にする
  - 3. 同じ顧客・同じ障害領域の高優先度タスクは連続して並べ、まとめて着手できることを示す
  - 4. 推奨アクションは午前・午後・夕方など時間帯付きで書く
  - 5. NocoDBなど参照リンクは末尾にSlack mrkdwn形式で横並びにする


## 83. `brainbase-朝ブリーフィングでは期限超過日数を明示して優先順位の根拠にする`

- **教訓**: 朝ブリーフィングでは期限超過日数を明示して優先順位の根拠にする
- **手順/メモ**:
  - 1. 指定日を基準日にする
  - 2. 各taskのdeadlineとの差分を日数で計算する
  - 3. priority=高、期限超過が大きい、顧客影響がある、進行中で詰まりやすいものを上位化する
  - 4. 推奨アクションは「午前中」「午後」「15時まで」など時間軸付きにする
  - 5. NocoDBリンクはSlack mrkdwn形式 `<url|label>` で末尾に横並び表示する


## 84. `brainbase-朝ブリーフィングでタスク名から月次・日曜対応などを推測して断定していた`

- **教訓**: 朝ブリーフィングでタスク名から月次・日曜対応などを推測して断定していた
- **手順/メモ**:
  - 1. deadline があるタスクは期限超過/残日数で優先度付けする
  - 2. deadline がないタスクは、業務名から周期を推測せず「期限未設定」と表記する
  - 3. 推奨アクションは入力情報から確実に言える範囲に限定する
  - 4. 例: 「Jibble→請求書→GMOは一連の月次フロー」ではなく「関連しそうなBackOffice作業としてまとめて確認」


## 85. `brainbase-朝ブリーフィングの理由づけは-入力フィールド由来と推測を分ける`

- **教訓**: 朝ブリーフィングの理由づけは、入力フィールド由来と推測を分ける
- **手順/メモ**:
  - 根拠例: 「今日が期限」「3日超過」「優先度が高」「未着手」
  - 推測例: 「後続作業のブロッカーになっている可能性」
  - 避ける例: 入力にないのに「リソース確保に直結」「案件進行を加速」と断定する


## 86. `brainbase-期限超過タスクの優先順位は日付だけでなく依存関係も併記して判断する`

- **教訓**: 期限超過タスクの優先順位は日付だけでなく依存関係も併記して判断する
- **手順/メモ**:
  - 1. 各タスクの期限超過日数を計算する
  - 2. タスク名から依存関係を推定する（方針→ラフ→テスト→制作・発注など）
  - 3. TOP3の理由を「期限」と「依存・影響」の2軸で書く
  - 例: ブランド方針は期限順位が2位でも、後続制作の起点として午前中の確認対象にする


## 87. `brainbase-期限超過数だけから原因診断を断定しない`

- **教訓**: 期限超過数だけから原因診断を断定しない
- **手順/メモ**:
  - 悪い例: 「進行中が多いのに超過あり — 完了定義が曖昧な可能性あり」を断定トーンで主因扱いする
  - 良い例: 「仮説: 完了定義のズレまたは優先度過多。確認: 進行中8件の完了条件とブロッカーを担当者に確認」
  - 数値から言えること、仮説、確認アクションを分けて書く


## 88. `brainbase-本番認証情報を生成・共有する作業では-平文パスワードをログや会話に出さない手順を先に固定する`

- **教訓**: 本番認証情報を生成・共有する作業では、平文パスワードをログや会話に出さない手順を先に固定する
- **手順/メモ**:
  - 1. 生成結果はstdoutに出さず、SSM SecureStringまたは一時ファイルへ直接保存
  - 2. CSV作成時は必要最小限のカラムにし、パスワード入りの場合は作成直後に暗号化ZIP化
  - 3. ZIPパスワードは添付メールとは別経路で共有
  - 4. 送信後に `/tmp/...` の平文CSV、本文、ZIP、作成スクリプトを削除
  - 5. 最終報告にはmessage_id、SSMパス、削除済み事実だけを記載し、平文秘密値は載せない


## 89. `brainbase-検査仕様書と試験成績表は同じテストid体系で揃える`

- **教訓**: 検査仕様書と試験成績表は同じテストID体系で揃える
- **手順/メモ**:
  - 1. 実際の総合テストチェックリストを正本にする
  - 2. 検査仕様書: ID / 大項目 / テスト項目 / テスト手順 / 期待結果
  - 3. 試験成績表: 同じID / 大項目 / テスト項目 / 実施日 / 実施者 / 結果
  - 4. 両者の項目数とIDを照合してから納品する


## 90. `brainbase-業務棚卸しではログ件数をそのまま業務量にせず-自動実行・agent対話・本人判断の3層に分ける`

- **教訓**: 業務棚卸しではログ件数をそのまま業務量にせず、自動実行・agent対話・本人判断の3層に分ける
- **手順/メモ**:
  - 1. ログをプロジェクト/実行主体で集計する
  - 2. 自動運行、agent対話駆動、本人の抽象・戦略判断に分類する
  - 3. 各カテゴリに「自分がやる」「agent委譲」「人に振る」を付ける
  - 4. 握り癖は「コマンドレベルまで指示している領域」として別抽出する
  - 5. セッション探索や記憶分散は個別作業ではなく仕組み化対象として扱う


## 91. `brainbase-構造化入力からダッシュボードを生成する時に-繰り返し項目の選択肢を途中から省略しない`

- **教訓**: 構造化入力からダッシュボードを生成する時に、繰り返し項目の選択肢を途中から省略しない
- **手順/メモ**:
  - 1. 入力のDecision項目を件数確認する
  - 2. 各項目について「タイトル」「状態」「選択肢」「推奨」を表形式または同一テンプレートで展開する
  - 3. 文字数制限がある場合は説明文を削り、選択肢・推奨は削らない


## 92. `brainbase-洞察が出た直後に仕様書化せず-まず小さな実地ログで検証する`

- **教訓**: 洞察が出た直後に仕様書化せず、まず小さな実地ログで検証する
- **手順/メモ**:
  - 会議前:
  - 今日、相手を早く整理しすぎそうな場面
  - 数字に落としすぎそうな論点
  - 先読みで潰しそうな提案
  - 会議後:
  - 相手の未整理な芽を刈った場面
  - 数字にできない重要論点を飛ばした場面
  - 正しいが早すぎる否定をした場面
  - 3回分集めてから帰納的に整理する


## 93. `brainbase-活動状態管理ではturn-startedで前回done情報を消すと復元不能になる`

- **教訓**: 活動状態管理ではturn_startedで前回done情報を消すと復元不能になる
- **手順/メモ**:
  - 1. turn_startedではlastWorkingAtとactiveTurnIdsを更新し、lastDoneAtは保持する
  - 2. turn_completedではClaude形式以外のturnIdでも残留activeTurnIdsを安全にクリアする
  - 3. restoreHookStatusではlastDoneAtがあるstale workingをdoneへ復元する
  - 4. 昇格対象は直近24時間などの上限を設け、古すぎるworkingは破棄する
  - 5. state永続化は競合リトライを入れ、再起動後もhookStatusが残ることを確認する


## 94. `brainbase-特許調査ではuspto-web検索だけで-存在しない-と判断しない`

- **教訓**: 特許調査ではUSPTO/Web検索だけで「存在しない」と判断しない
- **手順/メモ**:
  - 1. 発明者名の揺れを列挙: 白水重明 / HAKUSUI Shigeaki / Shigeaki Hakusui
  - 2. 出願人名の揺れを列挙: POLYTEQ LTD. / Polyteq / 株式会社ポリテック 等
  - 3. USPTO/Google Patents/Justiaだけでなく、WIPO PATENTSCOPE・Espacenet・J-PlatPatも確認
  - 4. 見つからない場合は「未確認」とし、検索対象DBと未確認範囲を明記する


## 95. `brainbase-環境変数確認でnocodbのトークンや管理者パスワードをそのまま出力していた`

- **教訓**: 環境変数確認でNocoDBのトークンや管理者パスワードをそのまま出力していた
- **手順/メモ**:
  - 悪い例: env | grep -i noco
  - 良い例: env | awk -F= '/NOCODB|NOCO/ {print $1"=<redacted>"}'
  - 設定JSON確認時も secret/token/password を含むキーは <redacted> に置換してから表示する


## 96. `brainbase-画像preview不具合は拡張子対応だけでなくworktree所在とサイズ上限を疑う`

- **教訓**: 画像preview不具合は拡張子対応だけでなくworktree所在とサイズ上限を疑う
- **手順/メモ**:
  - 1. ユーザーが見ているsession/worktreeと、画像を置いたworktreeが一致しているか確認
  - 2. _inbox/<purpose>/ 配下にコピーして相対パスで開く
  - 3. 413が出る場合は画像サイズを確認
  - 4. 512KB前後を超える画像は圧縮するか、画像用上限をMAX_TEXT_READ_SIZEと分離する
  - 5. HTML経由で見える場合と直接previewの経路差も確認する


## 97. `brainbase-略称や聞き違いらしい技術名は正式名候補に展開して検索する`

- **教訓**: 略称や聞き違いらしい技術名は正式名候補に展開して検索する
- **手順/メモ**:
  - 最初の検索: "Corp2Skill" RAG retrieval LLM
  - ヒットしない場合: "Corpus2Skill" OR "C2S" retrieval RAG knowledge skill LLM
  - 一次情報としてGitHubやarXivを優先して確認する


## 98. `brainbase-自己分析や人物評価は称賛語でまとめず-発動条件・破綻条件・対策に変換する`

- **教訓**: 自己分析や人物評価は称賛語でまとめず、発動条件・破綻条件・対策に変換する
- **手順/メモ**:
  - 1. 能力名を観察可能な行動に言い換える
  - 2. 発動条件を書く: どんな入力・状況で機能するか
  - 3. 破綻条件を書く: どんな相手・論点・時間軸で逆効果になるか
  - 4. 対策を書く: 会議中/レビュー時に使えるチェックリストへ落とす
  - 5. 仕様化できない感情・政治・タイミング要素は「保留領域」として別枠に残す


## 99. `brainbase-複数-worktree-をまたぐ修正では-作成した-story-やテストが-commit-対象-`

- **教訓**: 複数 worktree をまたぐ修正では、作成した Story やテストが commit 対象 worktree に存在するか確認する
- **手順/メモ**:
  - 作業開始時に WT=<commit対象worktree> を固定する
  - Story/テスト/実装ファイルは $WT 配下に作る
  - 切替後は git -C "$WT" status --short と ls "$WT/<path>" で存在確認する
  - git add 前に対象ファイル一覧を $WT 基準で確認する


## 100. `brainbase-複数-worktree-環境では-gh-pr-merge-が-checkout-起因で失敗するた`

- **教訓**: "複数 worktree 環境では `gh pr merge` が checkout 起因で失敗するため API merge を fallback にする"
- **手順/メモ**:
  - 失敗例:
  - `gh pr merge 41 --merge --delete-branch`
  - fallback:
  - `gh api repos/<owner>/<repo>/pulls/<pr-number>/merge -X PUT -f merge_method=merge`
  - 確認:
  - `gh pr view <pr-number> --json state,mergedAt,mergeCommit`


## 101. `brainbase-複数議事録の要望トップ3は-単純な列挙ではなく複数案件で重なる論点を優先して統合する`

- **教訓**: 複数議事録の要望トップ3は、単純な列挙ではなく複数案件で重なる論点を優先して統合する
- **手順/メモ**:
  - 1. 議事録を全件読む
  - 2. 各議事録から「要望」「次回行動」「上司判断事項」を抽出する
  - 3. 要望トップ3は件数・類似性・経営インパクトで統合する
  - 4. 次アクション表は「担当者 / 顧客 / 次アクション / 期限」にする
  - 5. ブロッカー表は「内容 / 関連 / 必要な判断」にする


## 102. `brainbase-診断用id-pwログインはdb作成だけでは不十分で-ビルド時許可リストへの追加と本番デプロイが必`

- **教訓**: 診断用ID/PWログインはDB作成だけでは不十分で、ビルド時許可リストへの追加と本番デプロイが必要
- **手順/メモ**:
  - 1. 本番DBに `authProvider: credentials`, `role`, `status: ACTIVE`, bcrypt済みpasswordでUserを作成
  - 2. 平文パスワードはSSM SecureStringに保存
  - 3. `.github/workflows/deploy-production.yml` の `NEXT_PUBLIC_DEV_AUTH_EMAILS` に対象メールを追記
  - 4. PRを作成し、本番デプロイ後にログイン可能になることを確認
  - 5. 診断終了後は許可リスト削除、アカウント無効化、SSMパラメータ削除を実施


## 103. `brainbase-請求書作成前に契約書・会話・内訳合計の3点照合を必須にする`

- **教訓**: 請求書作成前に契約書・会話・内訳合計の3点照合を必須にする
- **手順/メモ**:
  - 1. 契約書から期間・税抜額・消費税・税込額を抽出
  - 2. 会話ログ/合意文から同じ項目を抽出
  - 3. 明細行の税抜合計、消費税、税込合計を手計算で検算
  - 4. 差分があれば「未確定」として確認事項にする
  - 5. 確定後にのみ freee API の POST/PUT を実行


## 104. `brainbase-講師プロフィール作成は複数の正本ソースを束ねて用途別の長さで出すと再利用しやすい`

- **教訓**: 講師プロフィール作成は複数の正本ソースを束ねて用途別の長さで出すと再利用しやすい
- **手順/メモ**:
  - 参照候補:
  - /Users/ksato/workspace/IDENTITY.md
  - /Users/ksato/workspace/sns/x_account_profile.md
  - /Users/ksato/workspace/projects/personal/portfolio/docs/career-history.md
  - docs/events/ や docs/slides/ の過去登壇資料
  - 出力構成:
  - 約100字: フライヤー用
  - 約300字: 案内資料・当日紹介用
  - 約600字: 詳細版
  - 氏名、所属、連絡先、SNS、顔写真指定
  - メール貼り付け用本文


## 105. `brainbase-議事録検索で広域findを長時間回す前に-正本リポジトリとurl候補を優先する`

- **教訓**: 議事録検索で広域findを長時間回す前に、正本リポジトリとURL候補を優先する
- **手順/メモ**:
  - 1. まず既知候補を確認: /Users/ksato/workspace/code/brainbase-project/meetings/transcripts/
  - 2. 日付で絞る: ls /Users/ksato/workspace/code/brainbase-project/meetings/transcripts/ | rg '2026-04-24|大田原|Otawara|cursorvers'
  - 3. GitHub URLが提示されたら、ローカル探索を続けずそのURLまたは対応ローカルファイルを読む
  - 4. 広域検索する場合も find /Users/ksato/workspace ... に限定し、タイムボックスを置く
