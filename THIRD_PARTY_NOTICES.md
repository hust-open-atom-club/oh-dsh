# Third-Party Notices

Oh-DSH is distributed under the MIT License. The projects below are either
bundled at a pinned revision or informed independently implemented adapters.

Upstream UI, themes, and component styling are not bundled. Oh-DSH adapts
compatible features to its own persistence, layout, localization, and theme
contracts. Direct upstream sources are tracked as pinned submodules. Upstream
releases and features are reviewed regularly.

## DeepSeek Harness

- Project: <https://github.com/deepseek-ai/deepseek-harness>
- Pinned npm release: `@deepseek-ai/dsh@0.1.1-rc.2`
- Declared license: MIT

Oh-DSH packages the published DSH CLI release as its runtime. The release
tarball and SHA-512 integrity are pinned in `dsh-source.json`; the dependency
closure is pinned in `scripts/dsh-runtime-0.1.1-rc.2-lock.yaml`.

## dsh-web-panel

- Historical project: dsh-web-panel (its previous public locator is no longer available)
- Oh-DSH component: `@oh-dsh/panel-controls`

Oh-DSH adapts the Terminal dock for its desktop layout, session model, themes,
and localization. The dock uses the shared Better Sidebar PTY Host, so no
separate Web Terminal or shell plugin is required.

## DSH-better-sidebar

- Project: <https://github.com/omdsh-dev/DSH-better-sidebar>
- Pinned release: `v0.13.0`
- Pinned revision: `9ad0a49b8a7506109b704896ffea3d7349c21e63`
- Declared license: MIT
- Oh-DSH components: `@oh-dsh/better-sidebar-runtime` and
  `@oh-dsh/sidebar`

Oh-DSH compiles the pinned upstream Host for PTY, bounded Files, Git status,
branch operations, history, and commit diffs. It does not load the upstream
client UI. The Oh-DSH sidebar adapts those capabilities into its own tabs,
viewers, Git Review, line comments, themes, and bilingual desktop layout. We
thank the maintainers and review upstream features regularly.

## plugin-registry and dsh-hub

- Projects: <https://github.com/vlln/plugin-registry>,
  <https://github.com/omdsh-dev/dsh-hub>, and
  <https://github.com/whyihaveyou/dsh-suite>
- Declared licenses: MIT
- Oh-DSH component: `@oh-dsh/plugin-marketplace`

Oh-DSH distills source locking, trust review, installed/enabled state,
candidate previews, updates, and recovery into one desktop transaction. Its
navigation, approval flow, and bilingual UI are implemented in this
repository.

## dsh-skins

- Historical project: dsh-skins (its previous public locator is no longer available)
- Oh-DSH component: `@oh-dsh/skins`

Oh-DSH follows the ThemeService extension model while providing original
skins, a desktop Settings interface, and Host-backed persistence.

## dsh-vision

- Project: <https://github.com/william-jin-cmu/dsh-vision>
- Referenced revision: `72978aa176df8e01a685bf270a1b1d016660c492`
- Declared license: BSD-3-Clause
- Oh-DSH component: `@oh-dsh/vision`

Oh-DSH adapts the upstream OpenAI-compatible vision bridge to the current DSH
credentials, settings, tool-output, and cancellation contracts. The built-in
Host is shared by Desktop, Web, and TUI, and local file resolution remains
inside the active Session workspace. The upstream license is retained with the
packaged plugin.

## dsh-TUI

- Project: <https://github.com/ccch1mneyyy/dsh-TUI>
- Upstream package: `@deepseek-harness-tui/dsh-tui@0.8.1`
- Pinned revision: `180117716ed50a789edb56539e832b1d1f7839cf`
- Ecosystem specification: <https://github.com/T-Auto/dsh-ecosystem-spec>
- Pinned ecosystem revision: `7e49be23ecd42ee1b19a74b92bb2791c3406d7fc`
- Protocol packages: <https://github.com/Yan-Zero/dsh-std>
- Pinned protocol revision: `a2faa86243a5693ee4970e3d8b3aaf361edea298`
- Declared license: MIT
- Oh-DSH component: `@oh-dsh/tui`

Oh-DSH bundles the pinned upstream renderer, session interaction, commands,
terminal compatibility layer, ecosystem specification, and dsh-std protocol
packages. The small downstream components own only the unified launcher,
marketplace scene, Profile defaults, data boundary, and release packaging. We
thank the upstream maintainers and keep their licenses with the packaged
source artifacts.
