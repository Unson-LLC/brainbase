# Brainbase Command Center Component Spec

This spec is the implementation target for the command-center component replacement pass. The generated component sheet and the approved terminal/task-panel mockup are the visual references; this document converts them into measurable gates.

## Visual References

- Component sheet: `docs/design/brainbase-command-center-component-sheet-2026-05-07.png`
- Approved app composition: `docs/design/brainbase-terminal-task-panel-approved-2026-05-07.png`

## Component Targets

| Component | Target |
| --- | --- |
| Session row | List row, 46-56px height, no emoji tile, no card shadow, small radius <= 6px |
| Active session | 2px cobalt left rail, subtle graphite fill, compact row height |
| Session icon | Leading lucide icon is always visible; no emoji tile |
| Primary command | Compact cobalt button, <= 38px height, radius <= 6px |
| Work context bar | Purposeful session context only; no duplicate navigation or mystery tool buttons |
| Drawer tabs | Tool-strip tabs, <= 58px height, active cobalt underline/fill |
| Timeline panel | Thin-line rows on the drawer surface, no nested section-card surface |
| Task panel layout | Timeline and Next Tasks visible together in the active task drawer |
| Task filters | Toolbar-like control row, 31-34px controls, no rounded wrapper card |
| Task item | Table-like transparent row, not card stack; no radius, no drop shadow, 2px status rail |
| Badges | Small squared labels, mono text where useful, no large pills |

## Anti-Targets

- Emoji tiles in session rows.
- Rounded card stacks for task rows.
- Nested card wrappers inside drawer sections.
- Rounded tab/filter/list containers inside task sections.
- Red-brown filled overdue task cards.
- Purpose-unclear top navigation controls.
- Timeline in the central terminal workspace.
- Timeline and Next Tasks as mutually exclusive right-panel views.
- Session rows with hidden leading icons.
- Large blue block buttons outside the primary new-session command.
- Heavy card shadows or large radii on operational rows.
- Per-component spacing that breaks the 8px grid.
