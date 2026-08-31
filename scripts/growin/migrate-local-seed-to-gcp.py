#!/usr/bin/env python3
"""Upsert the verified local Growin Graph seed into the dedicated GCP API."""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request


DEFAULT_API_URL = "https://brainbase-api-lmc74punpa-an.a.run.app"
PROJECT_CODE = "growin"


def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode()


def service_token(secret: str) -> str:
    now = int(time.time())
    header = b64url(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    claims = {
        "typ": "service",
        "sub": "svc_growin_local_seed_migration",
        "personId": "svc_growin_local_seed_migration",
        "name": "Growin local seed migration",
        "role": "ceo",
        "level": 3,
        "projectCodes": [PROJECT_CODE, "brainbase"],
        "clearance": ["internal"],
        "employmentType": "internal_service",
        "organizationId": "org_growin",
        "iat": now,
        "exp": now + 900,
    }
    payload = b64url(json.dumps(claims, separators=(",", ":")).encode())
    signature = b64url(hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest())
    return f"bbsvc_{header}.{payload}.{signature}"


class GraphApi:
    def __init__(self, base_url: str, token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.session_id = f"growin-local-seed-{int(time.time())}"
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "X-Session-Id": self.session_id,
        }
        self.csrf_token: str | None = None

    def request(self, path: str, method: str = "GET", body: dict | None = None) -> dict:
        if method in {"POST", "PUT", "PATCH", "DELETE"} and not self.csrf_token:
            self.csrf_token = self.request("/api/csrf-token").get("token")
        data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        headers = dict(self.headers)
        if self.csrf_token and method in {"POST", "PUT", "PATCH", "DELETE"}:
            headers["X-CSRF-Token"] = self.csrf_token
        req = urllib.request.Request(self.base_url + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")
            raise RuntimeError(f"{method} {path} failed ({error.code}): {detail}") from error

    def entities(self) -> list[dict]:
        query = urllib.parse.urlencode({"project": PROJECT_CODE, "limit": 500})
        return self.request(f"/api/info/graph/entities?{query}").get("records", [])

    def edges(self) -> list[dict]:
        query = urllib.parse.urlencode({"project": PROJECT_CODE, "limit": 500})
        return self.request(f"/api/info/graph/edges?{query}").get("records", [])

    def upsert_entity(self, entity_id: str, entity_type: str, payload: dict) -> None:
        self.request(
            "/api/info/graph/entities",
            "POST",
            {
                "id": entity_id,
                "entityType": entity_type,
                "projectCode": PROJECT_CODE,
                "projectName": "Growin",
                "roleMin": "member",
                "sensitivity": "internal",
                "payload": payload,
            },
        )

    def upsert_edge(self, from_id: str, to_id: str, rel_type: str, note: str) -> None:
        self.request(
            "/api/info/graph/edges",
            "POST",
            {
                "fromId": from_id,
                "toId": to_id,
                "relType": rel_type,
                "projectCode": PROJECT_CODE,
                "projectName": "Growin",
                "roleMin": "member",
                "sensitivity": "internal",
                "payload": {"source": "Growin local verified seed", "note": note},
            },
        )


ID_OVERRIDES = {
    ("org", "growin"): "org_growin_partners",
    ("org", "growin_ax"): "org_growin_ax",
    ("project", "growin"): "project_growin_brainbase",
    ("app", "claude_code"): "product_claude_code",
}


def canonical_id(entity: dict) -> str:
    raw_id = entity["entity_id"]
    entity_type = entity["entity_type"]
    return ID_OVERRIDES.get((entity_type, raw_id), f"{entity_type}_{raw_id}")


def edge(from_id: str, to_id: str, relation: str, note: str) -> tuple[str, str, str, str]:
    return from_id, to_id, relation, note


def canonical_edges() -> list[tuple[str, str, str, str]]:
    project = "project_growin_brainbase"
    ax = "org_growin_ax"
    baao = "org_baao"
    edges = [
        edge("person_sano_tetsuya", ax, "member_of", "佐野 哲哉はAX推進室に所属"),
        edge("person_sano_tetsuya", project, "accountable_for", "Growin Brain全体の意思決定者"),
        edge("person_kawamura_tatsumi", ax, "member_of", "川村 達見はAX推進室に所属"),
        edge("person_kato_shintaro", ax, "member_of", "加藤 真太郎はAX推進室に所属"),
        edge("person_inoue_nozomi", ax, "member_of", "井上 希望はAX推進室に所属"),
        edge("person_yamamoto_rikiya", baao, "member_of", "山本 力弥はBAAO代表理事"),
        edge("person_sato_keigo", baao, "member_of", "佐藤 圭吾は本案件をBAAOとして担当"),
        edge("org_growin_partners", project, "owns", "Growinが専用Brainbase案件を所有・利用"),
        edge(baao, project, "related_to", "BAAOがGrowinから案件を受託"),
        edge("org_growin_partners", "app_growin_brainbase", "owns", "Growinが専用環境を所有・利用"),
        edge("product_brainbase_product", "org_unson", "belongs_to", "Brainbaseの提供元は合同会社雲孫"),
        edge(project, "app_growin_brainbase", "uses_app", "構築対象のGrowin専用Brainbase"),
        edge(project, "product_claude_code", "depends_on", "初期利用環境"),
        edge(project, "app_growin_brainbase_mcp", "uses_app", "専用MCP経由で利用"),
        edge("product_claude_code", "app_growin_brainbase_mcp", "depends_on", "Claude Codeから専用MCPへ接続"),
        edge("app_growin_brainbase_mcp", "app_growin_brainbase", "depends_on", "MCPはGrowin専用環境だけへ接続"),
        edge("philosophy_growin_operating_context", project, "governs", "Growin専用Graphの運用原則"),
        edge("raci_assignment_growin_raci", project, "belongs_to_project", "案件RACI"),
    ]
    for person in ("person_kawamura_tatsumi", "person_kato_shintaro", "person_inoue_nozomi", "person_yamamoto_rikiya", "person_sato_keigo"):
        edges.append(edge(person, project, "member_of", "Growin専用Brainbase構築・導入の担当者"))
    for decision in (
        "dec_initial_proposal_scope", "dec_45min_discussion_paper", "dec_text_before_infographic",
        "dec_proposal_as_test", "dec_dedicated_environment", "dec_claude_code_mcp",
    ):
        edges.append(edge(f"decision_{decision}", project, "belongs_to_project", "Growin案件の判断"))
        edges.append(edge(f"decision_{decision}", "person_sano_tetsuya", "owned_by", "判断者は佐野 哲哉"))
    for document in (
        "proposal_template", "src_proposals", "src_ax_minutes", "src_live_minutes", "src_discussion_paper",
        "src_gcp_config", "src_mcp_audit", "eval_proposal_priorities", "eval_responsibility", "eval_45min",
        "eval_pptx", "eval_isolation", "eval_mcp_authorization", "eval_mcp_audit",
    ):
        edges.append(edge(f"document_{document}", project, "belongs_to_project", "Growin案件の情報源または評価ケース"))
    for person in ("person_sano_tetsuya", "person_kawamura_tatsumi", "person_kato_shintaro", "person_inoue_nozomi"):
        edges.append(edge(person, "role_assignment_growin_initial_users", "holds_role", "Growin Brainbase初期利用者候補"))
    edges.append(edge("raci_assignment_growin_raci", "person_sano_tetsuya", "assigned_to", "Growin案件RACIの最終責任者"))
    return edges


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("seed")
    parser.add_argument("--api-url", default=os.environ.get("GROWIN_BRAINBASE_API_URL", DEFAULT_API_URL))
    args = parser.parse_args()
    secret = os.environ.get("BRAINBASE_SERVICE_TOKEN_SECRET")
    if not secret:
        raise SystemExit("BRAINBASE_SERVICE_TOKEN_SECRET is required")
    with open(args.seed, encoding="utf-8") as source:
        seed = json.load(source)
    if seed.get("tenant", {}).get("tenant_id") != PROJECT_CODE:
        raise SystemExit("Refusing to migrate a non-Growin seed")

    graph = GraphApi(args.api_url, service_token(secret))
    before_entities = graph.entities()
    before_edges = graph.edges()
    before_types = {record["id"]: record["entity_type"] for record in before_entities}
    source_relationships = seed.get("registers", {}).get("relationships", [])

    migrated_ids = []
    for entity in seed["entities"]:
        entity_id = canonical_id(entity)
        payload = dict(entity["payload"])
        payload.setdefault("display_name", payload.get("name") or payload.get("title"))
        payload["source_entity_id"] = entity["entity_id"]
        payload["source_schema_version"] = seed["schema_version"]
        if entity["entity_type"] == "project":
            payload["source_relationship_register"] = source_relationships
        target_type = entity["entity_type"]
        if entity["entity_id"] == "claude_code":
            target_type = "product"
            payload["source_entity_type"] = "app"
            payload["normalization_note"] = "Growinが所有しない外部製品のため、所有者を補完せずproductとして登録"
        if target_type == "app" and before_types.get(entity_id) != "app":
            graph.upsert_entity(entity_id, "product", {**payload, "migration_placeholder": True})
            graph.upsert_edge("org_growin_partners", entity_id, "owns", "Growin専用環境の運用所有者")
        if target_type == "decision" and payload.get("status") == "active" and before_types.get(entity_id) != "decision":
            graph.upsert_entity(entity_id, "decision", {**payload, "status": "draft", "migration_placeholder": True})
            graph.upsert_edge(entity_id, "project_growin_brainbase", "belongs_to_project", "Growin案件の判断")
            graph.upsert_edge(entity_id, "person_sano_tetsuya", "owned_by", "判断者は佐野 哲哉")
        graph.upsert_entity(entity_id, target_type, payload)
        migrated_ids.append(entity_id)

    philosophy_id = "philosophy_growin_operating_context"
    graph.upsert_entity(
        philosophy_id,
        "philosophy",
        {
            "philosophy_id": philosophy_id,
            "name": "Growin専用Brainbaseの情報分離・監査原則",
            "display_name": "Growin専用Brainbaseの情報分離・監査原則",
            "statement": seed["philosophy_context"],
            "priority": "core",
            "source_schema_version": seed["schema_version"],
        },
    )
    migrated_ids.append(philosophy_id)

    expected_edges = canonical_edges()
    for from_id, to_id, relation, note in expected_edges:
        graph.upsert_edge(from_id, to_id, relation, note)

    after_entities = graph.entities()
    after_edges = graph.edges()
    after_ids = {record["id"] for record in after_entities}
    missing_ids = sorted(set(migrated_ids) - after_ids)
    edge_keys = {(record["from_id"], record["to_id"], record["rel_type"]) for record in after_edges}
    missing_edges = sorted((a, b, c) for a, b, c, _ in expected_edges if (a, b, c) not in edge_keys)
    result = {
        "status": "ok" if not missing_ids and not missing_edges else "verification_failed",
        "source_entity_count": len(seed["entities"]),
        "source_relationship_count": len(source_relationships),
        "migrated_entity_count": len(migrated_ids),
        "canonical_edge_count": len(expected_edges),
        "before": {"entities": len(before_entities), "edges": len(before_edges)},
        "after": {"entities": len(after_entities), "edges": len(after_edges)},
        "missing_entity_ids": missing_ids,
        "missing_edges": missing_edges,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if result["status"] != "ok":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
