# CI runner backup

Story: UNS-523 (acceptance criteria in issue comments 23815, 23903 and 24056).

## Contract

`CI_RUNNER_BACKUP` is an Actions variable, not a secret. An organization variable
must be visible to each participating repository, including private repositories.
A repository variable overrides the organization value. Unset, `off`, and other
non-`on` values retain each job's existing labels. `on` selects `ubuntu-latest`
for Linux or `windows-latest` for Windows. Existing hosted-only jobs stay hosted.
The expression selects one runner for each existing job; no duplicate workflow,
parallel backup job, runner registration, or copied machine label is introduced.

If present, `PR_AUTOMERGE_RUNS_ON` takes priority over `CI_RUNNER_BACKUP`, including
when backup is on. It must contain valid JSON. Invalid JSON fails rather than
silently selecting a different runner. The existing Windows `runner=github-hosted`
manual input continues to select Windows hosted execution regardless of the variable.

Foundation ACL native evidence is excluded: it requires native PostgreSQL 16 at
`/usr/lib/postgresql/16/bin`. Its runner remains unchanged until that dependency
is explicitly prepared and validated on a hosted runner. PostgreSQL container
services, Docker requirements, immutable SHA checks, draft guards and existing
concurrency groups are unchanged for all other jobs.

## Enable, verify and return

1. Review and merge the relevant implementation PRs through their normal review
   boundary. These patches do not authorize merging or deployment. Merging some
   workflows can trigger releases or deployment; those decisions stay with the owner.
2. Record the existing organization/repository variable values and the exact runs
   affected. Before retrying, let already running attempts finish and ensure an old
   queued attempt cannot later run on the recovered machine. Cancel only an approved
   superseded attempt, and confirm it is terminal. Do not dispatch a second workflow
   as a backup of a still active attempt. Changing a variable alone does not migrate
   a queued job or cancel an existing attempt.
3. Set the repository variable temporarily to `on` for validation. Run the intended
   PR checks once on the immutable head containing the change. Record run URLs, SHA,
   attempts, selected runner OS/name and terminal conclusions. A draft-skipped job
   is not an executed test. Check Docker/PostgreSQL/browser prerequisites in those
   jobs, and check Actions billing/quota if hosted jobs never start. Restore the
   prior repository variable after validation, even on failure; restore `off` when
   no prior override existed. Do not alter existing secrets.
4. For a real outage, set `CI_RUNNER_BACKUP=on` at the intended organization or
   repository scope, after draining the superseded attempts as above. Retry only
   the intended run once. Preserve the existing concurrency controls.
5. After the primary runner is online, drain/resolve active backup attempts, set
   the effective value to `off` (or remove it only when no inherited `on` exists),
   and verify a subsequent intended run uses the original labels and is green.
   Account for repository overrides and `PR_AUTOMERGE_RUNS_ON` before claiming that
   the original runner is restored. Never register its dedicated label elsewhere.

## Verification boundary

Local YAML parsing, runner-selection truth tables and unchanged-workflow checks
are patch validation. They do not establish a green GitHub CI run, successful
deployment, hosted dependency availability, or a live primary-runner rollback.
Record those live checks separately before accepting the operational outcome.
