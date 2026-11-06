# The Woodpecker CI image: Bun, Node, Elixir/OTP and Playwright's Chromium.
# Node is there because Prettier and Playwright run on it, as on GitHub's
# runners: under Bun, the import sorter treats `bun:test` as a builtin.
# Built on taito, which the Woodpecker agents run on:
#
#   docker build -t hero-world-ci:2026-11-06 tools/ci
#
# Bump the tag in .woodpecker/*.yaml when this changes. Keep Bun, Elixir and
# Playwright in step with the root Dockerfile and bun.lock.
FROM oven/bun:1.4.4 AS bun
FROM node:24-bookworm-slim AS node
FROM elixir:1.20-otp-28

COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s bun /usr/local/bin/bunx
COPY --from=node /usr/local/bin/node /usr/local/bin/node

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git unzip \
    && rm -rf /var/lib/apt/lists/*

RUN mix local.hex --force && mix local.rebar --force

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN bunx playwright@1.64.1 install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* /root/.bun/install/cache
