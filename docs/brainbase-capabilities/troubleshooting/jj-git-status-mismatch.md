# jj And git Status Look Different

## Symptom

`jj show @-` shows a clean described local change, but `git status --short` still shows the same file as modified.

## Cause

Brainbase uses jj as the primary workflow. jj records local work as changes in its own commit graph. git status reports the worktree relative to the current git ref, so a jj-described local change can still appear dirty from git's point of view until refs/bookmarks are moved or the change is integrated.

## What To Check

```bash
jj status
jj show @- --stat --no-pager
jj diff --stat
git status --short --branch
```

Use `jj status` to decide whether the current working-copy page `@` has unclassified changes. Use `git status` as a compatibility signal for what a git-only tool will see.

## Recovery

- If `@-` is the intended change, keep it as the described local commit.
- If `@` still has unrelated files, classify them before merge or handoff.
- If a change must be removed, use jj operations on the correct change, not broad git reset commands.
- If merge is requested, first ensure the target bookmark/PR flow is clear; do not equate `jj describe` with merge.
