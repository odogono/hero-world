#!/bin/sh
# Applies a changed env file, such as a new allowlist or admin, to the
# running server. Docker reads --env-file only when it creates a container,
# so `docker restart` keeps the old values: this replaces the container with
# the same flags rel/deploy-almere.sh uses. The World stays on its volume.
#
#   packages/mua_server/rel/reload-env.sh
set -eu

ENV_FILE=${ENV_FILE:-$HOME/mua/mua.env}
CONTAINER=${CONTAINER:-mua}
IMAGE=${IMAGE:-mua}
VOLUME=${VOLUME:-mua-data}
PORT=${PORT:-4000}

[ -f "$ENV_FILE" ] || { echo "no env file at $ENV_FILE (set ENV_FILE)" >&2; exit 1; }

echo "Replacing $CONTAINER with the values in $ENV_FILE"
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" --restart unless-stopped \
  -p "127.0.0.1:$PORT:4000" -v "$VOLUME:/data" --env-file "$ENV_FILE" "$IMAGE" >/dev/null

i=0
while [ $i -lt 60 ]; do
  if curl -fsS "http://127.0.0.1:$PORT/health" 2>/dev/null; then echo; exit 0; fi
  i=$((i + 1)); sleep 2
done
echo "no healthy answer on port $PORT after 2 minutes; check: docker logs $CONTAINER" >&2
exit 1
