# Story: G0の権限必須承認を実行結果へ束縛する

Brainbase運用者として、会社権限が必要な外部実行の人承認を、Company Authorityの検証を通った場合だけ再開し、承認後に生成した結果から使用した承認receiptを追跡できるようにしたい。これにより、handoffやmarkerの欠落で権限確認を迂回せず、承認と実行結果を同じ経路として検証できる。

## 受け入れ条件

- [x] 外部実行が `company_authority_required=true` と宣言した人承認stepは、`company_authority_handoff` がなければ保存前に拒否する。
- [x] 権限必須stepは保存済みmarkerが欠落しても通常承認へ縮退せず、承認receiptを確認できなければpendingのまま実行しない。
- [x] 承認後のworkflow handlerが生成するoutputへ、承認receipt IDと元のhuman step IDを保存する。
- [x] 同じstepの再承認ではhandlerとoutputを重複生成しない。
- [x] receipt消費とstep承認を同じtransactionで確定し、途中失敗では両方をrollbackする。
- [x] 承認後の失敗・時間切れ・workflow lock競合runにもreceipt帰属を残し、汎用rerunによる権限迂回や副作用の無確認再実行を拒否する。
- [x] 権限を必須と宣言していない既存human stepの挙動を維持する。

## 完了範囲

このStoryは契約とローカル実行経路を修正する。`agent_report` は取り込んだ成果物の承認専用であり、承認後の業務実行を行わないため、G0の「承認後の実行成果物」には数えない。本番G0完了には、業務handlerを持つ権限必須経路で、保存結果と外部結果の読戻しを別途確認する。

- Spec: [docs/specs/story-g0-authority-bound-execution-spec.md](../../../specs/story-g0-authority-bound-execution-spec.md)
