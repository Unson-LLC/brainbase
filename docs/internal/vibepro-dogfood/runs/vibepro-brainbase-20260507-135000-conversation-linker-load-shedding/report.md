# VibePro Brainbase Evaluation Report: ConversationLinker Load Shedding

## 評価分離

`diagnosis.json` は VibePro の判断、`outcome.json` は観測事実から生成した事後事実、`labels.json` は両者の照合結果として扱う。

## 指標

- 本番化ギャップ捕捉率: 1
- 本番化ギャップ的中率: 1
- ゲート違反流出率: 0

## 判定

評価分離ループは採点まで完了した。runtime server反映後のLoki再測定は残リスクとして次runに送る。
