# Agent Note: Windows close minimizes Oh-DSH Desktop to the system tray

Status: implemented

English | [中文](2026-08-26-win32-close-to-tray.zh.md)

## Problem

On Windows, every close gesture — the custom titlebar's × button, the application menu's Close Window role, and the `desktop:window-close` IPC they funnel into — ran `window.close()` to completion, so `window-all-closed` fired and the whole application quit, taking the supervised DSH runtime and every live session with it. One mis-click on × destroyed the workbench state, and nothing told the user that closing the window meant exiting the process tree. Desktop workbench apps on Windows conventionally keep running from the system tray instead.

## Decision

Close-to-tray is a main-process-only decision in `src/main.ts`. A `Tray` is created on win32 after `app.whenReady()` (icon: the packaged `resources/oh-dsh-desktop.png` or the dev `assets/icons/16x16.png`, resized to `16 × scaleFactor` DIPs of the primary display); macOS and Linux never get one. The main window's `close` handler calls `event.preventDefault()` + `window.hide()` only when the tray exists, the window is not a plugin preview, and no quit is already in progress — otherwise close behaves exactly as before. `window-all-closed` no longer quits while the tray owns the hidden window and no quit is running, and `will-quit` destroys the tray so no orphan icon survives the process. The tray's click and its menu (**Show Main Window** / **Quit**) share `revealMainWindow()` with the macOS `activate` path; a second instance launch re-focuses the hidden window through the existing `second-instance` handler. The first hide of a session shows one `displayBalloon` notice saying the app keeps running in the tray. Tray labels live in the same bilingual `labels()` table as the application menu and are rebuilt whenever `buildMenu()` re-runs, so the tray follows the menu locale. The renderer, preload, and contracts are untouched: `desktop:window-close` still just calls `window.close()`, and Electron alone owns the hide-or-quit semantics — matching the desktop-titlebar boundary where the renderer owns the chrome row and Electron owns the BrowserWindow lifecycle. A missing or empty icon makes `createTray()` return `undefined`, which silently falls back to plain close-quits instead of trapping a window with no tray. `tests/desktop-tray.test.ts` pins the interception gate, the quit paths, the fallback, and the bilingual menu with static assertions.

## Alternatives considered

- **Tray on every platform.** Rejected: macOS already keeps the app in the Dock with `activate`-to-reveal, and Linux tray support depends on the desktop environment (GNOME ships without an extension); keeping macOS/Linux behavior byte-identical is a repository rule, and the problem only exists on Windows.
- **A close confirmation dialog (quit vs minimize).** Rejected: it interrupts every close, while a tray plus one balloon notice achieves the same informed choice after the fact.
- **A user preference toggling close behavior.** Rejected for now: it needs cross-surface settings storage and UI for little gain, and would add a new persisted preference surface the data-root rules discourage.
- **Also routing minimize to the tray.** Rejected: taskbar minimize is the Windows expectation; only the quit intent behind × is redirected, keeping the semantics auditable in one place.
- **A renderer-visible tray API on `DesktopBridge`.** Rejected: the hide-or-quit decision belongs to the Electron lifecycle, not the page; a main-process-only interception is the smallest diff and leaves the bridge contract frozen.

## Consequences

- Windows users closing the window keep the DSH runtime and sessions alive in the tray; they exit through the tray or application menu's Quit, both of which reach `app.quit()` and the existing ordered shutdown (including install-on-quit updates, which bypass the interception through the `quitting`/`quittingForUpdate` gates).
- macOS and Linux behavior is unchanged, and a failed tray-icon load degrades to the old close-quits instead of a stuck hidden window.
- A hidden window whose runtime dies shows the error splash on the next reveal; `revealMainWindow()` only shows the existing window, it never rebuilds one behind the user's back.
- Automated coverage is static-assertion only; real tray rendering, balloon behavior, and multi-monitor DPI need a manual Windows smoke before release.
