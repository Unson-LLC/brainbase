# レトロ：週次の判断とOutcomeを見える化する

レトロの価値は実行回数ではなく、一週間の判断と実行をOutcomeへ結び直し、来週から変える仕組みを決められることにある。

正規入力は`.claude/commands/retro.md`の`week_view`である。Runnerは5指標だけで完了判定せず、週次確認結果がない場合を`partial`にする。HTMLとJSONを`var/daily-ops-reports/retro-YYYY-MM-DD.*`へ保存し、Receiptには`retro_week_view`参照を付ける。

仕組み変更、Personal KG登録、Graph昇格はすべてレビュー候補であり、レトロ自身は状態を変更しない。取得不能は0件へ変換せず、`source_coverage`に残す。
