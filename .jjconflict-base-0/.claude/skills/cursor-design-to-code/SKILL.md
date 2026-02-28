---
name: cursor-design-to-code
description: Cursor PlanningモードによるDesign-to-Code速習メモ。CursorでPlanning→Buildを活用しデザインを素早くコード化したいとき
---

## Triggers

以下の状況で使用：
- 新規UIや小規模機能をCursorだけで素早く形にしたいとき
- Planningモードの進め方とプロンプト例を確認したいとき

# CursorでのDesign-to-Code仕組み化メモ（Ryo Luセッション要約）
出典: "Full Tutorial: Design to Code in 45 Min with Cursor's Head of Design | Ryo Lu" (2025-11) transcript 抜粋

## 核心ポイント
- **Planningモードで先に設計を書く**：コードを書かせる前に「仕様案」をAIに書かせる。Markdownの計画が生成される → 人が修正 → Build でコード生成。
- **曖昧な依頼ほどPlanningモード**：AIが質問やTODOを自動で出す。仕様粒度が上がるほど一発で目的のUI/機能が出る。
- **ライブ状態でプロトタイピング**：FigmaなしでCursor上でUIを動かしながら調整。デザイナーが直接コードを触ることでピクセルずれの往復を削減。
- **テンプレ＋テーマをAIに流用**：Shadcn等の既存UIコンポーネント＋テーマ調整で再現性とアクセシビリティを担保。AIは既存パターンの組み合わせが得意。
- **役割の境界を薄くする**：PM/Design/Engが同じCursor空間で計画→実装→テストまで回す。チケット駆動の小修正はバックグラウンドAgentに投げ、主要フローはローカルでレビュー。
- **短いループを複数並列**：ローカルのメインAgentで大きな変更、背景で小タスクAgentを走らせる（将来はワークツリー対応で安全並列）。
- **仕様は“死んでいない”**：モデル精度が上がるほど、良い仕様を書けば良い実装が返る。チャット一発より「計画→レビュー→Build」の方が品質が安定。

## 推奨ワークフロー（社内標準案）
1. **Planningモード起動**：曖昧な要望を投げ、AIに仕様ドラフトを書かせる（コードはまだ生成させない）。
2. **編集・追記**：要求・非機能・UIテーマ・依存・テスト観点を人が追記。アイコン/アセットは placeholder 指定でOK。
3. **Build実行**：ドラフトが十分なら Build。差分を確認し、必要ならプロンプトに変更点を追記して再Build。
4. **ローカル確認**：ブラウザプレビューでUXとアクセシビリティをチェック。軽微修正は直接編集、またはAgentに「このdiffを適用して」と指示。
5. **並列小タスク**：文言修正・軽微バグはバックグラウンドAgentに投げる。完了通知をSlack/一覧で受け取る。
6. **テスト/ログ確認**：エラーやconsoleログはAIに要約させ、原因候補とfix案をもらう。必要に応じて人手レビュー。

## プロンプトスニペット
- Planning開始: `Enable planning mode. Do not write code yet. Produce a markdown plan with requirements, UI, data, steps, tests.`
- 仕様更新: `Add constraints: use shadcn/ui, theme = XP-like retro, placeholder icon from /icons.`
- Build前チェック: `If plan is coherent, proceed to build. Otherwise ask clarifying questions first.`

## デザイナー向けTips
- 小さく始める：ライトな機能（電卓・簡易フォーム）で流れを掴む。Figmaから始めずCursor内で触る。
- テーマはAIに塗らせる：既存CSSトークンを指定し、"respect existing CSS variables" を明示。
- 恐れずエラーを投げる：`fix the build error shown in terminal` と丸投げし、解説も要求する。

## 注意点
- 並列Agentで同じファイルを触らせると衝突リスク。ワークツリー/ブランチを分けるか順次実行。
- アクセシビリティとテストは人が確認：AI生成後にコントラスト/フォーカス/ARIAを目視チェック。
- 大規模変更はPlanning→レビュー→Buildの3段階を守る（直接チャット一発生成は避ける）。

## 関連リンク
- ソース動画: https://www.youtube.com/watch?v=bdh8k6DyKxE
- 社内標準テンプレ: `_codex/common/templates/`（プロジェクト01–05）
