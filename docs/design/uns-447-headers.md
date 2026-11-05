# UNS-447 / UR-008: page headers

Daily users move between project, task, calendar, knowledge and organization screens. Titles should identify the current page consistently without pushing the working content down.

Use the existing title-only workspaceTopbar direction (20px / 28px, weight 600), as specified in docs/specs/oss-common-ui-spec.md and the existing --bb-page-title-* tokens. The earlier issue inventory proposed 32–44px before checking the current shared topbar. That proposal would contradict the subsequently approved common UI contract. Keep the token values unchanged. A new hero design or per-page title sizes would add inconsistency and are excluded.

No palette, font-family, dependencies, API, authorization, data writes, or tenant defaults change. Keep loading, error, source, permission and historical-data warnings visible. Immersive world pages keep the existing no-topbar exception. Standalone page headers use h1; hosts with a topbar suppress repeated titles while preserving page actions and notices, as required by the existing composition contract.

Long (over 60 characters) or multiple-sentence workspace leads move in full to the existing workspaceHelp component, opened by a question-mark button. Short leads remain visible. Legacy objective explanations use the same existing help component. Screen and section headings inside drawers, panels and rails keep their existing sizes.

Organization pages consume the published exact-pinned OSS package. The OSS changes need normal review and a later approved package release before production consumption; this task does not publish or deploy. Local cross-repository validation mounts the changed OSS files only for fixture verification.
