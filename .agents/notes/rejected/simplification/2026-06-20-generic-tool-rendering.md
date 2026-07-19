# Agent Note: Collapse tool-owned UI presentation

Status: rejected — tool-owned presentation should wait for more real tools before being generalized or deleted. Bash and ACP currently need the existing richer presentation path.

## Problem

Tools can define `presentCall()` and `presentResult()` callbacks that return `ToolCallPresentation`, `ToolResultPresentation`, and optional `ToolTerminal` fields. The code itself flags the design as muddy: title, kind, raw input, content, terminal cwd, terminal output, exit code, and signal grew incrementally into a bag of optional fields. ACP then maintains pending call state to pair a result with the original args, creates replay-only presenters on `session/load`, and maps terminal subfields into Zed-specific `_meta`. `dsh-tool-bash` even parses exit status back out of rendered text because the pure replay-safe presenter no longer has the structured `BashRunResult`.

The real first-party use is bash presentation for ACP. That is too little evidence to freeze a cross-package UI presentation API.

## Proposal

Remove tool-owned UI presentation callbacks for now. The canonical tool events already carry the tool name, raw argument string, result content, and error state. UIs render a generic tool card from those fields. Tool-specific rich rendering can return later as a tagged render-intent union after there are at least two real tools and two real consumers to validate the vocabulary.

## Alternatives considered

As a smaller alternative, replace the current optional-field bag with one explicit union in a single PR; but if the goal is simplification, the stronger move is to delete the callbacks and keep the generic path.

## Acceptance criteria

- `ToolDefinition` drops `presentCall` and `presentResult`.
- `ToolCallPresentation`, `ToolResultPresentation`, `ToolTerminal`, and `ToolCallKind` disappear unless a minimal generic UI type still needs one.
- ACP no longer keeps presenter pending state or calls tool callbacks during live streaming/load replay.
- `dsh-tool-bash` no longer parses rendered text to recover exit status for a UI pill.
- Snapshot expected outputs show generic tool cards and text results.

## What we give up

Bash loses its custom terminal-looking card and model-written description placement. The fallback remains reasonable: the command appears as tool input, and the output appears as text. Rich rendering should be designed when the product has enough UI/tool variety to justify a stable presentation contract.

## Related

This is the broad version of [dropping ACP terminal metadata](2026-06-20-drop-acp-terminal-meta.md). If this Agent Note is accepted, that narrower Agent Note becomes unnecessary.
