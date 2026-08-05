# App walkthrough pack

## North star

初心者がJSON契約を推測せず、未認可・推測・完了状態を誤認せずに、10分以内で検証可能な最初の回答と意味を保持したOntologyへ到達できる。

## Surface

対象はOSS版BrainbaseのMCP stdio/CLI操作面。ブラウザUIは存在しないため、source inspectionとautomated testだけを採用する。

## Fixed tasks

- ONB-START: authorization待ちを空やreadyにせず、選択sourceとrunIdを特定する。完了条件: runIdとselectedSourceIdsが明示され、待機状態が保持される。
- ONB-REVIEW: inferred候補の直接承認を試し、安全な回復経路へ進む。完了条件: 直接承認が拒否され、人が確認したeditだけが昇格する。
- ONT-DECISION: Decisionを昇格し、現在有効な判断を推論する。完了条件: topic、supersedes、effectiveAtが保持され、旧Decisionが置換済みになる。
- ONB-RECOVERY: MCP契約を推測せず最初の価値まで完了する。完了条件: sourceの入れ子とactionsを使い、first_value_answer_reviewedへ到達する。

## Hard gates

- waiting/unavailable/error/unconfirmedを空やreadyに変換しない。
- inferred factを明示reviewなしに昇格しない。
- 未完了をfirst value完了と表示しない。
- Decisionのtopic、supersedes、effectiveAtを昇格時に失わない。

## Not collected

Browser、human observation、real device、支援技術、視覚アクセシビリティは未収集。
