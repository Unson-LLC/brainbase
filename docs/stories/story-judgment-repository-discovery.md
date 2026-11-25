# Discover a real repository before binding a judgment request

A request from a projectless directory must keep `project_code` unset and
`runtime.project_binding` null. An empty or malformed ancestor `.git` entry
must not assign the ancestor's basename or bind its AGENTS.md instructions.

The Host asks Git for the working-tree root and ignores inherited `GIT_*`
variables so another command's repository selection cannot bind this request.
A Git executable must be available for automatic repository discovery. If Git
cannot identify a working tree, discovery returns no binding; an explicit
`BRAINBASE_JUDGMENT_PROJECT_CODE` still takes precedence.

Discovery runs once per request, with a two-second timeout shared by project
and instruction binding. Git's ownership checks remain enabled: repositories
owned by another user stay projectless unless the owner has explicitly trusted
them in Git's protected `safe.directory` configuration. The Host never sets
`safe.directory=*`. Ownership rejection and timeout emit a structured stderr
diagnostic (`judgment_repository_discovery_failed`, with reason
`unsafe_repository` or `timeout`) so the missing binding can be explained.

Acceptance criteria:

- Empty `.git` directories/files and invalid gitfiles leave the request
  projectless and bind no repository instructions.
- Inherited Git directory/work-tree overrides do not select a different project.
- Real repositories and linked worktrees bind instructions from root to cwd.
- Explicit project configuration remains available outside a repository.
- Ownership rejection preserves the projectless result and emits a diagnostic.
- A stalled Git process times out, emits a diagnostic, and leaves no bindings.
- Each request invokes Git only once for both project and instruction binding.
- Linked-worktree test setup ignores inherited commit signing settings.

Verify: `npx vitest run tests/judgment-host.test.ts tests/judgment-autonomy.test.ts --maxWorkers=2`
and `npm run build`.

Consumer integration is a separate change after this owning-repository fix lands.
No consumer Host implementation or projectless assertion is relaxed here.
