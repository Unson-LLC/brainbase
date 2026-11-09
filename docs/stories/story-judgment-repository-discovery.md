# Discover a real repository before binding a judgment request

A request from a projectless directory must keep `project_code` unset and
`runtime.project_binding` null. An empty or malformed ancestor `.git` entry
must not assign the ancestor's basename or bind its AGENTS.md instructions.

The Host asks Git for the working-tree root and ignores inherited `GIT_*`
variables so another command's repository selection cannot bind this request.
A Git executable must be available for automatic repository discovery. If Git
cannot identify a working tree, discovery returns no binding; an explicit
`BRAINBASE_JUDGMENT_PROJECT_CODE` still takes precedence.

Acceptance criteria:

- Empty `.git` directories/files and invalid gitfiles leave the request
  projectless and bind no repository instructions.
- Inherited Git directory/work-tree overrides do not select a different project.
- Real repositories and linked worktrees bind instructions from root to cwd.
- Explicit project configuration remains available outside a repository.

Verify: `npx vitest run tests/judgment-host.test.ts tests/judgment-autonomy.test.ts --maxWorkers=2`
and `npm run build`.

Consumer integration is a separate change after this owning-repository fix lands.
No consumer Host implementation or projectless assertion is relaxed here.
