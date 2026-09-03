# Agent Note: Share the Liangshen preset across application surfaces

Status: implemented

English | [中文](2026-08-24-cross-surface-liangshen-preset.zh.md)

## Problem

The Liangshen agent preset shipped inside dsh-TUI and was therefore only
discoverable after the TUI package installed its user-root copy. Web and
Desktop use the same DSH agent-preset service, but their staged deployments did
not contain that composition.

The preset publishes one Chinese `name` and `description`. Both the DSH Web
client and dsh-TUI treated user-root preset metadata as literal copy, so the
English locale still rendered the Chinese Liangshen name and description.

## Decision

- Add an Oh-DSH `@oh-dsh/liangshen` Host plugin to the Web and Desktop bundle
  patches. The plugin installs the pinned `presets/liangshen` composition into
  the shared user preset root before sessions are created.
- Project the package-owned `.dsh-tui-managed.json` owner through the DSH
  roster and `agentPreset.list` as `managedBy`. Localize only a row whose
  owner, id, name, and description match the pinned Liangshen preset. A
  user-authored row, including one that copies the canonical display text but
  carries no management marker, keeps the text it published.
- Adapt the pinned DSH Agent-preset roster, API, and client for Web/Desktop and
  the compiled dsh-TUI roster projection for TUI. Both resolve the Liangshen
  name and description from the active locale without rewriting preset files.
- Apply the presentation adapters only to copied runtime packages in regular
  staging and Nix assembly. Exact, idempotent anchors make a DSH or dsh-TUI
  layout change fail packaging for review.
- Skip the install when the surface starts as a read-only viewer
  (`OH_DSH_READ_ONLY=1`): the viewer shares the data root with an active
  surface, and installing would replace preset state that surface owns.
- Register the plugin in the Nix `full` and `web` assemblies through the
  shared runtime assembler (`installDesktopPackages` in
  `scripts/stage-runtime-lib.mjs`, the same function the release pipeline
  runs), staging the preset beside `dist/` from the pinned TUI release; the
  Nix TUI closure stays on the upstream preset.
- Do not mount that plugin in TUI; the pinned dsh-TUI renderer already installs
  and exposes its own Liangshen preset.
- Keep the preset source in the pinned dsh-TUI checkout so its tool-bootstrap,
  compaction, and delegated-agent behavior upgrades together with its owner.
- Keep `standard` as the default; Liangshen is opt-in through the preset
  selector, startup flag, or environment setting.

## Alternatives considered

**Copy the preset into the staged DSH config root.** Rejected because it would
make the preset a deployment asset rather than the explicitly scoped built-in
Web/Desktop plugin requested by the product boundary. Giving that root
precedence would also shadow an unmanaged user preset that already owns the
`liangshen` id, replacing the existing conflict-preservation behavior.

**Infer ownership from the `liangshen` id or canonical display text.** Rejected
because an unmanaged user preset may legitimately retain either; replacing its
published name and description would misrepresent user-owned code as the
managed composition.

**Add locale maps to `preset.yml`.** Rejected because the pinned
`dsh-agent-presets` metadata and API accept plain strings. Expanding that wire
format would require coordinated changes in DSH, dsh-TUI, and every roster
consumer for one downstream preset.

**Duplicate the preset under a new Oh-DSH plugin package.** Rejected because it
would create a second copy of a composition whose lifecycle and upstream
ownership already belong to dsh-TUI.

**Make Liangshen the default.** Rejected because it changes the model-visible
tool contract for existing users; availability is safe, opt-in behavior is
backward compatible.

## Consequences

- Web/Desktop Agent preset settings resolve the preset through the built-in
  plugin, while TUI continues to use dsh-TUI's native implementation. Both
  render `Liangshen mode` in English and `梁神模式` in Chinese.
- Custom preset metadata remains literal, including a conflicting user-owned
  `liangshen` row that retains the canonical Chinese display text but does not
  carry the package-owned marker.
- Surface-local staging includes the plugin only for Web and Desktop; TUI does
  not receive a duplicate Liangshen runtime package.
- Nix Desktop/Web resolve the plugin package and its preset exactly like the
  staged (non-Nix) deployment, guarded by
  `tests/stage-runtime-lib.test.ts`.
- The Nix assembly mechanism now lives in the shared runtime assembler (see
  2026-08-27-nix-packaging-shares-stage-dsh-assembly); this note keeps the
  surface-membership decision.
- `tests/liangshen.test.ts`, `tests/tui.test.ts`, and the Desktop/Web smoke
  checks pin the marker-derived ownership field, canonical-metadata guard, and
  served client bundles.
- A DSH or dsh-TUI upgrade must revalidate the presentation anchors, preset
  composition, and cross-surface staged copy.
