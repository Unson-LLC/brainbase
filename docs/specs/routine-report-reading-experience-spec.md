# Spec: 日次ルーティンレポートの読みやすさ

- INV-1: `ohayo`、`oyasumi`、`retro` の正規化結果は操作アクションを持たない。
- INV-2: 項目の見出しは `title`、`name`、`subject`、本文の順で決め、欠損時にも `Untitled`を生成しない。
- INV-3: 本文を見出しへ昇格した場合、同じ文を本文へ重複表示しない。
- INV-4: おはようの旧 `priorityTasks` は状態に応じた4区分へ正規化する。
- INV-5: HTML生成後に不要な操作欄、`Untitled`、空の操作用スクリプトを含めない。
- INV-6: リンクの安全化とHTMLエスケープは既存契約を維持する。

検証: `tests/unit/daily-ops-report.test.js` と3モードのHTML再生成後の文字列検査。
