# Spec: 現在の判断根拠と継承条件の区別

Story: `docs/management/stories/active/story-judgment-owner-current-source.md`

- owner表示の参照先はclassification_evidenceの明示的なsourceを優先する。
- source=current_request かつ source_turn_ids に今回のturn_idを含む場合は、今回のrequestを表示する。reconciliation_reasonsの継承理由は安全条件の引き継ぎも表すため、それだけで過去の発話へ切り替えない。
- source=prior_receipt / prior_message は従来のturn_id照合と不在時警告を維持する。
- 明示sourceのない互換receiptでは従来の継承理由による選択を維持する。
- この変更でResolver契約の分類・権限・完了ゲート・ジャーナルを変更しない。
- テストでは今回の根拠と継承理由の併存を再現し、現在の表示、真の過去参照、不在警告を検証する。
