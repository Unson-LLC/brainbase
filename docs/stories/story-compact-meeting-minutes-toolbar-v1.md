# Story: Compact meeting-minutes list controls

## Purpose and accepted direction

People reviewing meeting notes need to create, find and filter records without a tall block of controls. Use a compact single row with the existing controls and data contracts. Keep expanded presentation compatible for other hosts. A permanent filter form and a second popover around sorting were rejected because they add vertical space or an extra click.

## Scope and acceptance

- A reusable workspace-kit toolbar owns slots and disclosure/clear interaction. It does not own API requests, credentials, project authority or filtering state.
- The minutes host explicitly enables compact mode and omits its redundant introduction. Existing create authority and its reason remain accessible.
- Create/count stay left; text search, borderless filter and sort stay right. Search has a leading icon. The filter caret is part of its trigger; applied conditions use the same space for clear, without shifting adjacent buttons.
- Reuse current tokens, font and semantic error colors. No new framework, icon dependency, theme replacement or host CSS copy.
- Keep status below the toolbar, empty results inside the list, and detail loading inside the native drawer. Closing or leaving during a request must not reopen the drawer.
- Sorting changes order without changing card structure, including records with no scheduled date. Unknown/read failures stay distinct from empty records.

## Verification

Use synthetic fixtures for query/reset, host filters, updated ordering with undated meetings, keyboard disclosure, focus restoration, request races, failures/retry and disposal. Check desktop/mobile and reduced motion in a browser; preserve published-package composition and the original expanded mode.
