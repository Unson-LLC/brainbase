# 意思決定ナレッジ庫（Knowledge Base for Decisions）

目的：佐藤の意思決定に不可欠な“前提知識・判断アルゴリズム・過去の定石”を一元保管し、プロトコルとセットで参照できるようにする。

## 収容するもの
- 基本前提・価値観（幸福資本論の観点、7ルール等の拡張解説）
- 定石リスト：よくある論点に対する既定方針（値引きNG、前受け必須、例外費など）
- 事業別の意思決定基準（Zeims/Aitle/SalesTailor/TechKnight での優先順位や線引き）
- 過去の重要Decision Logの要約（再利用したい判断パターン）
- チェックリスト類（投入前/リリース前/顧客受け入れ基準 など）

## 運用ルール
1. 新しい判断ルール・定石ができたら、このフォルダに Markdown 1ファイルで追加する。
2. 追加したら `codex/00_common/architecture_map.md` との整合を確認（用語ズレ防止）。
3. 週次レビュー時に「新規Decision Logから汎用化できる知見がないか」を確認し、再利用できるものをここへ移す。
4. 冗長・重複が増えたら月次で掃除（最新版だけ残す）。

## 推奨ファイル構造（例）
- `principles.md`            … 佐藤の価値観・意思決定原則・運用ルール・最新補足（原典）
- `playbook_pricing.md`      … 価格/割引/前受けの定石
- `playbook_sla.md`          … SLA・障害対応の定石
- `playbook_sales.md`        … 商談・前受け・反論対応の定石
- `playbook_delivery.md`     … 導入・TTFV・CS工数の定石
- `eos_framework.md`         … EOS（Entrepreneurial Operating System）の要約/再利用メモ
- `work_the_system.md`       … Work the System 要約（システム思考・文書化・維持のフレーム）
- `prompt_keigo_values.md`   … ChatGPTに佐藤の価値観/判断基準を引き出す定型プロンプト
- `small_company_shikumika.md` … 小規模組織の仕組み化（人材育成・評価・ビジョン運用のフレーム）
- `garber_shikumi_keiei.md`    … ガーバー流「仕組み」経営要約（組織図・職務契約・マニュアル化・数値化）
- `case_studies.md`          … 過去Decision Logの要約と再利用パターン

まずは空で置き、必要に応じて上記ファイルを追加していく。
