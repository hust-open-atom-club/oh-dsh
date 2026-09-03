# Agent Note: Scope Desktop chrome by surface and platform

Status: implemented

English | [中文](2026-08-26-platform-scoped-desktop-chrome.zh.md)

## Problem

The Desktop client used one surface-wide selector for window chrome that is
owned by different operating systems. Windows needs clearance for its
renderer-owned window actions, macOS needs a draggable area around the native
traffic lights, and Linux keeps a native frame. Applying the Windows toolbar
clearance to every Desktop platform moved the macOS panel controls away from
the top-right corner. Removing the shared drag declaration also left the
macOS `hiddenInset` window without a draggable region. Web must not inherit
any native-window geometry.

## Decision

The Desktop bridge platform is published as
`data-oh-dsh-desktop-platform` while the existing
`data-oh-dsh-desktop` marker continues to identify the surface. Platform
selectors own only native-window geometry:

- macOS reserves the 40px in-page titlebar row, keeps the panel toolbar 8px
  from the right edge, and mounts a drag-only
  island between the traffic lights and panel controls;
- Windows reserves the same row for its renderer menu and window actions and
  keeps the panel toolbar 154px from the right edge;
- Linux retains its native frame and the shared panel toolbar position, with
  no injected titlebar row or rounded inner frame; and
- Web does not load the Desktop bridge or chrome stylesheet and therefore
  retains the shared panel toolbar geometry.

The macOS drag island is a real DOM element instead of a pseudo-element so it
can own `-webkit-app-region: drag` independently of the decorative titlebar
background. On macOS and Windows, 28px buttons and 1px toolbar padding leave
4px above and below the outlined toolbar instead of joining its border to the
titlebar divider. The toolbar remains `no-drag`. Both the island and platform
marker are removed with the Desktop client effect.

## Alternatives considered

**Keep one selector for every Desktop platform** — a surface marker cannot
express native-frame differences, so a Windows clearance or macOS drag rule
will continue to leak into another operating system.

**Use frameless renderer chrome on macOS and Linux as well** — this replaces
native traffic lights and Linux window-manager chrome even though the defect
only requires platform-specific placement and dragging.

**Infer the platform from browser styling features** — feature detection does
not distinguish the supported window ownership models. The isolated Desktop
bridge already exposes the main process platform as an explicit contract.

## Consequences

The renderer now carries one additional platform marker and a macOS-only drag
element. In return, each shipped surface keeps one geometry owner: macOS and
Windows opt into custom titlebar spacing, Linux stays framed, and Web stays
outside native chrome. The fixed drag boundaries reserve space for current
traffic lights and panel controls, so changes to either control group must
update the regression contract.

## Testing

`tests/desktop-titlebar.test.ts` pins the Desktop/Web boundary and the macOS,
Windows, and Linux geometry branches. A packaged arm64 macOS application was
also inspected through its live renderer: the panel toolbar ended 8px from
the right edge, the drag island reported `-webkit-app-region: drag`, and a
pointer drag moved the native window by the requested 100px horizontally and
60px vertically.

## Related

The renderer-owned Windows controls belong to the
[Desktop v21 root frame](../architecture/2026-08-18-desktop-root-frame-v21.md),
and their native-state synchronization belongs to the
[Desktop chrome lifecycle](../architecture/2026-08-20-desktop-chrome-state-lifecycle.md).
