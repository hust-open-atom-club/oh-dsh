---
name: dsh-code-review
description: Use when reviewing a pull request in the deepseek-harness repo — orients the reviewer to this codebase's standards (AGENTS.md conventions, defensive patterns, ADRs, quality gates) and the review-specific checks that code alone can't show
---

# Reviewing a DeepSeek-Harness PR

**This skill is guidance, not a complete checklist.** Read the diff against the PR's current base and enough surrounding code to understand the design, then verify suspected defects before reporting them. Re-establish that base after a retarget or merge. Prioritize correctness, lifecycle, security, and contract failures over style; a short review with one substantiated blocker is better than a list of nits.

## Sources of truth

- [AGENTS.md](../../../AGENTS.md) and [packages/AGENTS.md](../../../packages/AGENTS.md): repository and package rules.
- [docs/defensive-patterns.md](../../../docs/defensive-patterns.md): subprocess, callback, async-state, and disposal bug classes.
- [docs/AGENTS.md](../../../docs/AGENTS.md): documentation placement and prose discipline.
- [dsh-prose-standard](../dsh-prose-standard/SKILL.md): required coverage and editorial judgment for comments, docs, prompts, and visible strings.
- [docs/testing.md](../../../docs/testing.md) and the [quality-gates RFC](../../../docs/rfc/implemented/process/2026-06-11-quality-gates.md): required test tiers and gates.
- [RFC index](../../../docs/rfc/README.md): design rationale. Treat disagreement with an RFC as a design discussion, not an automatic veto.
- For bilingual changes, read [translation-rules.md](../../../docs/i18n/translation-rules.md), [terminology.md](../../../docs/i18n/terminology.md), and [dsh-translate-docs](../dsh-translate-docs/SKILL.md).

## Blocking requirements

1. **Docs match the code.** Config, defaults, errors, wire fields, events, and public behavior update the package README and JSDoc in the same diff. Comments state non-obvious contracts; flag implementation narration, test walkthroughs, review history, and duplicated rationale for deletion or a link to their one home.
2. **Core type docs match.** Changes to spine or seam vocabulary update the appropriate [core-data-structures](../../../docs/core-data-structures/core.md) page and any `type-equiv` entry. Internal types need no catalog entry.
3. **Registrations clean up.** A new registry contribution has a test that disposes its owner and observes removal.
4. **Required gates pass.** Trust the [current readiness sequence](../../../AGENTS.md#run-the-ci-gates-locally-before-marking-a-pr-ready) and `pnpm run check:pre-push` for their enforced inventory; review the semantic gaps they cannot detect.

## Manual checks

- **Intent and seam contracts:** trace both sides of every changed interface. Confirm the implementation matches the PR and any RFC, including errors, cancellation, ownership, and disposal.
- **Lifecycle and concurrency:** for async setup, callbacks, processes, or teardown, apply [defensive-patterns.md](../../../docs/defensive-patterns.md). Check races before publication, cancellation during awaits, independent error reporting, callback containment, and quiescent disposal.
- **Capability shape:** a swappable capability follows the interface / implementation / consumer split. Consumers depend on the interface, not a backend.
- **Configuration:** deployment-varying timeouts, caps, models, URLs, paths, and retry counts are validated `Config` fields, not literals or `DEFAULT_*` constants.
- **Real entry path:** tests exercise the shipped Loader, bin, worker, ACP bridge, or subprocess where relevant. A hand-mounted plugin does not catch Loader export-shape failures; a function plugin must named-export its namespace and have no default export.
- **Test strength:** assertions fail on the intended regression and verify external state, logs, events, or disposal rather than restating the implementation or trusting an agent's report. Coverage is necessary but not evidence that the scenario is correct.
- **Transcript changes:** editor-visible or model-visible changes update snapshots or explain why no snapshot applies. Review golden diffs as behavior changes, not formatting noise.
- **Bilingual changes:** compare meaning and terminology on both sides; a green pairing hash does not prove translation quality.

## Reporting findings

State the defect, location, impact, and evidence. Separate blockers from suggestions and omit issues already enforced by a green gate. Use the existing GitHub review thread for replies. When receiving review, verify each claim and fix or rebut it on technical grounds without performative agreement.
