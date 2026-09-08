# Troubleshooting: NocoDB Project Is Unmapped

## Symptom

A project appears in Brainbase but has `N/A` health or `healthStatus: unmapped`.

## Cause

The project exists in `config.projects.projects`, but does not define `nocodb.project_id`.

Example:

```text
salestailor-app exists as a project but has no NocoDB block.
```

## Expected Behavior

The project should still appear in active project APIs and selectors. Health fields should be null/N/A rather than causing the project to disappear.

## Verification

```bash
curl -s http://127.0.0.1:31013/api/brainbase/projects \
  -H 'Authorization: Bearer <token>' \
  | jq 'if .source.status != "loaded" then error("project catalog is not loaded") else .projects[] | select(.healthStatus=="unmapped") | .id end'
```

`source.status` が `loaded` でなければ、未対応プロジェクトが0件だとは判定せず、Registryまたは認証の復旧を先に行います。

## Fix

Only add a NocoDB mapping when the project truly has a NocoDB base/project. Do not invent a mapping just to make health data appear.
