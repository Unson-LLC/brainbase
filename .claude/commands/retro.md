# レトロ：一週間を次の仕組み変更へ変える

## 目的

一週間の活動量を要約するのではなく、判断と実行が現実をどう変えたかを確認し、繰り返す詰まりを来週から変える仕組みへ変換する。

## 実行

1. 前回retro以降、確認できなければ直近7日を対象に、判断episode、実行、Outcome、Run Receiptを収集する。
2. 判断DAGをReplayし、過去判断との差分、誤っていた前提、繰り返した問題を分ける。
3. 最大3件の仕組み変更候補を作る。候補はStory／PR案であり、この実行では適用しない。
4. Personal KG登録候補とGraph昇格候補をレビュー対象として分ける。自動承認・自動昇格しない。
5. 下記の`week_view`を標準入力へ渡し、`node scripts/routines/run.mjs retro`を1回実行する。
6. 結論を先に示し、生成された`var/daily-ops-reports/retro-YYYY-MM-DD.html`を開ける状態にする。Run Receiptを受信側で読み戻す。

```json
{
  "week_view": {
    "since": "ISO-8601",
    "until": "ISO-8601",
    "headline": "来週から変える仕組み",
    "outcomes": [{ "summary": "今週、現実に起きた変化" }],
    "decision_replays": [{ "summary": "判断と結果のReplay" }],
    "changed_judgments": [{ "summary": "過去判断との違い" }],
    "mistaken_assumptions": [{ "summary": "誤っていた前提" }],
    "repeated_patterns": [{ "summary": "繰り返した問題" }],
    "system_changes": [{ "summary": "来週から変える仕組み", "applies_changes": false }],
    "references": [{ "source": "judgment_episode", "summary": "根拠" }],
    "source_coverage": [{ "source": "judgments", "status": "confirmed", "summary": "対象期間と件数" }],
    "evidence": []
  }
}
```

## 判定

- 確認済みの空集合だけを0件とする。
- 認証失敗、未接続、部分取得、timeoutは`partial`または`unavailable`として対象と影響を残す。
- `week_view`がない、または`source_coverage`に`confirmed`以外がある場合は成功扱いしない。
- Routineの起動、レポート生成、Receipt配達、受信側readbackを別々に報告する。

議事録の改善候補には、元のrun・判断ノード・DAG版・訂正と根拠を付ける。検索不足、判断定義の不足、未実行、生成誤りを区別し、断定できない原因は未確認とする。問題を閉じるには変更版と元の失敗例・別事例の再検証を必要とする。 手順と責任は [議事録の判断・訂正と記憶循環](../../docs/architecture/meeting-judgment-learning.md) を参照する。
