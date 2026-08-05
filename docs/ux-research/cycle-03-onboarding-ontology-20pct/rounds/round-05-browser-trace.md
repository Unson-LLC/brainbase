# 再評価ラウンド5 実画面操作記録

## 実行面

- MCP Inspector: v2.0.0
- 接続: `node dist/index.js` / STDIO / MCP 2025-11-25
- 対象ソース: `src/server.ts` SHA-256 `0dc06ac3956a2077a7afbd8bde5c1f372a167db7b0abb7085a05d6a6cb12eb70`
- 実行日時: 2026-08-05 17:35–17:39 JST
- 合成ペルソナ評価であり、実在利用者の発言・操作ではない。

## ONB-COMPLETE

1. `brainbase_onboarding_start` を実画面から実行。
   - 結果の先頭は `guide`、`nextAction`。
   - `guide.current`: 「利用する情報源を選びました。」
   - `nextAction.label`: 「準備できた情報源を取り込む」
   - 正式登録前であることと、候補を却下できることを表示。
2. `brainbase_onboarding_ingest` を実画面から実行。
   - `guide.current`: 「取り込んだ候補を確認する段階です。」
   - 登録されるのは確認済み候補だけで、確信がなければ却下できると表示。
3. `brainbase_onboarding_review`、`brainbase_onboarding_first_value` の record、review を順に実行。
4. 最終結果で以下を確認。
   - state: `first_value_answer_reviewed`
   - `guide.current`: 「最初の回答の評価まで完了しました。」
   - `guide.remaining`: 「ありません。」
   - `nextAction`: `null`

画面証拠: [オンボーディング完了](../screenshots/onboarding-complete.png)

## ONT-UNDERSTAND

1. `get_ontology` を実画面から実行。
2. 正式契約より前に以下が表示されることを確認。
   - 「まずここだけ読めば大丈夫です」から始まる案内。
   - 「新しい方針が旧方針を置き換えた」という日本語の業務例。
   - 種類、関係、必須条件、判断規則、変更履歴の5要素。
   - 影響確認、監査、新しい版での訂正方法。
3. その後に Ontology 1.0.0 の正式契約が続くことを確認。

画面証拠: [日本語オントロジーガイド](../screenshots/ontology-guide-ja.png)

## 証拠境界

- 上記は共通タスクの実画面操作証拠である。
- 支援技術指定なしの10ペルソナには、各人の性格・経験・時間圧・中断・確認傾向を個別に適用して再評価した。
- `screen_reader` と `reduced_motion` の22ペルソナは、該当環境の実操作証拠がないため `not_collected` のままとした。
- `voice_and_keyboard` は選択可能な入力環境であり、今回は同じペルソナが利用可能なキーボード経路で必須タスクを完了した。音声固有の品質は別途未検証である。
