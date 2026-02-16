# QC Quality 2026-01-23 v2

ヒューリスティック採点。鬼編集長の代替ではなく、
一貫性と具体性の最低ラインを機械的にチェックするための暫定。

採点ルール:
- no_number: 数字がない
- no_proper_noun: 固有名詞がない
- no_process_marker: だから/理由/順番などの因果がない
- no_struggle: 失敗/迷い/詰まり等がない
- too_short: 2行以下

| id | score | result | missing |
| --- | ---: | :---: | --- |
| x-20260123-001 | 80 | PASS | no_number,no_proper_noun |
| x-20260123-002 | 55 | FAIL | no_number,no_proper_noun,no_first_person,no_process_marker |
| x-20260123-003 | 70 | FAIL | no_number,no_proper_noun,no_process_marker,no_struggle |
| x-20260123-004 | 85 | PASS | no_proper_noun,no_process_marker |
| x-20260123-005 | 100 | PASS | - |
| x-20260123-006 | 90 | PASS | no_process_marker,no_struggle |
| x-20260123-007 | 85 | PASS | no_proper_noun,no_struggle |
| x-20260123-008 | 80 | PASS | no_number,no_proper_noun |
| x-20260123-009 | 80 | PASS | no_number,no_proper_noun |
| x-20260123-010 | 75 | FAIL | no_number,no_proper_noun,no_process_marker |
| x-20260123-011 | 85 | PASS | no_proper_noun,no_struggle |
| x-20260123-012 | 100 | PASS | - |
| x-20260123-013 | 80 | PASS | no_proper_noun,no_process_marker,no_struggle |
| x-20260123-014 | 85 | PASS | no_number,no_process_marker |
| x-20260123-015 | 80 | PASS | no_number,no_proper_noun |
| x-20260123-016 | 65 | FAIL | no_proper_noun,no_first_person,no_process_marker |
| x-20260123-017 | 90 | PASS | no_process_marker,no_struggle |
| x-20260123-018 | 90 | PASS | no_process_marker,no_struggle |
| x-20260123-019 | 85 | PASS | no_proper_noun,no_process_marker |
| x-20260123-020 | 85 | PASS | no_proper_noun,no_process_marker |
| x-20260123-021 | 85 | PASS | no_proper_noun,no_process_marker |
| x-20260123-022 | 80 | PASS | no_number,no_proper_noun |
| x-20260123-023 | 90 | PASS | no_proper_noun |
| x-20260123-024 | 100 | PASS | - |
| x-20260123-025 | 80 | PASS | no_number,no_proper_noun |
| x-20260123-026 | 70 | FAIL | no_number,no_proper_noun,no_process_marker,no_struggle |
| x-20260123-027 | 70 | FAIL | no_number,no_proper_noun,no_process_marker,no_struggle |
| x-20260123-028 | 80 | PASS | no_number,no_proper_noun |
| x-20260123-029 | 75 | FAIL | no_number,no_proper_noun,no_struggle |
| x-20260123-030 | 90 | PASS | no_process_marker,no_struggle |