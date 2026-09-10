-- The browser-sidecar install runs as a background job on the runner, so the app could only infer the
-- outcome from whether the 'browser' capability appeared. When it did not, the reason was written to
-- the runner's local log and thrown away. Carry it on the heartbeat like migrateError.
ALTER TABLE "Agent" ADD COLUMN "browserInstallError" TEXT;
