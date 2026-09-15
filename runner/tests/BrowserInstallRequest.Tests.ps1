# "Install browser automation" is a ONE-SHOT delivery: runner-service.ts consumes
# browserInstallRequested in the same statement that stamps browserInstallDeliveredAt, and never
# re-emits it. The runner handled it AFTER the update and restart branches -- both of which end in
# Invoke-CtgRelaunch and never return. So a click that landed on the same heartbeat as an update was
# consumed server-side and thrown away: delivered, never acted on, no error, capability never appears.
# The Agents page then said "installed but this runner still does not report it" forever.
#
# Start-IamRunner.ps1 already solves this exact hazard for provisionToken by handling it FIRST, with a
# comment explaining why. The same reasoning was never extended here.
#
# Ordering alone is not enough: the install is a Start-Job child and dies with its parent, so an
# update landing seconds later still kills it. The request is therefore persisted to disk the moment
# it arrives, and startup resumes it -- which also covers a relaunch mid-download.
BeforeAll {
    $Root = Split-Path $PSScriptRoot -Parent
    $script:Runner = Get-Content "$Root/Start-IamRunner.ps1" -Raw

    foreach ($fn in 'Get-CtgBrowserRequestPath', 'Set-CtgBrowserInstallRequest',
                    'Test-CtgBrowserInstallRequest', 'Clear-CtgBrowserInstallRequest') {
        $m = [regex]::Match($script:Runner, "(?ms)^function $([regex]::Escape($fn)) \{.*?^\}")
        $m.Success | Should -BeTrue -Because "Start-IamRunner.ps1 must declare $fn"
        . ([scriptblock]::Create($m.Value))
    }
}

Describe 'the browser-install request survives a relaunch' {
    It 'is claimed BEFORE the update branch, which never returns' {
        # provisionToken is already ordered this way for the same reason; installBrowser must be too.
        $claim  = $script:Runner.IndexOf('Set-CtgBrowserInstallRequest')
        $update = $script:Runner.IndexOf('if ($hb.update -eq $true)')
        $claim | Should -BeGreaterThan -1
        $update | Should -BeGreaterThan -1
        ($claim -lt $update) | Should -BeTrue -Because 'Update-CtgRunner never returns, so anything after it is discarded'
    }

    It 'is written to disk, not just held in memory' {
        # The install is a Start-Job child: it dies with the process. Memory is not durable enough.
        Set-CtgBrowserInstallRequest -RunnerDir $TestDrive -AgentId 'agent1'
        Test-CtgBrowserInstallRequest -RunnerDir $TestDrive -AgentId 'agent1' | Should -BeTrue
    }

    It 'is per agent, so one runner cannot consume another runner request' {
        Set-CtgBrowserInstallRequest -RunnerDir $TestDrive -AgentId 'agent1'
        Test-CtgBrowserInstallRequest -RunnerDir $TestDrive -AgentId 'agent2' | Should -BeFalse
    }

    It 'is a dot-entry, so it moves neither the build id nor survives as bundle drift' {
        # The same lesson as inflight.json: a bare filename in the runner folder is hashed into the
        # build id and deleted by the self-update prune.
        $p = Get-CtgBrowserRequestPath -RunnerDir $TestDrive -AgentId 'agent1'
        [System.IO.Path]::GetFileName($p).StartsWith('.') | Should -BeTrue
    }

    It 'is cleared once the sidecar is actually installed' {
        Set-CtgBrowserInstallRequest -RunnerDir $TestDrive -AgentId 'agent1'
        Clear-CtgBrowserInstallRequest -RunnerDir $TestDrive -AgentId 'agent1'
        Test-CtgBrowserInstallRequest -RunnerDir $TestDrive -AgentId 'agent1' | Should -BeFalse
    }

    It 'reports no pending request on a clean host' {
        Test-CtgBrowserInstallRequest -RunnerDir $TestDrive -AgentId 'never-asked' | Should -BeFalse
    }

    It 'startup resumes a persisted request with the Node bootstrap' {
        # The whole point of the operator click is a host with NO node -- the plain startup self-heal
        # is gated on Resolve-CtgNodeTool and can never fire there. A resumed request must bootstrap.
        $startup = $script:Runner.Substring($script:Runner.IndexOf('Self-heal the browser sidecar ONCE at startup'))
        $startup = $startup.Substring(0, 3000)
        $startup | Should -Match 'Test-CtgBrowserInstallRequest'
        $startup | Should -Match 'Install-CtgBrowser -BootstrapNode'
    }
}
