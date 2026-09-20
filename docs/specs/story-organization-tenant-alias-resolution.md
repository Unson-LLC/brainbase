# 認証組織と正規テナントの解決 Spec

`resolve_active_tenant_for_organization(text)`は、active tenantに属する`tenant_organizations`を対象に、入力をcanonical `organization_id`または`organization_payload.graph_organization_id`と照合する。

候補が正確に1件のときだけ、その`tenant_id`と入力された組織IDを返す。0件または2件以上では0行を返す。これによりJWTのGraph組織IDを保持したままtenant scopeを補完し、曖昧なaliasを任意のtenantへ結び付けない。

