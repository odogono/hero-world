#!/bin/sh
# The maintenance procedure for the Docker deployment: stop the World, back
# it up, migrate it to the image's EDL (a dry run first, then on
# confirmation), and start it again. See docs/operations.md.
#
#   CONTAINER=mua IMAGE=mua ENV_FILE=mua.env packages/mua_server/rel/maintain.sh
#
# IMAGE is the image whose EDL the World migrates to: the new release when
# upgrading. Set YES=1 to skip the confirmation. Any failure stops the
# procedure and leaves the World stopped, with its backup taken.
set -eu

CONTAINER=${CONTAINER:-mua}
IMAGE=${IMAGE:-mua}
ENV_FILE=${ENV_FILE:-mua.env}

release() {
  docker run --rm --volumes-from "$CONTAINER" --env-file "$ENV_FILE" "$IMAGE" \
    bin/mua_server eval "$1"
}

echo "Stopping $CONTAINER"
docker stop "$CONTAINER"

echo "Backing up, and what the Migration would change:"
release 'MuaServer.Release.maintain(dry_run: true)'

if [ "${YES:-}" != "1" ]; then
  printf 'Apply this Migration? [y/N] '
  read -r answer
  case "$answer" in
    y | Y) ;;
    *)
      echo "Not migrated. $CONTAINER is stopped; start it with: docker start $CONTAINER"
      exit 1
      ;;
  esac
fi

release 'MuaServer.Release.migrate()'

# An upgrade runs a new container from the new image; otherwise the old one
# starts again
if [ "$(docker inspect -f '{{.Config.Image}}' "$CONTAINER")" = "$IMAGE" ]; then
  echo "Starting $CONTAINER"
  docker start "$CONTAINER"
else
  echo "Migrated to $IMAGE. Replace the container to start it, e.g.:"
  echo "  docker rm $CONTAINER && docker run -d --name $CONTAINER -p 4000:4000 -v mua-data:/data --env-file $ENV_FILE $IMAGE"
fi
