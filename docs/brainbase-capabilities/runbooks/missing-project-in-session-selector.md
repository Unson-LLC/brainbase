# Runbook: Project Missing From Session Selector

Use this when a project exists somewhere in Brainbase but does not appear in the Create Session dropdown.

## 1. Confirm The Project Exists In Config

```bash
curl -s http://127.0.0.1:31013/api/config | jq '.projects.projects[] | select(.id=="tech-knight")'
```

If the project is missing here, fix `/Users/ksato/workspace/config.yml` or config loading first.

## 2. Confirm Active Catalog Visibility

```bash
curl -s http://127.0.0.1:31013/api/brainbase/projects \
  -H 'Authorization: Bearer <token>' \
  | jq 'if .source.status != "loaded" then error("project catalog is not loaded") else .projects[] | select(.id=="tech-knight") end'
```

If `source.status` is not `loaded`, treat visibility as unconfirmed and restore Registry/auth connectivity first. If the project is present here but not in the selector, the problem is not the dashboard project API.

## 3. Check Selector Rules

The selector uses:

- `config.projects.projects`
- `archived`
- `session_select`
- `auth.access.projectCodes`
- `public/modules/project-mapping.js`

Run the selector logic against the relevant project codes.

```bash
node --input-type=module - <<'NODE'
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input?.url;
  if (typeof url === 'string' && url.startsWith('/')) {
    return originalFetch(`http://127.0.0.1:31013${url}`, init);
  }
  return originalFetch(input, init);
};
const mod = await import('./public/modules/project-mapping.js');
await mod.projectMappingReady;
console.log(mod.getSessionSelectableProjects(['techknight']));
NODE
```

## 4. Check auth_grants

Query `auth_grants.project_codes` for the user.

Known alias cases:

- `techknight` should match `tech-knight`
- `ncom` should match `ncom-catalyst`
- `salestailor` should match `salestailor-app`

## 5. Refresh Browser Auth

If DB is correct but the browser still hides the project, refresh auth:

- logout and login again, or
- trigger auth refresh, or
- clear stale `brainbase.auth.access` localStorage entry and login again.
