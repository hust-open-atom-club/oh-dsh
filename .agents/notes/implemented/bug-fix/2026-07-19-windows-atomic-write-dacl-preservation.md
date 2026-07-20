# Agent Note: Preserve Windows DACLs during atomic file replacement

Status: implemented

English | [中文](2026-07-19-windows-atomic-write-dacl-preservation.zh.md)

## Problem

On Windows, creating the staging directory and temp file under the target's parent and relying only on inherited DACLs is sufficient for a new file, but not for replacing an existing file whose explicit or protected DACL is narrower than its parent: content is written under the broader parent DACL, and rename carries that staging descriptor onto the replacement.

## Decision

`dsh-fs-local` reads an existing target's DACL with `GetFileSecurityW`, applies it to the empty temp file with inheritance protected before writing content, and publishes the closed temp with `ReplaceFileW`. The protected staging descriptor prevents the temp directory's inherited entries from broadening access; `ReplaceFileW` preserves the original target access policy and other replacement metadata. Its ACL merge may reserialize auto-inheritance state or duplicate equivalent ACEs, so self-relative descriptor buffers are not a stable equality contract. New files have no prior descriptor to preserve and continue to inherit the destination directory's DACL.

Native Windows coverage protects a target DACL, inspects the written staging file, and compares the final replacement's ordered, de-duplicated ACE policy. Host-independent binding tests cover Win32 error translation and every native call boundary.

## Alternatives considered

**Rely on directory inheritance for replacements.** Rejected because a target may carry a narrower explicit or protected DACL than its parent, so inheritance neither protects staged content nor preserves the target access policy.

**Use `ReplaceFileW` without protecting the temp.** Rejected because it repairs the final descriptor only after the content has already been written under the staging file's inherited DACL.

**Install an owner-only DACL for every write.** Rejected because it would discard deliberate project sharing. Copying the target DACL preserves the deployment's existing access policy instead of inventing one.

## Consequences

Replacing a Windows file now requires permission to read the target DACL and set the temp DACL; failure is loud before content is written. The package carries Koffi for the narrow Win32 calls, loaded only on Windows replacement paths. New-file behavior remains directory-inherited, and POSIX mode behavior is unchanged.
