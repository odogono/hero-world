#!/usr/bin/env bash
# Takes an online backup of the running World, copies it off this machine and
# keeps the newest KEEP there. Run by the mua-backup systemd timer (#142); see
# docs/operations.md#scheduled-backups.
#
#   BACKUP_DEST=rsync:user@nas:/backups/mua packages/mua_server/rel/backup.sh
#   BACKUP_DEST=rclone:b2:mua-backups       packages/mua_server/rel/backup.sh
#
# BACKUP_DEST   where backups go (required):
#                 rsync:[user@]host:/path   over SSH, with rsync
#                 rsync:/path               a local path, e.g. a mounted NAS
#                 rclone:remote:path        any rclone remote (S3, B2, …)
# KEEP          backups kept at BACKUP_DEST (default 28)
# LOCAL_KEEP    backups kept on the World's volume (default 2)
# CONTAINER     the server's container (default mua)
# STAGING       where a backup waits on this machine while it is copied
#               (default ~/mua/backup-staging); emptied after each run
# ON_FAILURE    a shell command run when a backup fails, given the reason on
#               stdin (and in $BACKUP_ERROR), e.g. a curl to a notification service
#
# Any failure logs `event=backup_failed` (to stderr and, if present, syslog
# under the tag mua-backup), runs ON_FAILURE, and exits non-zero.
set -euo pipefail

CONTAINER=${CONTAINER:-mua}
KEEP=${KEEP:-28}
LOCAL_KEEP=${LOCAL_KEEP:-2}
STAGING=${STAGING:-$HOME/mua/backup-staging}
BACKUP_DEST=${BACKUP_DEST:-}

log() {
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
  command -v logger >/dev/null 2>&1 && logger -t mua-backup -- "$*" || true
}

fail() {
  export BACKUP_ERROR="$1"
  log "event=backup_failed $1"
  if [[ -n "${ON_FAILURE:-}" ]]; then
    printf "mua backup failed: %s\n" "$1" | sh -c "$ON_FAILURE" || log "ON_FAILURE command failed"
  fi
  exit 1
}

trap 'fail "unexpected error at line $LINENO"' ERR

# beyond_newest N: reads backup names, prints those beyond the newest $1. Names
# carry a basic ISO-8601 timestamp, so they sort by time.
beyond_newest() {
  { grep -E '^world-[0-9TZ]+\.db$' || true; } | sort -r | tail -n +"$(($1 + 1))"
}

[[ $KEEP =~ ^[1-9][0-9]*$ ]] || fail "KEEP must be a positive number, not '$KEEP'"
[[ $LOCAL_KEEP =~ ^[0-9]+$ ]] || fail "LOCAL_KEEP must be a number, not '$LOCAL_KEEP'"

case "$BACKUP_DEST" in
  rsync:?*) KIND=rsync; TARGET=${BACKUP_DEST#rsync:} ;;
  rclone:?*:*) KIND=rclone; TARGET=${BACKUP_DEST#rclone:} ;;
  *) fail "set BACKUP_DEST to rsync:[user@]host:/path, rsync:/path or rclone:remote:path" ;;
esac
command -v "$KIND" >/dev/null 2>&1 || fail "$KIND is not installed"
TARGET=${TARGET%/}

# rsync's host, and its path there; no host means a local path.
if [[ $KIND == rsync && $TARGET == *:* ]]; then
  HOST=${TARGET%%:*}
  DIR=${TARGET#*:}
else
  HOST=""
  DIR=$TARGET
fi

# 1. Back up the running World, between Steps.
out=$(docker exec "$CONTAINER" bin/mua_server rpc 'MuaServer.Release.backup()' 2>&1) ||
  fail "the backup command failed: $out"
BACKUP=$(printf '%s\n' "$out" | sed -n 's/^Backed up the World to \(.*\)$/\1/p' | tail -n1)
[[ -n $BACKUP ]] || fail "the World didn't back up: $out"
NAME=$(basename "$BACKUP")
log "event=backup_taken path=$BACKUP"

# 2. Copy it off this machine.
mkdir -p "$STAGING"
trap 'rm -f "$STAGING/$NAME"' EXIT
docker cp "$CONTAINER:$BACKUP" "$STAGING/$NAME" >/dev/null ||
  fail "couldn't copy $BACKUP out of $CONTAINER"

case $KIND in
  rsync)
    if [[ -n $HOST ]]; then
      ssh -o BatchMode=yes "$HOST" mkdir -p "'$DIR'" || fail "couldn't reach $HOST"
    else
      mkdir -p "$DIR"
    fi
    rsync -t --partial "$STAGING/$NAME" "$TARGET/$NAME.part" &&
      { if [[ -n $HOST ]]; then ssh -o BatchMode=yes "$HOST" mv "'$DIR/$NAME.part'" "'$DIR/$NAME'"
        else mv "$DIR/$NAME.part" "$DIR/$NAME"; fi; } ||
      fail "couldn't copy $NAME to $BACKUP_DEST"
    ;;
  rclone)
    rclone copyto "$STAGING/$NAME" "$TARGET/$NAME" || fail "couldn't copy $NAME to $BACKUP_DEST"
    ;;
esac
log "event=backup_shipped dest=$BACKUP_DEST/$NAME"

# 3. Prune: the newest KEEP off the machine, the newest LOCAL_KEEP on the volume.
case $KIND in
  rsync)
    if [[ -n $HOST ]]; then
      old=$(ssh -o BatchMode=yes "$HOST" ls -1 "'$DIR'" | beyond_newest "$KEEP") || fail "couldn't list $BACKUP_DEST"
      for f in $old; do ssh -o BatchMode=yes "$HOST" rm -f "'$DIR/$f'"; done
    else
      old=$(ls -1 "$DIR" | beyond_newest "$KEEP") || true
      for f in $old; do rm -f "$DIR/$f"; done
    fi
    ;;
  rclone)
    old=$(rclone lsf --files-only "$TARGET" | beyond_newest "$KEEP") || fail "couldn't list $BACKUP_DEST"
    for f in $old; do rclone deletefile "$TARGET/$f"; done
    ;;
esac
[[ -z ${old:-} ]] || log "event=backup_pruned dest=$BACKUP_DEST removed=$(echo $old | tr ' ' ',')"

LOCAL_DIR=$(dirname "$BACKUP")
local_old=$(docker exec "$CONTAINER" ls -1 "$LOCAL_DIR" | beyond_newest "$LOCAL_KEEP") || true
for f in $local_old; do docker exec "$CONTAINER" rm -f "$LOCAL_DIR/$f"; done

log "event=backup_done name=$NAME kept=$KEEP"
