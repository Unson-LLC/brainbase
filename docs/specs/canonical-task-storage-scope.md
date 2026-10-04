# Canonical Task generic storage scope

Optional opaque storageScope comes from policy-normalized context, never task input. It is passed as an optional final argument to every repository method. Existing unscoped consumers retain argument shape and operation identities. Scoped operation namespaces, fingerprints, prepared-delete snapshots/results and audit bind scope. Completed scoped delete replay requires exact scope, current policy authorization and actor-bound operation identity. Scope is not an authority source; hosts must authenticate it and enforce repository predicates before count/pagination/search. CRUD stays in this kernel; host-specific organization grants and DB implementation stay outside.

Acceptance: policy scope survives all CRUD/recovery calls; one actor/key in two scopes is independent; completed replay with absent/foreign scope fails closed; current policy revocation prevents replay. Old unscoped fixture/parity behavior remains unchanged.
