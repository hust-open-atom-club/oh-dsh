# Agent Note: Desktop Marketplace keeps a read-only viewer

Status: implemented

English | [中文](2026-08-26-desktop-marketplace-read-only.zh.md)

## Problem

Desktop shares `~/.ohdsh` with Web or TUI surfaces. When another surface owns the
runtime lock, Desktop enters read-only viewer mode. The renderer still exposes the
Marketplace entry, but Desktop previously omitted its transaction manager, so
Marketplace IPC failed with `plugin marketplace is not initialized` instead of
serving a catalog viewer.

## Decision

Desktop creates the same `PluginMarketplaceManager` in read-only mode that Web and
TUI use. The manager can load and refresh the public catalog and read the shared
profile, but it does not create preview or rollback directories, does not write the
catalog cache, and returns a read-only error for every mutating command. Desktop
only creates the Marketplace working directory and ensures the profile when it owns
the runtime lock.

## Alternatives considered

**Keep Desktop Marketplace disabled while read-only** — rejected because the
renderer bridge remains present and the UI must either expose a working read-only
viewer or hide the entry. Keeping the shared viewer contract makes the lock
contention behavior consistent across surfaces and avoids an IPC initialization
failure.

**Allow Desktop to mutate the shared profile without the lock** — rejected because
it would violate the single-writer runtime contract and could corrupt session or
profile state while another surface is active.

## Consequences

A Desktop started while Web or TUI owns the shared data root can browse the
Marketplace and receive an explicit read-only response for install, update,
enable, disable, preview, apply, discard, and undo actions. Catalog refresh remains
subject to the existing network and cache-read behavior. Once Desktop owns the
lock, its existing writable Marketplace setup is unchanged.
