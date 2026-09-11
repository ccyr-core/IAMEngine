-- The ExchangeOnlineManagement pin (3.9.2) self-heals at startup, but that install ran INSIDE the
-- runner process, where PowerShellGet refuses while PackageManagement is loaded. It failed on every
-- startup on core1748 and reported only via a Write-Warning, which a Windows SYSTEM scheduled task
-- discards. The agent then loaded 3.10.0 and every Exchange job died on 'GetResponseHeader'
-- (UM0031200). Carry the reason on the heartbeat like browserInstallError.
ALTER TABLE "Agent" ADD COLUMN "exoPinError" TEXT;
