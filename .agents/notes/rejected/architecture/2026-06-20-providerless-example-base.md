# Agent Note: Make the shared example base providerless

Status: rejected — superseded by [Extract example apps into packages](../../implemented/architecture/2026-06-20-extract-example-app-packages.md), which moves the spine into a `dsh-agent-spine-demo` bundle and deletes the `base*.yml` files, so there is no shared base YAML left to rename.

English | [中文](2026-06-20-providerless-example-base.zh.md)

## Problem

The examples had two shared base files: `examples/base-core.yml` was providerless, while `examples/base.yml` included that core plus the real `llm-deepseek` adapter. Snapshot replay needs the providerless core with `llm-replay`, because loading the real adapter without a key throws. The normal demos need the real adapter. The result was a naming inversion: the file named `base.yml` was not the reusable base for all examples, while the true base was `base-core.yml`.

The split was understandable, but it made every config explanation longer. It also led to awkward test setup like a keyless smoke test carrying a dummy API key so an adapter could boot even though the model is not called.

## Proposal

Rename the providerless core to `examples/base.yml` and make adapter selection explicit in each concrete example. The coding and ACP real configs add a tiny `llm-deepseek` include or local block; snapshot config adds `llm-replay`. Delete `examples/base-core.yml`.

The shared base should contain only provider-neutral services and tools: `llm`, sessions, system prompt, tools, agents, invariants, bash executor, and bash tool schemas. Anything that chooses a model provider belongs at the leaf config.

## Acceptance criteria

- `examples/base.yml` is providerless.
- `examples/base-core.yml` is deleted.
- Real demo configs explicitly add the DeepSeek adapter.
- Snapshot replay config includes the same providerless base and its replay adapter.
- The [examples README](../../../../examples/README.md), example-specific READMEs, and Agent Note references stop explaining "base = base-core plus adapter".

## What we give up

Real demos lose one layer of convenience: each must opt into the adapter. That is the right default for examples, because adapter choice is the variable part and providerless wiring is the shared product core.

<!-- agent-note-format: alternatives-not-recorded (pre-format Agent Note) -->
