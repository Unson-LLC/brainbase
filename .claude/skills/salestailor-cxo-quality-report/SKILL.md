---
name: salestailor-cxo-quality-report
description: SalesTailor の CxO 会議向け品質レポートHTMLを週次更新・Vercelデプロイするときに使う。NocoDBのバグ/インシデント、GitHub merged PR、Slack/議事録の証跡をもとに、日付タブ付きの品質推移レポートを生成・更新する。
---

# SalesTailor CxO Quality Report

Use this skill to maintain the SalesTailor CxO quality report:

- Production URL: `https://salestailor-cxo-quality-report.vercel.app`
- Vercel scope: `sales-tailor`
- Vercel project: `salestailor-cxo-quality-report`
- Current source artifact: `docs/reports/2026-05-19-cxo-bug-incident-timeline.html`

## Related Skills

Use these as needed:

- `nocodb-salestailor`: NocoDB schema, select options, and bug/incident updates.
- `salestailor-weekly-kpi`: CxO KPI context and source priority.
- `brainbase-最新議事録や外部repo情報を読む前にpullする`: pull latest meeting/repo data before reading.
- `brainbase-mana-meetings-discovery`: find SalesTailor meeting minutes when location is unclear.

## Sources

Read all relevant current sources before updating the report.

- NocoDB SalesTailor bug table: `mq13l0ec25f9v23`
- NocoDB SalesTailor incident table: `mo3ayx6i2ybac4t`
- NocoDB project/base: `pqot58neiu3o1xo`
- GitHub repo: `Unson-LLC/salestailor`
- Local app repo: `/Users/ksato/workspace/projects/salestailor-app`
- Meeting/minutes repo: `/Users/ksato/workspace/projects/salestailor`
- Slack: SalesTailor workspace channels/DMs when status evidence is needed.

## Report Structure

Maintain the deployed static site as append-only weekly snapshots:

```text
/
  index.html
  reports/
    YYYY-MM-DD.html
  data/
    YYYY-MM-DD.json
```

Rules:

- `index.html` shows the latest report by default and has date tabs for past reports.
- `reports/YYYY-MM-DD.html` is a fixed snapshot for that week. Do not rewrite old snapshots except for correction notes.
- `data/YYYY-MM-DD.json` stores the raw normalized inputs used to generate that report.
- The date should be the CxO meeting/report date in JST.

## Weekly Workflow

1. Pull latest external/local repos before reading minutes or repo files.
2. Fetch NocoDB bug and incident records.
3. Fetch merged PRs from GitHub.
4. Search Slack and minutes for status evidence when a bug/incident state is ambiguous.
5. Normalize data into `data/YYYY-MM-DD.json`.
6. Generate `reports/YYYY-MM-DD.html`.
7. Update `index.html` date tabs and default latest view.
8. Validate HTML and JavaScript.
9. Deploy to Vercel production.
10. Verify the public URL returns HTTP 200 and the expected title.

## PR Classification

Classify merged PRs into these buckets:

| Bucket | Meaning |
| --- | --- |
| 新規/機能PR | `feat`, `STR-*`, `REQ-*`, explicit new feature/story work |
| バグfix PR | Existing behavior was broken: error, validation failure, data mismatch, missing task, regression, wrong output |
| 要件/仕様修正PR | Product behavior was intentionally changed: labels, visibility, availability, workflow, CTA/letter behavior, option changes |
| 変更安全性の改善 | Route contracts, service boundaries, query limits, VibePro/contract work, changes that reduce release accidents and rework |
| 保守/運用PR | docs, CI, deploy config, cleanup, tests that are not user-facing product fixes |

Biz wording:

- Say `変更安全性の改善`, not `VibePro品質ゲート`, unless talking to engineers.
- Explain it as: `開発速度を落とさずに、リリース事故と手戻りを減らすための品質投資`.

## Bug Curve Rules

The report must avoid showing all bugs as resolved on the cleanup/shelf date.

For each bug:

1. Created date: `発生日時` -> `CreatedAt` -> `登録日時`.
2. Resolved date for closed/resolved statuses:
   - If `修正完了日` is a cleanup date such as `2026-05-19` and the comment contains `Codex整理`, do not trust it first.
   - Prefer related PR merge date from `PR` or `進捗コメント`.
   - Then use the earliest date in `進捗コメント`.
   - Then use `修正完了日`.
   - Last fallback: `UpdatedAt`.
3. Active bug count per week = bugs created before week end and not resolved before week end.
4. Keep the bug chart right-axis upper bound at `50` unless the data exceeds it materially.

## Incident Curve Rules

For each incident:

1. Created date: `発生日時` -> `検知日時` -> `CreatedAt`.
2. Resolved date only for `✅ 収束` or `🏁 クローズ`:
   - `収束日時`
   - latest relevant date in `タイムライン`
   - `UpdatedAt`
3. Active incident count per week = incidents created before week end and not resolved before week end.
4. Show incident chart separately from PR/bug chart because the count range is much smaller.

## Required Visuals

The HTML should include:

- Summary metric cards.
- Main PR + bug timeline:
  - Stacked bars: 新規/機能, バグfix, 要件/仕様修正, 変更安全性の改善, 保守/運用.
  - Lines: 新規バグ, 収束扱いバグ, 未収束バグ残数.
  - Hover tooltip with weekly detail.
- Incident timeline:
  - Bars: 新規インシデント, 収束インシデント.
  - Line: 未収束インシデント残数.
  - Hover tooltip with weekly detail.
- Current bug status chart.
- Current incident status chart.
- Remaining important issues table.
- `グラフからの示唆`.
- `次に見るKPI`.

## Required Interpretation

Include these management interpretations, updated for the current data:

- Whether recent PR volume is product bug growth or quality investment.
- Whether bugs are growing, peaking, or converging.
- Whether incidents are lagging behind bug fixes.
- Whether the current phase is development, validation, or operational closure.

Default KPI recommendations:

- 未収束インシデント数
- 恒久対応中の平均滞留日数
- PRマージから本番確認までの日数
- S/Aインシデントの再発防止証跡完了率

## Validation

Run at minimum:

```bash
python3 - <<'PY'
from html.parser import HTMLParser
from pathlib import Path
HTMLParser().feed(Path('index.html').read_text())
print('html parse ok')
PY

node --check <(python3 - <<'PY'
from pathlib import Path
import re
s = Path('index.html').read_text()
print(re.search(r'<script>(.*)</script>', s, re.S).group(1))
PY
)
```

If using `zsh`, run the `node --check <(...)` validation through `bash`.

## Vercel Deploy

Deploy only after the user has approved public deployment or already asked to deploy.

```bash
vercel deploy <site-dir> --prod --yes --scope sales-tailor
curl -I -L https://salestailor-cxo-quality-report.vercel.app | head
curl -sL https://salestailor-cxo-quality-report.vercel.app | grep -o '<title>[^<]*</title>' | head -1
```

Guardrails:

- Confirm `vercel whoami` is `salestailor`.
- Confirm `vercel teams ls` shows active scope `sales-tailor`.
- Do not deploy into the existing `salestailor` production app.
- Use the dedicated report project `salestailor-cxo-quality-report`.
- If Vercel CLI hides a deploy failure, inspect via REST API per the Vercel failure skill.

