#!/bin/sh
# Container start: bring the SCHEMA up to date, then serve. Never the other way round.
#
# Merging to main is the deploy on this repo (.github/workflows/...AutoDeployTrigger...): the push
# builds the image and ships it to Azure Container Apps. Nothing in that path touched the database,
# and CMD went straight to `npm run start` -- so a release whose code reads a new column went live
# against a database that did not have it, and every page touching that model threw. That is not a
# degraded feature, it is an outage: Prisma emits the full column list for a findMany, so one missing
# column takes down every query on the model. scripts/migrate-deploy.mjs has said so in its header
# from the start; the pipeline simply had no way to honour it.
#
# `migrate deploy` applies pending migrations and nothing else -- it never resets, never generates,
# and refuses to touch a drifted database rather than guessing. It takes a Postgres advisory lock, so
# several replicas starting at once serialize instead of racing.
#
# set -e: a migration that fails must STOP the container. Container Apps keeps the previous revision
# serving traffic until the new one is healthy, so failing closed here means the old, working release
# stays up. Starting the server anyway would ship exactly the broken state this script exists to stop.
#
# migrate-deploy.mjs is NOT used here: it resolves POSTGRES_* from the repo-root env file, which does
# not exist in the image. In the container Azure supplies DATABASE_URL directly, which is what the
# Prisma CLI reads.
set -e

echo "entrypoint: applying pending database migrations…"
npx prisma migrate deploy

echo "entrypoint: migrations current — starting the server"
# exec so the server becomes PID 1 and receives Container Apps' SIGTERM on revision stop; as a child
# of this shell it would never see the signal and would be SIGKILLed after the grace period.
exec npm run start -- -H 0.0.0.0 -p 3000
