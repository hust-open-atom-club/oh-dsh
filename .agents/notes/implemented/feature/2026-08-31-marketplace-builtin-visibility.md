# Agent Note: Marketplace hides built-in plugins by default

Status: implemented

English | [中文](2026-08-31-marketplace-builtin-visibility.zh.md)

## Problem

The Marketplace showed protected plugins beside installable plugins even
though its transaction manager rejects modifications to them.

## Decision

Catalog normalization now publishes `builtin` alongside `protected`.
Currently every protected entry is built-in, but `builtin` controls display
while `protected` remains the mutation boundary. Desktop and Web hide built-ins
by default and reveal them through a synthetic Built-in view without replacing
the catalog's original category. Hiding built-ins resets any selected synthetic
or original category that is absent from the remaining catalog. TUI uses the
same default and exposes a `Ctrl+B` visibility toggle. The visibility choice is
process-local.

## Alternatives considered

Using `protected` as both authorization and presentation state was rejected
because the meanings may diverge. Replacing the source category was rejected
because it would discard catalog metadata.

## Consequences

The protocol gains one required boolean. Browser status views count built-ins
as installed without creating Marketplace receipts or treating them as
disabled or updateable. Browser category selection cannot retain a value that
was removed with the built-in entries. Direct commands continue to be rejected
by the existing `protected` transaction check.
