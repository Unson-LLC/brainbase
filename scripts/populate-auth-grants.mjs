// Compatibility entrypoint. The original implementation merged privileges by
// person across Slack workspaces and granted every CEO a global project list.
// Keep callers working, but route all writes through the organization-scoped
// sync that validates each project against projects.organization_id.
await import('./info-ssot-sync-slack-auth.js').then(({ main }) => main());
