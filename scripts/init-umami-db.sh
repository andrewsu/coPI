#!/bin/bash
# Creates the umami database on Postgres first boot.
#
# This script is mounted into the Postgres container at
# /docker-entrypoint-initdb.d/ and is executed automatically by the
# official Postgres entrypoint on initial volume creation only.
# Subsequent container restarts skip it (data directory is not empty).
#
# Umami auto-creates its own schema tables on first startup via the
# DATABASE_URL connection string pointing to this database.

set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE umami;
EOSQL
