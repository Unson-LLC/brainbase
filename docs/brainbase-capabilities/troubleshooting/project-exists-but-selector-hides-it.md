# Troubleshooting: Project Exists But Selector Hides It

## Symptom

The project appears in `/api/config` or `/api/brainbase/projects`, but not in the Create Session project dropdown.

## Likely Causes

1. `archived:true`
2. `session_select:false`
3. `auth.access.projectCodes` does not include the project or an accepted alias
4. Browser auth payload is stale
5. Browser module cache has old `project-mapping.js`

## Checks

```bash
curl -s http://127.0.0.1:31013/api/config | jq '.projects.projects[] | {id, archived, session_select}'
```

Then check the user access payload:

```text
localStorage["brainbase.auth.access"]
```

If access is stale, logout/login or refresh auth.

## Known Alias Cases

- `techknight` -> `tech-knight`
- `ncom` -> `ncom-catalyst`
- `salestailor` -> `salestailor-app`
