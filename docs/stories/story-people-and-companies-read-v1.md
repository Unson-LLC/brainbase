---
story_id: story-people-and-companies-read-v1
title: Personal Web に、社内・社外・所属未確認で人を並べる「人と会社」を読み取り専用で足す
status: in_progress
created_at: 2026-10-12
implementation_started: true
owner_repository: brainbase
---

# Personal Web に、社内・社外・所属未確認で人を並べる「人と会社」を読み取り専用で足す

## 利用者成果

Personal Web を開く本人として、手元のGraphに登録した人が、どの会社の人か、社内か社外か所属が分からないかを一覧で確かめたい。いまは「プロジェクトと関係者」が参加と責任だけを出し、所属（`member_of`）はどの画面でも人の一覧に使われていない。

## 背景

- brainbase-project の前提台帳 D1（2026-10-11 採用）は、組織版の「メンバー」を「人と会社」と「メンバーと権限」に分けると決めた。D10 は「人と会社」を領域「情報と関係」に置く。
- 2026-10-12 の情報契約（brainbase-project `docs/architecture/people-and-companies-screen-contract.md`）は、S1 として OSS に読み取り `GET /api/graph/people-and-companies` と共通部品「人と会社」（読み取りのみ）を足すと決めた。
- 社内・社外は印として持たない。所属（`member_of`）と自社から画面が導く。自社が決まらないときは推測せず、「自社が未設定」と出して全員を所属未確認に置く（台帳P9）。
- OSS Personal の自社は、本人（Graph の owner）が `member_of` で属する会社。
- 2026-10-12 の改訂（台帳D1・ADR-024）で、顧客・協業先は種類（`customer`・`partner`）ではなく、会社（`org`）の属性（`orgType`・`lifecycle_stage`）と、会社からプロジェクトへの関係 `related_to`（役割つき）で表すことになった。提案中の案件は会社の `deals` に入る。OSS の関係の定義には `related_to` が無かった。

## 受入条件

- [ ] AC-01: `GET /api/graph/people-and-companies` は、人と会社の一覧、人ごとの有効な所属先の会社と関わるプロジェクトの数（うち責任）、会社ごとの有効な所属者とプロジェクト（`owned_by`）、自社のIDを返す。社内・社外の印は返さない。
- [ ] AC-02: 本人の有効な所属がちょうど1社なら自社はその会社。0社・2社以上・本人の記録が無いときは自社を null にし、理由（`owner_has_no_company`・`owner_has_several_companies`・`owner_not_found`）と候補を返す。
- [ ] AC-03: Graph v1・未登録・読み取り失敗は、ほかの Graph の読み取りと同じく 0件として返さない。人も会社も無いときだけ `absenceConfirmed: true`。
- [ ] AC-04: 画面「人と会社」は、人を「社内」「社外（会社ごと）」「所属未確認」の段に分けて並べる。自社が決まらないときは上部に「自社が未設定」と出し、全員を所属未確認に置く。会社は自社を先頭に並べる。終わった記録は一覧に出さず、件数だけを示す。
- [ ] AC-05: 行を選ぶと、右の欄に所属・関わるプロジェクト（会社なら所属する人・プロジェクト）を、有効期間と出典つきで出す（`GET /api/graph/entities/:id`）。直す操作はこの画面に置かず、「情報と関係」で直せると案内する。
- [ ] AC-06: Personal Web のメニューでは、領域「情報と関係」の見出しの下に「人と会社」を置く。
- [ ] AC-07: OSS の関係の定義に `related_to`（org→project、役割は関係の `role`）を足す。訂正で新しく張れる関係には足さない（書き込みは S3）。
- [ ] AC-08: 読み取りは、会社ごとに `related_to` で関わるプロジェクトと役割（`relatedProjects`）、記録どおりの `orgType`・`lifecycleStage`・`deals`、記録から導いた種類（`kinds`。顧客・協業先・提案中と、それぞれの出どころ）を返す。種類は、`orgType`・役割の `customer`／`partner`、`lifecycle_stage` の `customer`／`partner`／`opportunity`、`deals` の有無だけから出す。どれも無ければ種類は空で、推測しない。終わった関係と、終わったプロジェクトへの関係は数えない。
- [ ] AC-09: 会社の一覧は、自社を先頭に、種類のある会社、その他の順に並べ、種類の列を出す。会社を開くと、関わるプロジェクトを「この会社のプロジェクト」（`owned_by`）と「顧客・協業先として関わるプロジェクト」（`related_to`、役割つき）に分けて出し、記録があれば種類の出どころ・記録上の段階・提案中の案件を出す。

## 範囲外

- 人・会社を作る、所属を付け外す（S3）。
- 組織版への取り込み（S2）と名刺（S4）。
- 見える範囲（`role_min`）は手元のGraphに無い。この読み取りは手元の1つのGraphだけを読み、範囲を広げる経路を持たない。組織版の見える範囲は、S2 で組織版の読み取りが守る。

## 検証

- `tests/relation-registry.test.ts`、`tests/graph-web.test.ts`、`tests/graph-web-http.test.ts`、`tests/ui/people-and-companies-view.test.mjs`、`tests/ui/local-web-shell.test.mjs`、`tests/local-web-host.test.ts`。
