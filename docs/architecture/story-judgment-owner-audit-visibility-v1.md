# Architecture: owner監査表示の確定境界

## 境界

`PostToolUse`はappend-onlyの実行証拠を作る中間境界であり、表示完了を確定しない。`Stop`だけが、全eventと実際の`last_assistant_message`を同時に検査できる完了境界である。

## 契約

1. UserPromptSubmitがepisodeと監査契約を固定する。
2. PostToolUseがResolver・Brainbase・一般tool・状態eventをjournalへ記録する。
3. モデルは最終回答の先頭へHost由来の完全な監査ブロックを置く。
4. Stopは行、順序、重複、未記録行、業務本文の保存を検査する。
5. 合格時だけ`owner_audit_source=assistant_answer`としてfinal receiptを確定する。

`systemMessage`は途中通知または修復指示であり、owner-visible evidenceではない。これにより「保存済み」と「画面に表示済み」を分離する。

## 失敗時

最初の修復可能なStopは正確な監査ブロックを返し、本文digestを保存して一度だけ差し戻す。activeな再Stopも不完全なら無限再生成せず`audit_degraded`へ収束するが、表示成功にはしない。
