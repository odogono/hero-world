# The invite-only alpha: mua_server, its World and the browser client, as one
# image (#130). It lives at the repository root because the build needs
# several packages: the client, mua_server and the Elixir libraries it uses
# by path.
#
#   docker build -t mua .
#   docker run -p 4000:4000 -v mua-data:/data --env-file mua.env mua
#
# Bun builds the client and Mix builds the release; the image that runs
# needs neither (ADR 0009).

# -- The browser client -------------------------------------------------------
FROM oven/bun:1.4.4 AS client
WORKDIR /src
COPY package.json bun.lock ./
COPY packages ./packages
RUN bun install --frozen-lockfile --filter mua-client
RUN cd packages/mua_client && bun run build

# -- The release --------------------------------------------------------------
FROM elixir:1.20-otp-28 AS release
ENV MIX_ENV=prod
WORKDIR /src
RUN mix local.hex --force && mix local.rebar --force
COPY packages/odgn_ecs ./packages/odgn_ecs
COPY packages/odgn_edl ./packages/odgn_edl
COPY packages/odgn_ecs_talk ./packages/odgn_ecs_talk
COPY packages/odgn_ecs_engine ./packages/odgn_ecs_engine
COPY packages/mua_world ./packages/mua_world
COPY packages/mua_server ./packages/mua_server
COPY --from=client /src/packages/mua_server/priv/static ./packages/mua_server/priv/static
WORKDIR /src/packages/mua_server
RUN mix deps.get --only prod && mix release

# -- The image that runs ------------------------------------------------------
FROM debian:trixie-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends libstdc++6 openssl libncurses6 locales ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && sed -i '/en_US.UTF-8/s/^# //' /etc/locale.gen && locale-gen
ENV LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 \
  DATABASE_PATH=/data/world.db PORT=4000 MUA_SCRIPTS_DIR=/app/mua-scripts
RUN useradd --system --create-home --uid 1000 mua && mkdir /data && chown mua /data
WORKDIR /app
COPY --from=release --chown=mua /src/packages/mua_server/_build/prod/rel/mua_server ./
# The Base Verbs and Service Scripts every World shares (ADR 0024)
COPY --chown=mua packages/mua-scripts ./mua-scripts
USER mua
VOLUME /data
EXPOSE 4000
CMD ["/app/bin/mua_server", "start"]
