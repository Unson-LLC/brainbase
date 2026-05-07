# Brainbase Command Center Component Spec

This spec is the implementation target for the command-center component replacement pass. The generated component sheet is the visual reference; this document converts it into measurable gates.

## Component Targets

| Component | Target |
| --- | --- |
| Session row | List row, 42-46px height, no emoji tile, no card shadow, small radius <= 6px |
| Active session | 2px cobalt left rail, subtle graphite fill, compact row height |
| Primary command | Compact cobalt button, <= 38px height, radius <= 6px |
| Drawer tabs | Tool-strip tabs, <= 52px height, active cobalt underline/fill |
| Timeline panel | Thin-line rows on the drawer surface, no nested section-card surface |
| Task filters | Toolbar-like control row, 31-34px controls, no rounded wrapper card |
| Task item | Table-like transparent row, not card stack; no radius, no drop shadow, 2px status rail |
| Badges | Small squared labels, mono text where useful, no large pills |

## Anti-Targets

- Emoji tiles in session rows.
- Rounded card stacks for task rows.
- Nested card wrappers inside drawer sections.
- Rounded tab/filter/list containers inside task sections.
- Red-brown filled overdue task cards.
- Large blue block buttons in the sidebar.
- Heavy card shadows or large radii on operational rows.
- Per-component spacing that breaks the 8px grid.
