#!/bin/sh
# Levanta un PostgreSQL local para desarrollo o pruebas sin Docker.
# Uso: sh scripts/local-db.sh [puerto] [carpeta]
set -e
PORT=${1:-54329}
DIR=${2:-/tmp/fisiocerca-pg}
BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)
[ -n "$BIN" ] || { echo "No se encontró PostgreSQL. Usa docker compose up db"; exit 1; }
RUN=""
[ "$(id -u)" = "0" ] && RUN="runuser -u postgres --"
if [ ! -f "$DIR/PG_VERSION" ]; then
  mkdir -p "$DIR" && [ -n "$RUN" ] && chown postgres "$DIR"
  $RUN "$BIN/initdb" -D "$DIR" -U fisio --auth=trust >/dev/null
fi
$RUN "$BIN/pg_ctl" -D "$DIR" -o "-p $PORT -k /tmp" -l "$DIR/log.txt" -w status >/dev/null 2>&1 || \
  $RUN "$BIN/pg_ctl" -D "$DIR" -o "-p $PORT -k /tmp -c listen_addresses=localhost" -l "$DIR/log.txt" -w start >/dev/null
echo "postgres://fisio@localhost:$PORT/postgres"
