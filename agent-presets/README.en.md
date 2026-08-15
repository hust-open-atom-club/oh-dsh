# Downstream Agent Presets

Each child directory is one Agent preset shipped by Oh-DSH in addition to the
presets supplied by the pinned DSH runtime.

A preset directory contains:

- `preset.yml`: DSH display metadata.
- `agent.cordis.yml`: the native DSH Agent composition.
- `manifest.yml`: Oh-DSH build metadata; it is validated before staging and is
  not copied into the staged DSH preset.

`manifest.yml` declares the stable directory ID, supported surfaces, and every
local package owned by the preset. Package roles are `agent`, `host`, or
`client`; package-level surfaces default to all surfaces supported by the
preset.

To add a preset:

1. Create `agent-presets/<id>/` with the three required files.
2. Put local capability packages under `plugins/` and declare them in the
   manifest.
3. Ensure every local Agent plugin referenced by `agent.cordis.yml` has an
   `agent` package entry.
4. Run `pnpm run check:agent-presets`.

IDs must match `[a-z0-9][a-z0-9-]*`. The pinned DSH IDs `standard`, `code`,
`minimal`, and `cordis` are reserved and cannot be replaced downstream.
