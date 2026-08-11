# OpenRyoko Phase 1 pilot task catalog

## Boundary

This catalog defines the only business task types in the first two-week
OpenRyoko pilot. The node remains one persona, one worker, one Unson Slack
channel, one allowed driver, and `draft_only`.

Every run must:

- begin from an explicit Slack mention in the pilot channel;
- identify facts, inference, and unavailable evidence separately;
- use Graph SSOT as the authority for organizational facts;
- return a draft or report only to the originating pilot thread;
- avoid Graph writes, arbitrary Slack sends, email, deploy, purchase, and other
  external mutations;
- end with a terminal Run Receipt;
- record missing evidence as `未確認`, never zero or success.

## P1: Graph-backed internal research

**Example request:** “Graphを参照して、この顧客との最近の決定事項と未解決事項を
調べ、根拠付きでまとめて。”

**Why first:** read-only, frequently useful, and its factual accuracy can be
checked against a canonical source.

**Required output:**

- concise answer to the research question;
- Graph entities or source references used;
- facts, inference, and `未確認` separated;
- conflicts or stale-looking facts surfaced;
- no write-back.

**Completion:** the requested scope is answered and every material factual
claim has a reference or is explicitly marked `未確認`.

**Human evaluation:** accept, edit, or reject based on factual correctness,
coverage, and whether the evidence supports the conclusion.

## P2: Decision-preparation memo

**Example request:** “この選択について、Graphの現在方針を踏まえて選択肢、判断軸、
リスク、推奨案を1ページで作って。”

**Why first:** it tests reasoning quality while keeping the actual decision and
execution with a human.

**Required output:**

- decision to be made and explicit non-goals;
- two or three viable options;
- evaluation criteria and trade-offs;
- recommendation with evidence boundary;
- reversible next action;
- no claim that the decision was approved or executed.

**Completion:** a human can make the decision without asking the agent to
reconstruct missing options, evidence, or risks.

**Human evaluation:** accept, edit, reject, or escalate. The disposition must
eventually map to Decision Events rather than a second result ledger.

## P3: Meeting or Slack follow-up structuring

**Example request:** “このスレッドの内容から、決定事項、未決事項、アクション候補、
Graph更新候補を整理して。更新はしないで。”

**Why first:** it is frequent, bounded to user-supplied context, and produces
structured candidates without mutating the SSOT.

**Required output:**

- confirmed decisions;
- unresolved questions;
- action candidates with proposed owner and due date only when supported;
- Graph update candidates with source evidence;
- ambiguous ownership or dates marked `未確認`;
- no task creation, Graph write, notification, or approval resolution.

**Completion:** each item is classified and traceable to the supplied thread or
an allowed Graph reference.

**Human evaluation:** accept, edit, or reject each candidate group. An accepted
candidate still follows the normal Brainbase curation or task workflow.

## Evaluation protocol

Run at least five real tasks of each type before changing the catalog. Record:

- terminal Run Receipt;
- completed or not completed;
- number of human interventions;
- accepted, edited, rejected, or unobserved;
- rate-limit occurrence and redacted failure category;
- evidence reference.

Review after week one, then make the Phase 1 decision after two weeks. Do not
promote a task type beyond `draft_only` unless:

- completion is at least 90%;
- proposal adoption is at least 80%;
- no material information leak or unauthorized mutation occurred;
- factual errors and human interventions show a decreasing trend;
- receipt coverage is complete;
- unavailable evaluation data remains `未確認`.

The first expansion candidate is `approval_required` for one proven task type.
External messaging and Graph decision writes remain excluded even if the
aggregate thresholds are met.
