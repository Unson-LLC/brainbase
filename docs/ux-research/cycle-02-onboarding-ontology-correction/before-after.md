# Before and after

| Finding | Before | After | Verification |
|---|---|---|---|
| CUX-001 first-value form | Actual MCP Inspector showed only `Execute Tool`; no fields rendered | Seven documented fields render and the two-call flow completes | `after-first-value-form.png`, `after-completion.png` |
| CUX-002 next action | Raw state and IDs were returned without the next tool | Every onboarding result returns `runId` and state-specific `nextAction` | `after-next-action.png`, intent tests |
| CUX-003 recovery | Error stopped at “inferred candidates cannot be approved” | Error tells the user to verify the source and choose human-confirmed `edit` or `reject` | `after-recovery-error.png`, intent tests |
| CUX-004 ontology model | Full contract appeared before any explanation | A one-sentence model, five parts, examples, and next tools appear first | `after-ontology-guide.png`, intent tests |
| CUX-005 retained host fields | Switching record to review resent prior fields and strict validation failed | Irrelevant retained fields are accepted then removed before runtime execution | `after-completion.png`, intent tests |
