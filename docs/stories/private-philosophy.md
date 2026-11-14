# Owner-only private Philosophy

A person can save a Philosophy in their selected project and read its immutable revisions, while other actors cannot read or mutate its body, history or related edges.

Acceptance: explicit payload.acl is private with one authenticated owner and empty readers/writers; exact version and project applicability are required; private ACL, owner, type and project cannot change. Stored current and historical ACLs govern readers. Existing Philosophy without an ACL and other Foundation types retain existing access. The privileged migration adds an independent contract without rewriting existing content or weakening Foundation v1. CI validates refusal cases and native PostgreSQL before production activation.
