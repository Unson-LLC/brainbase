# SNS工場設計（現行投稿の出荷ライン）

目的: 「生成量」ではなく「公開・配信完了量」を増やすために、**今の投稿が作られて出荷されるまでの流れ**を工場化して固定する。

## 0. 前提（SSOTと工場の境界）
- **SSOTは _codex**（製造の正本）。NocoDBは補助。
- 1投稿=1出荷物（X/記事/Noteは別ライン）
- 出荷量は `published` でのみカウント（draftはカウントしない）

## 1. 工場ラインの全体像（直列 + 並行）
```
Inputs → Seed(自動) → Sprout(3ペルソナ) → Pillar/Idea → Batch計画
      → Draft生成 → Tension Gate → QC → 鬼編集長レビュー
      → Variety Gate → Scheduling → Image生成 → 出荷 → 計測 → 学習
```

## 2. 入力（Inputs: 原材料）
### 2.1 ソース
- 議事録/会議ログ/決定ログ（Settingsに登録された各プロジェクトの保存先）
- Git履歴（決定・差分・失敗ログ）
- _codex内の既存Pillar / Proof / 既存投稿

### 2.2 入力の保存先
- Seed→Sproutログ: `_codex/sns/x/04_ideas/YYYY-MM-DD_seed_sprout.md`
- Proof: `_codex/sns/x/03_proofs/`
- Pillar: `_codex/sns/x/02_pillars/`

## 3. Seed → Sprout（創造性の注入工程）
### 3.1 Seedは「1行単位」で自動生成（採用判断も自動）
- 目的: AIの出力をぼかさない（1行の核に圧縮）
- 形式: 1行で「伝えたい核」を生成
- 保存: 04_ideasのSeed→Sproutログ
- 採用判定: 自動（人の介在なし）
  - 目安: Pillar関連度 / tension_tag / proof有無 / 具体性 でスコアリング

### 3.2 3ペルソナ選抜（多様性必須）
- 参照: `_codex/sns/x/ops/persona_pool.md`
- 年齢 / 性別 / 国籍が偏らないように **3人**選ぶ
- ルール: **「本人の好み禁止 / 大衆が面白いと思うもの」**

### 3.3 Sprout生成
- 3人の視点で芽を出す → 合成して1つに決定
- **必ずプロセスをログに残す**
- 投稿本文は「俺/自分の話」に置換する
- ペルソナの職種/現場は本文に直接書かない

## 4. Pillar / Idea への変換
### 4.1 Pillar紐付け
- 既存Pillarに紐付け、なければ新規作成

### 4.2 Idea化
- Ideaは1投稿の素材単位
- Laneとtension_tagを付与
  - tension_tag: surprise / contradiction / anxiety

## 5. Batch計画（出荷指示書）
保存先: `_codex/sns/x/06_batches/YYYY-MM-DD.md`
- その日の出荷数、投稿時間、Lane配分を確定
- 画像テンプレの重複もこの時点で配分する

## 6. Draft生成（sns-smart Phase2）
保存先: `_codex/sns/x/05_posts/draft/`
- 文章量と構成に幅を持たせる（Variety Gate前提）
- 1投稿=1出荷物（X/記事/Noteは別レコード）

## 7. Tension Gate（意外性・矛盾・不安）
参照: `_codex/sns/x/ops/tension_gate.md`
- 投稿ごとに tension_tag を強制付与
- ここで「驚きの核」を明示する

## 8. QC（品質検査）
参照: `_codex/sns/x/ops/qc_checklist.md`
- **捏造防止**: 自分が体験していない具体経験は書かない
- AIっぽさの排除
- 証拠/根拠不足の検知

## 9. 鬼編集長レビュー（Phase 2.5）
参照: `_codex/sns/x/ops/phase2_5_reviews_YYYY-MM-DD_*.md`
- 80点未満は差し戻し
- 「テンプレ臭」「文量固定」を厳しく減点

## 10. Variety Gate（分布制御）
参照: `_codex/sns/x/ops/variety_gate.md`
- 文量/構成/フック/CTA/テンションタグの被りを排除
- 改行は「まとまり単位で空行」必須
- **CTAは自然なときだけ**（無理なCTAは禁止）

## 11. Scheduling（出荷キュー）
保存先: `_codex/sns/x/05_posts/scheduled/`
反映: `_codex/sns/scheduled_posts.yml`
- 出荷時間帯は 07:00〜02:00
- 主投稿は3時間以上あける

## 12. 画像生成（Phase 3）
保存先: `_codex/sns/images/`
- 同日同テンプレ禁止
- 連続同テンプレ禁止
- 画像テンプレは「日次で分散」

## 13. 出荷（Shipping）
実行: `_codex/common/ops/scripts/scheduled_post_runner.py`
- ルール違反（テンプレ重複等）は **Stop-the-line**

## 14. 計測 → 学習
保存先: `_codex/sns/x/07_metrics/` / `_codex/sns/x/08_experiments/`
- 24h / 7d 指標を記録
- 勝ちパターンをテンプレに反映

---

## 工場化の最小チェックポイント
- Seedが「1行単位」で生成されているか
- 3ペルソナのプロセスログがあるか
- 文章量/構成/CTAが被っていないか
- 画像テンプレが同日で重複していないか

## 関連ドキュメント
- `_codex/sns/x/ops/runbook.md`
- `_codex/sns/x/ops/stop_the_line.md`
- `_codex/sns/x/ops/variety_gate.md`
- `_codex/sns/x/ops/tension_gate.md`
- `_codex/sns/x/ops/story_alignment.md`
