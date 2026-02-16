# QC Quality 2026-01-23

基準: x_account_profile.md の必須要素（簡易ヒューリスティック）
- 一人称/経験/具体性/感情/構造
- CTAは**任意**。無理なCTAは減点（forced_cta）

※ 2026-01-23の表は「CTA必須」時代の仮スコア。再スコアリングが必要。

| id | score | result | missing |
| --- | ---: | :---: | --- |
| x-20260123-001 | 90 | PASS | no_emotion |
| x-20260123-002 | 75 | FAIL | no_emotion, no_structure_marker |
| x-20260123-003 | 75 | FAIL | no_specific, no_emotion |
| x-20260123-004 | 75 | FAIL | no_specific, no_emotion |
| x-20260123-005 | 75 | FAIL | no_specific, no_emotion |
| x-20260123-006 | 60 | FAIL | no_specific, no_emotion, no_structure_marker |
| x-20260123-007 | 75 | FAIL | no_emotion, no_structure_marker |
| x-20260123-008 | 75 | FAIL | no_emotion, no_structure_marker |
| x-20260123-009 | 60 | FAIL | no_specific, no_emotion, no_structure_marker |
| x-20260123-010 | 75 | FAIL | no_emotion, no_structure_marker |
| x-20260123-011 | 75 | FAIL | no_emotion, no_structure_marker |
| x-20260123-012 | 90 | PASS | no_emotion |
| x-20260123-013 | 85 | PASS | no_structure_marker |
| x-20260123-014 | 75 | FAIL | no_emotion, no_structure_marker |
| x-20260123-015 | 75 | FAIL | no_emotion, no_structure_marker |
| x-20260123-016 | 75 | FAIL | no_emotion, no_structure_marker |
| x-20260123-017 | 75 | FAIL | no_emotion, no_structure_marker |
| x-20260123-018 | 55 | FAIL | no_experience, no_emotion, no_structure_marker |
| x-20260123-019 | 70 | FAIL | no_experience, no_emotion |
| x-20260123-020 | 75 | FAIL | no_emotion, no_structure_marker |
| x-20260123-021 | 55 | FAIL | no_experience, no_emotion, no_structure_marker |
| x-20260123-022 | 60 | FAIL | no_specific, no_emotion, no_structure_marker |
| x-20260123-023 | 40 | FAIL | no_experience, no_specific, no_emotion, no_structure_marker |
| x-20260123-024 | 55 | FAIL | no_experience, no_emotion, no_structure_marker |
| x-20260123-025 | 75 | FAIL | no_emotion, no_structure_marker |
| x-20260123-026 | 75 | FAIL | no_emotion, no_structure_marker |
| x-20260123-027 | 75 | FAIL | no_emotion, no_structure_marker |
| x-20260123-028 | 60 | FAIL | no_specific, no_emotion, no_structure_marker |
| x-20260123-029 | 75 | FAIL | no_emotion, no_structure_marker |
| x-20260123-030 | 75 | FAIL | no_emotion, no_structure_marker |

PASS: 3, FAIL: 27
