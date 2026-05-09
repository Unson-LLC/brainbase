# jj Working Copy Workflow

Use this before making, reviewing, or merging Brainbase code changes.

## Mental Model

jj is a notebook, not a staging area.

- `@` is the page currently open.
- `@-` is the previous page.
- `jj describe` writes a title on the current page.
- `jj new` opens a blank next page.
- `jj split` moves selected content into a separate page.
- `jj squash` pastes one page into another.
- `(no description set)` means the current page has no title yet.

## Start Of Task

Run:

```bash
jj status
jj diff --stat
git status --short --branch
```

Treat `jj status` as authoritative. If `@` is dirty before the task starts, classify those files before editing:

- Same intent: continue on the existing page.
- Different intent: split, describe, or ask before mixing changes.
- Unknown intent: do not call it "someone else's change"; report it as unclassified dirty state.

## After Editing

Run:

```bash
jj diff --stat
jj diff <touched-path>
```

If the diff is one intent:

```bash
jj describe -m "<type>: <summary>"
```

If the diff contains mixed intents:

```bash
jj split <paths-for-one-intent>
```

Then describe the selected change.

## Before Merge Or Handoff

Run:

```bash
jj status
jj show @- --stat --no-pager
git status --short --branch
```

Do not say a change is merged just because it has a jj description. A described jj commit is local until the relevant bookmark, PR, or develop/main integration is completed.

If `git status` still shows a file from the described jj commit, explain that git is showing the checkout/ref view, while jj has already separated the local change into `@-`.
