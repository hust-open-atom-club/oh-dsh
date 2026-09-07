# Third-Party Notices

Oh-DSH is distributed under the MIT License. The projects below are either
bundled at a pinned revision or informed independently implemented adapters.

Upstream UI, themes, and component styling are not bundled. Oh-DSH adapts
compatible features to its own persistence, layout, localization, and theme
contracts. Direct upstream sources are tracked as pinned submodules. Upstream
releases and features are reviewed regularly.

## DeepSeek Harness

- Project: <https://github.com/deepseek-ai/deepseek-harness>
- Pinned npm release: `@deepseek-ai/dsh@0.1.2-alpha.3`
- Declared license: MIT

Oh-DSH packages the published DSH CLI release as its runtime. The release
tarball and SHA-512 integrity are pinned in `dsh-source.json`; the dependency
closure is pinned in `scripts/dsh-runtime-0.1.2-alpha.3-lock.yaml`.

## dsh-web-panel

- Historical project: dsh-web-panel (its previous public locator is no longer available)
- Oh-DSH component: `@oh-dsh/panel-controls`

Oh-DSH adapts the Terminal dock for its desktop layout, session model, themes,
and localization. The dock uses the shared Better Sidebar PTY Host, so no
separate Web Terminal or shell plugin is required.

## DSH-better-sidebar

- Project: <https://github.com/omdsh-dev/DSH-better-sidebar>
- Pinned release: `v0.18.0-alpha.0`
- Pinned revision: `9494774c4867cdb661c8f9a805c40f7982518868`
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

## dsh-context

- Project: <https://github.com/bowenliang123/dsh-context>
- Upstream package: `dsh-context@0.41.0`
- Pinned release: `v0.41.0`
- Pinned revision: `3179715f57404b4429436685526674659b5e86e9`
- Declared license: Apache-2.0
- Oh-DSH component: built-in Desktop and Web context insight plugin

Oh-DSH builds the pinned upstream plugin inside its submodule with the
upstream's own tsdown configuration and stages the prebuilt host and browser
halves unmodified, so the context dashboard and the `/context` command behave
exactly as the upstream publishes them. The pinned release is upgraded
deliberately through the submodule pointer. We thank the upstream maintainer
and keep the license with the packaged plugin.

## dsh-TUI

- Project: <https://github.com/ccch1mneyyy/dsh-TUI>
- Upstream package: `@deepseek-harness-tui/dsh-tui@0.10.0-beta.4`
- Pinned revision: `f7db605713a861b28c004b2dc18813bb74d61154`
- Ecosystem specification: <https://github.com/T-Auto/dsh-ecosystem-spec>
- Pinned ecosystem revision: `d28c267fe7fd775428ec2dccd65b0b7efd4dacee`
- Protocol packages: <https://github.com/Yan-Zero/dsh-std>
- Pinned protocol revision: `614dfa1ac168db79fcf4577cf0ebb34e2e3b944b`
- Bundled OAuth package: <https://github.com/ccch1mneyyy/dsh-auth>
  (`@deepseek-harness-tui/dsh-auth@0.1.0`, pinned revision
  `4e7cba3854e8874c8114bac2133aba3a7e1a65fe`, MIT) — also mounted directly
  as the built-in Desktop and Web host plugin behind the `/auth` command
- Declared license: MIT
- Oh-DSH component: `@oh-dsh/tui`

Oh-DSH bundles the pinned upstream renderer, session interaction, commands,
terminal compatibility layer, ecosystem specification, and dsh-std protocol
packages. The small downstream components own only the unified launcher,
marketplace scene, Profile defaults, data boundary, and release packaging. We
thank the upstream maintainers and keep their licenses with the packaged
source artifacts.
