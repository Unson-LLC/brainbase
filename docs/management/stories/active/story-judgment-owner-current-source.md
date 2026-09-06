# Story: 今回の判断根拠を監査表示に反映する

## 利用者の目的

「続けて」が今回のモデル解釈で確定し、過去の判断から安全条件だけを引き継いだ場合にも、監査で根拠不明と誤表示されず現在地を把握できる。

## 受け入れ条件

- AC1: classification_evidence が current_request と現在のturnを示す場合、classification_inherited_from_prior_turn が併存しても今回の依頼を判断参照に表示する。
- AC2: prior_receipt / prior_message の根拠は引き続き対応する過去の発話を参照し、見つからない場合は警告を維持する。
- AC3: 過去のreceiptに明示的な根拠種別がない場合の従来の継承動作を維持する。
- AC4: 判断契約、権限、監査の完了条件、既存episodeの不変性を変えない。

## 根拠と範囲

実会話でResolver成功・DB永続化・Stop completeを確認したが、current_requestの根拠と継承理由が併存すると表示がprior_turn_unavailableになった。ownerEvidenceSourceの参照選択と回帰テストだけを修正する。

Spec: `docs/specs/judgment-owner-current-source.md`
