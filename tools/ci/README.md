# Woodpecker CI

Woodpecker runs on taito (https://taito.tail9c3af.ts.net), alongside
odgn-talk's. GitHub Actions (`.github/workflows/ci.yml`) still runs too, until
Woodpecker has proved itself; then `ci.yml` goes.

- `.woodpecker/conventions.yaml` checks the PR title and changelog fragment
  ([commits.md](../../docs/agents/commits.md)). It reruns when the PR's title,
  body or base branch is edited. [`woodpecker.ts`](../commits/woodpecker.ts)
  reads the PR from GitHub, since Woodpecker's events lack its body.
- `.woodpecker/check.yaml` runs `bun run check` without its Mix packages, then
  `check:northtalk`.
- `.woodpecker/elixir.yaml` runs each Mix package as a parallel step: deps,
  format, a warnings-as-errors compile and the tests.
- `.woodpecker/e2e.yaml` runs the Playwright journeys of `mua_client`,
  `mua-local` and `arcade`.

The release image's `docker build` stays on GitHub Actions: Woodpecker's steps
have no Docker daemon.

## The image

Every step runs in `hero-world-ci:<date>`, built from [`Dockerfile`](Dockerfile)
on taito, since the agents only use local images:

```sh
scp tools/ci/Dockerfile taito:/tmp/hero-world-ci/
ssh taito docker build -t hero-world-ci:<date> /tmp/hero-world-ci
```

Then set the new tag in each `.woodpecker/*.yaml`. Keep Bun, Elixir and
Playwright in step with the root `Dockerfile` and `bun.lock`.
