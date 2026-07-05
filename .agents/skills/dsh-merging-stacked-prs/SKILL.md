---
name: dsh-merging-stacked-prs
description: Use when landing a stack of dependent GitHub PRs (A ← B ← C, where each bases on the one below) onto master — merging more than one PR in a chain, merging a PR whose base is another open PR's branch, or whenever a request mentions "stacked PRs", "PR stack", "dependent PRs", "base branch", or merging several related PRs in sequence. Critical because deleting a base branch mid-chain auto-closes the open PR that bases on it — get the order wrong and you silently close unmerged work.
---

# Merging a stacked PR chain

This skill is the landing procedure for a dependent PR stack. The standing orders it rests on — merge commits only (`gh pr merge --merge`), never rewrite a pushed branch — live in the root [AGENTS.md](../../../AGENTS.md) § Conventions; the discipline for handling review comments across a stack before it lands is the [responding-to-pr-review-on-a-stack](../../../docs/cookbook/responding-to-pr-review-on-a-stack.md) cookbook guide.

## The hazard this prevents

On GitHub, **deleting a PR's base branch auto-closes that PR.** In a stack `A ← B ← C` (B bases on A, C bases on B), branch A is the base of PR B, and branch B is the base of PR C. So if you merge A with `--delete-branch`, GitHub closes PR B before it's merged — silently destroying the chain. The whole procedure below exists to avoid that: **merge one at a time, retarget each dependent as you go, and delete nothing until every PR has landed.**

## The procedure

Given `A ← B ← C` landing on `master`:

1. **Merge PR A into master, keeping its branch.** `gh pr merge A --merge` — no `--delete-branch`. Branch A must survive because PR B still bases on it. Before touching the next link, confirm the merge actually landed: with required checks pending or a merge queue, `gh pr merge` may only enable auto-merge and return early, so wait until `gh pr view A --json state` reports `MERGED`. This applies after every merge in the stack.

2. **Retarget PR B, refresh it, then merge it — keeping its branch.**
   - `gh pr edit B --base master` (now that A is in master, B's base becomes master).
   - Merge the new master *into* branch B: check out B, `git fetch origin`, `git merge origin/master` — merge `origin/master`, not local `master`, because `gh pr merge` updated only GitHub and the local branch is stale — resolve any conflicts here, and push. This makes B current and surfaces conflicts in the working branch where they can be tested — not as a surprise at the GitHub merge.
   - `gh pr merge B --merge` — still no `--delete-branch` (PR C bases on branch B).

3. **Retarget PR C, refresh it, then merge it — keeping its branch.** Same steps: `gh pr edit C --base master`, fetch and merge `origin/master` into branch C, resolve conflicts there and push, then `gh pr merge C --merge` without `--delete-branch`.

4. **Only after every PR (A, B, C) is merged, delete the branches** — local and remote, for all of A, B, C.

## Why "merge new master into the dependent before merging it"

Each retarget step merges the freshly-updated master back into the dependent branch *before* merging the PR. This keeps each PR's diff clean (it only shows that PR's own changes, not the parent's) and forces conflicts to surface in the working branch, where you can build and test the resolution — instead of letting GitHub attempt a blind merge that may conflict or quietly mis-resolve.

## Verify before deleting anything

Before deleting a branch, ask GitHub directly whether any open PR still bases on it:

```sh
gh pr list --state open --base <branch> --json number --jq length
```

Anything other than `0` means open PRs still base on `<branch>` and deleting it would auto-close them — do not delete it. The `--base` filter is applied server-side, so zero-versus-non-zero is exact no matter how many PRs are open; the printed number itself saturates at `gh`'s `--limit` (default 30), which never matters here because only `0` clears a delete. Default to merging without `--delete-branch` throughout, and do the deletions as a separate final pass once every branch you're about to delete reports `0`.

## Longer chains

The pattern extends to any depth. For `A ← B ← C ← D ← …`, walk the stack from the bottom up: merge the lowest, then for each next link retarget to master, fetch and merge `origin/master` into it, merge the PR — always without deleting — and only sweep up all the branches at the very end. The invariant never changes: **a branch may be deleted only when no open PR bases on it.**

## Quick checklist

- [ ] Merge bottom PR first, `--merge`, no `--delete-branch`; wait until `gh pr view <n> --json state` shows `MERGED`.
- [ ] For each dependent: `gh pr edit <n> --base master` → fetch and merge `origin/master` into the branch (resolve conflicts there, push) → `gh pr merge <n> --merge`, no `--delete-branch`; again wait for `MERGED`.
- [ ] Before each branch delete: `gh pr list --state open --base <branch> --json number --jq length` prints `0`.
- [ ] Delete all branches (local + remote) only as a final pass.
