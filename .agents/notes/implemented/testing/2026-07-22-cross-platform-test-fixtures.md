# Agent Note: Keep supported-platform tests semantic

Status: implemented

English | [中文](2026-07-22-cross-platform-test-fixtures.zh.md)

## Problem

The unit and coverage suites run on Windows, macOS, and Linux, but a platform-neutral behavior can be hidden behind a platform-specific fixture. Literal POSIX paths become drive-relative paths on Windows, a hosted `file:` URI can be a valid UNC path there, and numeric file descriptor `0` is not the sole owner of Node's pipe-backed child stdin. POSIX-only filesystem states such as FIFOs, executable mode bits, and directory search bits have no direct Windows fixture.

Treating fixture syntax as product behavior either reports false regressions or encourages production normalization that erases native path semantics.

## Decision

Tests of platform-neutral behavior construct absolute paths and `file:` URIs with the host's `node:path` and `node:url` APIs, then assert native absolute output or stable workspace-relative output as the contract requires. Invalid-URI fixtures use encodings rejected by `fileURLToPath()` on every supported platform.

Subprocess fixtures that require the parent write side to fail close both the CRT descriptor and the libuv handle owning child stdin. This pins the connection failure contract across POSIX descriptor-backed and Windows pipe-backed processes while keeping the child alive long enough to distinguish pipe failure from process exit.

Tests for a genuinely POSIX-only primitive use a narrow Windows exclusion on that case. Adjacent cross-platform cases continue to pin non-regular file rejection, unavailable command rejection, and inaccessible working-directory rejection.

## Alternatives considered

**Normalize all paths and URIs to POSIX strings.** This would make assertions uniform but would change correct Windows behavior: external paths are native absolute paths, UNC file URIs are valid, and configured homes resolve through the host path rules.

**Run POSIX fixtures through a compatibility shell on Windows.** A compatibility environment would test different filesystem and process semantics from the native Node runtime exercised by the product.

**Skip whole files or packages on Windows.** Broad exclusions would hide supported behavior. Only the individual fixture whose state cannot exist on Windows is excluded; the surrounding contract remains covered.

## Consequences

Portable fixtures are slightly more verbose because expected paths derive from shared native constants. Platform-only exclusions require a neighboring cross-platform assertion for the product behavior they support. Pipe-failure fixtures depend on Node's test-runtime handle shape, but that dependency stays inside the scripted child and proves the real parent-side stream behavior rather than mocking it.
