# Shared browser UI

The browser modules in this directory accept a document, DOM roots and host
callbacks. Load `brainbase-tokens.css`, `workspace-kit.css` and the feature's
stylesheet. The host owns authorization, navigation and persistence. See the
[common UI specification](../docs/specs/oss-common-ui-spec.md) for component
appearance, accessibility and compatibility contracts.

## Imported records

`createOwnShareView` from `@unson/brainbase-mcp/ui/graph-own-share` uses the
existing read-only snapshot routes. By default it renders its searchable list
and inline selected-record details. A host that already renders the same list
can explicitly select `presentation: 'details-only'` and consume `onState` or
`controller.state.search` for the original results and completeness information.

Open a record with
`controller.openEntity(id, { opener, expectedHandover: { graphId, digest } })`.
Use the snapshot identity from the row that was activated. The shared drawer
checks the response identity and preserves record details, judgment rationale
and relation navigation. `opener` accepts a Node or a function returning the
current trigger. Call `controller.destroy()` when leaving the host view; late
responses cannot revive the drawer. This presentation does not add candidate
search, writes, or an organization mapping model to the shared UI.

`workspaceStepBand` and `workspaceCandidateChoices` from
`@unson/brainbase-mcp/ui/workspace-kit` display supplied steps and candidate
choices. They return DOM nodes with an `update(value)` method. Candidate choices
also accept `update(value, { disabled })`. Their callbacks report intent; hosts
confirm a choice and update the controlled display. Completion, legal candidates,
counts and permissions are never inferred by these components.
