# Lookup NocoDB Issue

1. Extract `FRD-*`, `REQ-*`, and `BUG-*` IDs from the prompt.
2. Query the canonical NocoDB table or the Graph mirror if available.
3. Validate that the returned record ID exactly matches the requested ID.
4. Use the canonical title, status, acceptance criteria, and linked decisions as the working scope.
5. If lookup is unavailable, state that explicitly and use only repo evidence.
