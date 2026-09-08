# 開始失敗の診断と限定復旧

## 契約

`UserPromptSubmit`の例外は`brainbase-judgment-start-failure-v1`として記録する。
診断はepisodeのSQLite transactionに依存せず、journal配下の別ディレクトリへ保存する。
session/turnはハッシュだけ、原因は許可した名前・コード・段階のみとし、raw message、stack、入力本文、URL、認証情報を保存しない。
保存に失敗した場合は安全な診断だけをstderrへ返し、保存済みと報告しない。

既定の開始停止契約は維持する。Brainbase限定試験では明示的な
`BRAINBASE_JUDGMENT_START_FAILURE_MODE=diagnostic_continue`と
`BRAINBASE_JUDGMENT_CANARY_CWD=<対象checkoutの絶対パス>`を用いる。
Hostから受け取るcwdが対象と一致する場合だけ説明継続を適用する。
開始失敗でも説明を生成できるが、完全監査receiptや操作許可は作らない。
同時にPreToolUseの未開始turn防止を設置し、契約開始を確認できないturnのtool実行を拒否する。
失敗診断の保存不能も許可に変えない。正常に開始した別turnを失敗扱いしない。
Codex App委任で開始Hookが発火しなかった場合は、既存Stop処理が復元した
`stop_delegation_recovery` / `post_generation_recovery`の組と正本入力の一致を
確認できればPreToolUseの開始確認を満たす。未復元・診断markerあり・不整合は拒否を維持する。
この開始確認は操作権限の追加ではなく、先行toolの監査欠落も解消済みにしない。

Stopの警告は確認できた監査失敗だけを記述する。新規task作成、再起動、再承認を原因確認なしで要求しない。
Stopの説明専用分岐は同turnの失敗診断が存在する場合か読取不能の場合だけにする。
診断がない孤立Stopは既存の有限修復と監査失敗記録を維持する。
保存失敗後にjournalが回復して診断が見つからない場合も、既存の有限修復を使う。

## 検証・反映境界

1. ローカルの偽Hostと隔離journalで実エントリーポイントを実行する。
2. 通信拒否、タイムアウト、不正JSON/receipt、書込失敗、正常開始を確認する。
3. 診断継続とPreToolUse拒否を組み合わせて確認する。監査失敗は成功件数に含めない。
4. Brainbase限定の記録試験、続いて通常lifecycleを確認する。実回答と保存証跡を照合する。
5. グローバル展開はこの変更の自動処理対象外。利用者の判断を待つ。

記録試験は`BRAINBASE_JUDGMENT_HOOK_MODE=record_only`で別の軽量入口へ分岐する。
本文・tool入力・パスは保存せず、event名、必須fieldの有無、identityのハッシュ、Nodeのversionだけを記録する。
通信、SQLite、episode作成、tool許可、Stop差し戻しは行わない。成功でも監査は`not_evaluated`。
保存不能や不正入力は安全なstderr診断を残すが、会話を止めない。

設定確認は、無効化済みglobal定義と有効なproject定義の併存を二重実行としない。
有効な定義が複数ある場合は従来どおり拒否する。`record_only`が有効な場合は
`observation_only` / `ready=false`を返し、通常監査の開始準備完了と混同しない。
別app-serverの設定確認は、既存会話へ読み込み済みである証拠ではない。
説明継続モードでは、同じ入口コマンドのPreToolUse guardも有効・信頼済み・全tool対象で
あることを設定確認の必須条件にする。guardなしでlifecycleだけを準備完了としない。

Graphifyは本worktreeにグラフがなく影響範囲はunknown。Host呼出し経路と既存unit/integrationを直接確認して補う。

## CIと戻し方

既存の`judgment-value-proof-consumer.yml`で対象差分のPRとdevelop push時に
`test:judgment-start-recovery`を実行する。権限はcontents:read、20分上限を維持し、
配備・secret・共有runtimeの操作は追加しない。ローカル合格をGitHub CIの実行済みとは扱わない。

配備前にBrainbaseの`.codex/hooks.json`を個別に退避する。記録試験は同ファイルの
judgment lifecycleコマンドだけを差し替え、既存SessionStart/PreToolUseとglobal設定を維持する。
問題時はBrainbaseの対象HookをUIで無効化し、当該コマンドだけを退避内容へ戻す。
同時編集があればファイル全体を上書きしない。global Hookや共有runtimeの復旧操作は行わない。
