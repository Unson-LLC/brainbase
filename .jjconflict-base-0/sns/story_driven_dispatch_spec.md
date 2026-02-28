# ストーリー駆動 出荷仕様（X記事 / note 工場化）

最終更新: 2026-01-26

---

## 1. 目的
- X短文→X記事→noteを「連続ストーリー」として出荷し、
  認知→納得→資産化の流れを固定する
- 出荷判断とスケジュールを機械的に決められる状態にする

---

## 2. 正本（参照）
- `shared/_codex/projects/brainbase/01_strategy.md`
- `shared/_codex/sns/sns_strategy_os.md`
- `shared/_codex/sns/note_strategy.md`
- `shared/_codex/sns/x_account_profile.md`

---

## 3. seed → 媒体の振り分け基準

### 必須フィールド（共通）
- seed_line（人間の1行）
- conflict（矛盾/不安）
- decision（判断）
- evidence_refs（根拠1つ以上）

### note追加条件
- result（結果/学び）があること
- 根拠2つ以上

### スコアリング（100点）
- 深さ（0-30）: 判断の分岐・トレードオフがあるか
- 根拠（0-20）: 数字・ログ・実例の裏付け
- ストーリー緊張（0-20）: 不安/矛盾/葛藤があるか
- 軸足整合（0-15）: x_account_profileの専門領域か
- 再利用性（0-15）: note化・X記事化できるか

### 採用ルール
- note: 80点以上 + result必須 + 根拠2つ以上
- X記事: 65点以上 + decision必須 + 根拠1つ以上
- X短文: 40点以上（それ以下は保留）

---

## 4. X記事 工場仕様

### 定義
- **X短文の翌日以降に出す「判断プロセスの長文化」**
- noteの予告編ではなく、**単体でも価値がある長文**

### X記事とnoteの入口心理（表現テンプレ）
※ X記事とnoteの違いは以下のトーンで表現する

```
Xの記事、フォロー転換率が異常でした。

・6万インプ
・269プロフアクセス
・+84フォロー（当日）

なぜここまで数字が動いたのか？
裏側に仕込んだ“5つの設計”を公開します。

❶冒頭フックを「Xポスト基準」で作る
X記事は、noteと入口の心理が全く違います。

・X記事：TLで偶然流れてきて読む
・note：発信者のファンになってから読む

そのため冒頭数行は、“Xポスト基準”で作り込みました。ここが弱いと、そもそも記事に入る前に離脱されます。

❷自己紹介を3点配置する
配置したのはこの3ヶ所です。

・序盤（冒頭フック直後）
・中盤（事例の合間）
・終盤（締めに織り込む）

この部分は、噂のタカハシさん（@JtpVm32EPe5984）のX記事構成を参考にしています。
（内容も面白いので、参考として読む価値あり）

ただ、自分は「冒頭にプロフィールを置けるほど強い肩書きではない」と判断し、あえてフック直後にしました。

❸5分で読めると伝える
冒頭フック（興味付け）の最後に、
「5分で読めます」と明記しました。

長文ほど離脱が増えるので、所要時間の提示で読了率が変わります。

❹次回予告でフォロー導線を作る
記事の最後に、

「来週、1つ発表します」
「続報をお待ちください」
という“予告”を入れました。

これはザイガルニック効果（未完了のものに注意が向く）を利用しています。

読み終えた瞬間に「続きが気になる」状態をつくり、そのままフォローにつなげる狙いです。

❺需要のあるテーマを書く
そもそも興味のないテーマは読まれません。

そこで、過去の伸びた投稿をベースにしつつ、以下を＋αして「再現性のある伸び方」を狙いました。

・別の事例
・具体的な4STEP
・強い数字（530億円など）

■総括
・入口（冒頭）はXの文法
・中身（説明パート）はnoteの文法

この2つの「いいとこ取り」で構成した形です。

いまXは、明らかにnoteの領域（長文・有料化・メンバーシップ）を取りに来ています。

その中でX記事は「集客〜信用構築」まで一気通貫で担える強い武器になりそうです。
```

### 入力条件
- seedスコア 65点以上
- decision + evidence_refs が存在

### 出力フォーマット（必須構成）
1. 結論（1行）
2. 判断の背景（2〜4段落）
3. 具体例（最低1つ）
4. 次の行動 or 問いかけ

### 出荷スケジュール
- **スロット**: 07:10 / 10:30 / 13:30（JST）
- **同一story_idは1日1本**
- 原則「短文の翌日」に出荷（続き感を作る）
- 候補がない日はX記事を空け、短文に置換

### 品質ゲート
- sns-smart Phase2.5（鬼編集長レビュー 80点以上）
- 「自分語りの軸足」と「判断プロセス」が明示されていること
- 余計なCTA強要はしない（必要なら自然に）

### 保存先
- `shared/_codex/sns/drafts/x_article_<topic>.md`

---

## 5. note 工場仕様

### 定義
- **背景/判断理由/具体例/再現条件**まで掘って資産化する
- AIO/SEOに耐える構造で「検索に残る」ことが目的

### 入力条件
- seedスコア 80点以上
- result + evidence_refs複数

### 出力フォーマット（必須構成）
1. 問題（背景）
2. 判断理由（なぜその決断をしたか）
3. 実装/具体例（事実・数字）
4. 結果（変化）
5. 再現条件（誰が、どうすれば再現できるか）

### 出荷スケジュール
- 週次 2〜3本
- 「X記事の反応が良かったテーマ」を優先

### 品質ゲート
- note-smart Phase2.5（鬼編集長レビュー）
- 具体例・数字が最低1つ以上含まれる
- 1テーマ1結論を守る

### 保存先
- `shared/_codex/sns/drafts/note_<topic>.md`

---

## 6. ストーリー連携ルール

### story_idの運用
- 1 story_id = X短文 → X記事 → note の一連
- story_stage: hook / progress / decision / result / reflection

### 出荷順序
1. X短文（hook/矛盾提示）
2. X記事（判断プロセスの長文化）
3. note（体系化・資産化）

---

## 7. ログ

- X短文/X記事: `shared/_codex/sns/post_log.md`
- note: `shared/_codex/sns/note_log.md`（新規）

---

## 8. 運用原則
- seed_line（人間の1行）が無いものは出荷しない
- story_idの連続性を守る（同一story_idを連投しない）
- 計測結果は次回Pillar選定に反映する

---

## 9. パイプラインI/O仕様（sns-smart / note-smart連携）

### 9.1 Story ID命名
```
story-YYYYMMDD-XXX
```
- 同日の連番で採番
- X短文 / X記事 / note で共通利用

### 9.2 入力（seed）
- 取得元: 議事録 / 決定ログ / 日報
- 形式: seed_line + conflict + decision + evidence_refs
- 出力先（保管）: `shared/_codex/sns/log/seed_YYYY-MM-DD.md`

### 9.3 X記事フロー（sns-smart拡張）
```
seed → x-article draft → review（Phase2.5）→ schedule
```
**保存先（案）**:
- draft: `shared/_codex/sns/drafts/x_article_<story_id>.md`
- reviewed: `shared/_codex/sns/drafts/x_article_<story_id>_reviewed.md`
- final: `shared/_codex/sns/drafts/x_article_<story_id>_final.md`

### 9.4 noteフロー（note-smart）
```
seed → structure（Phase1）→ draft（Phase2）→ review（Phase2.5）→ final（Phase3）
```
**保存先（案）**:
- structure: `shared/_codex/sns/drafts/note_<story_id>_structure.md`
- draft: `shared/_codex/sns/drafts/note_<story_id>_draft.md`
- reviewed: `shared/_codex/sns/drafts/note_<story_id>_reviewed.md`
- final: `shared/_codex/sns/drafts/note_<story_id>_final.md`

### 9.5 出荷ログ（媒体別）
- X短文/X記事: `shared/_codex/sns/post_log.md`
- note: `shared/_codex/sns/note_log.md`（新規）

---

## 10. 運用ルール化（出荷計画 / WIP / 再利用・計測）

### 10.1 日次出荷計画（X短文 / X記事）
**計画ファイル**: `shared/_codex/sns/log/dispatch_plan_YYYY-MM-DD.md`

**必須項目**:
- story_id / story_stage
- 出荷スロット（時間）
- 媒体（X短文 / X記事）
- 画像有無

**原則**:
- 同一story_idは1日1本
- X記事スロットに空きがあれば短文で埋める
- 朝〜2時（JST）の有効帯のみで出荷

### 10.2 週次出荷計画（note）
**選定タイミング**: 週次レビュー時

**選定ルール**:
- 直近のX記事で反応が良いテーマを優先
- resultが揃ったseedのみnote化
- 週2〜3本を上限（品質維持を優先）

### 10.3 WIP制御（詰まり防止）
**暫定閾値**:
- X記事レビュー待ちが5件超 → 生成停止、レビュー消化を優先
- noteレビュー待ちが2件超 → 生成停止、編集優先

**原則**:
- 作るより流すを優先する
- 生成は常にレビュー能力に合わせる

### 10.4 再利用ルール
- X記事で反応が良いテーマ → note候補に昇格
- noteで反応が良いテーマ → X短文（別角度）で再利用

**記録先**: `shared/_codex/sns/reuse.md`

### 10.5 計測ログ
**X記事**:
- 24h/7dで `post_log.md` に追記
- metricsは `shared/_codex/sns/metrics.md` に集約

**note**:
- PV / スキ / フォロワー増加を `note_log.md` に週次更新
