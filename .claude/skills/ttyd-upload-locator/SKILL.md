---
name: ttyd-upload-locator
description: Quickly locate files (images/screenshots) uploaded via ttyd in the brainbase environment and attach them for viewing.
metadata:
  short-description: Find ttyd-uploaded files fast
---

# ttyd Upload Locator

Use this skill when the user says they attached a file via ttyd but the file path is unknown.

## Quick start

1) Check the primary upload folder:
```
ls -lt /Users/ksato/workspace/projects/brainbase/uploads | head -n 20
```

2) If the filename is known, search directly:
```
find /Users/ksato/workspace/projects/brainbase/uploads -name '<filename>'
```

3) If not found, search broadly within the workspace:
```
find /Users/ksato/workspace -maxdepth 6 -name '<filename-or-pattern>'
```

4) Once found, attach it for inspection (e.g., `functions.view_image`).

## Notes
- ttyd attachments observed in this environment land in:
  `/Users/ksato/workspace/projects/brainbase/uploads`
- Prefer listing newest files first (`ls -lt`) when the exact name is unknown.
- If still not found, ask the user to re-upload or provide a local path.
