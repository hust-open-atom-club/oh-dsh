# Agent Note: Native workspace dropdowns

Status: implemented

English | [中文](2026-08-25-native-workspace-dropdowns.zh.md)

## Problem

Workspace facts used browser-native `<select>` controls for execution environment and branch selection. The platform popup rendered with a separate white surface that did not match the settings menu or the sidebar theme.

## Decision

Replace both selects with a local anchored dropdown. The trigger stays in the workspace fact row, the menu opens below it, and the selected option uses the shared workspace SVG check icon. The menu exposes `aria-haspopup="listbox"`, `aria-expanded`, and option selection state. Escape and outside pointer input close it; ArrowUp, ArrowDown, Enter, and Space provide keyboard selection. Branch checkout keeps its existing mutation path and disabled state.

## Alternatives considered

**Keep the browser-native select.** Rejected because its popup styling is controlled by the host platform and visibly diverges from the settings surface.

**Add a third-party select dependency.** Rejected because the sidebar already owns the required visual language and the interaction is small enough to keep local.

## Consequences

Execution environment and branch selection now share the settings menu's dark themed surface, spacing, selected state, and chevron behavior. Long branch names remain ellipsized in the trigger and the menu is scrollable when the branch list is long. The menu remains anchored to the fact row rather than opening as a detached dialog.

## Testing

`node --test tests/sidebar.test.ts tests/workspace-tools.test.ts tests/diff-stats.test.ts` passes with 13 tests. `corepack pnpm@11.21.0 run typecheck` passes. `git diff --check` passes.
