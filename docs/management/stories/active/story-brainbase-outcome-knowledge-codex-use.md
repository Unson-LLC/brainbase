# 登録した判断をCodexの回答で根拠付きで使える

- Story ID: `story-brainbase-outcome-knowledge-codex-use`
- 状態: 完了（VibePro archived・2026-09-18）
- 利用者: Codex利用者
- 実現したいこと: 質問の場面に合うチームの判断を回答に反映する
- 成果: 質問の場面に合うチームの判断を回答に反映することで、本人にしか決められない判断へ集中できる。
- 実装担当領域: Brainbase MCP・judgment/knowledge resolver / Codex Host契約
- 依存ストーリー: `story-brainbase-outcome-knowledge-canonical-save`, `story-brainbase-outcome-knowledge-lifecycle`
- 位置づけ: [全体計画](../../brainbase-outcome-stories.md)

## 受け入れ条件

- AC-1: 質問からBrainbase MCPで参照先を解決し、実本文を取得する。プロジェクト・主体の権限・有効期間・適用条件で絞り込む。
- AC-2: 利用した判断のID・版・出典を追跡できる。参照先解決だけを本文取得や回答への採用とみなさない。
- AC-3: 根拠不足・競合・取得失敗を回答に伝える。登録されている全判断が毎回使われるとは保証しない。
- AC-4: UIで登録した判断が実MCP経由の質問で取得され、他プロジェクトや権限外の質問では漏れないことを通しで検証する。

## 共通の受け入れ条件

- UIは合意した知識一覧・入力と確認パネル・質問テスト・委任編集・実行詳細の流れを使う。状態と次の操作を対象の近くに置く。
- キーボード操作、フォーカス、ラベル、長文、空状態、読み込み、再試行、権限不足を扱い、保存失敗で入力を失わない。
- tenant・project・actor境界をサーバーで検証し、unknownを空・ゼロ・成功に置き換えない。
- 実装時に該当ACの正常系と境界・失敗系を検証し、UI→API→正本または実行先のreadbackまで確認する。検証結果と本番外部作用の未実施境界は [Outcome 13 完了記録](../../outcome-13-closeout.md) に記録する。
