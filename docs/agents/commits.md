# Commits and the changelog

PRs are squash-merged, so a PR's title becomes the commit on `main`. CI's `conventions` job checks every PR title, and requires a changelog fragment for the changes a reader of the changelog would want to hear about. A `commit-msg` hook checks local commits' format. A `pre-push` hook checks that a fragment matches the branch's `feat`, `fix` or `perf` commits and that new ADR numbers are free on `origin/main`, then runs `bun run check` ([checks.md](checks.md)). After a pull, rebase or branch switch that changes `bun.lock`, the `post-merge`, `post-rewrite` and `post-checkout` hooks rerun `bun install --frozen-lockfile`. All of them live in [`.githooks/`](../../.githooks/), and `bun install` turns them on.

## Subject format

```text
type(scope)!: lowercase imperative description (#issue)
```

- **type**, one of:
  - `feat`: a new or changed behavior.
  - `fix`: a behavior that was wrong.
  - `perf`: the same behavior, faster or smaller.
  - `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert`: no change a user would notice.
- **scope**, optional: the package, one of `ecs`, `helpers`, `mua` (the Elixir and browser packages), or `repo` for CI, `tools/`, docs and workspace changes.
- **!**, before the colon, marks a breaking change. A `BREAKING CHANGE: ...` line in the PR body does too.
- The description starts with a lowercase letter and doesn't end with a full stop. End it with the issue it closes, as `(#9)`.

Examples:

```text
feat(mua): let things set their own action messages (#24)
fix(ecs): keep unsaved component changes across a query (#20)
refactor(mua)!: rename the World's command reply
ci(repo): enforce Conventional Commit titles and changelog fragments
```

The hook lets through `fixup!`, `squash!` and `amend!` commits, and the merge and revert commits git writes itself.

## When a changelog fragment is needed

A PR whose title is `feat`, `fix` or `perf`, or marks a breaking change, adds a fragment under `changelog/unreleased/` whose type and scope match the title. The file name is any slug, such as `mua-message-templates.md`:

```md
---
type: feat
scope: mua
---

Let things set their own action messages.
```

Copy `type` and `scope` from your PR title, and leave `scope` out when the title has none. Write the entry for a reader of the changelog. [The fragment format](../../changelog/README.md) covers `breaking: true`. There is no way to skip this: a change with nothing worth recording has the wrong type, so retitle it.

To see the unreleased changelog, run `bun run changelog`.

To check a PR the way CI does, run:

```sh
PR_TITLE="feat(mua): add x" BASE_REF=main bun tools/commits/check.ts pr
```

`BASE_REF` is the branch name (`main`), without `origin/`; the checker adds the remote prefix.
