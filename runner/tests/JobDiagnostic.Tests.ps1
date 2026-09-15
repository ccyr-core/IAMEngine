# The browser-sidecar install runs as a background job, and the runner reports why it failed. Except
# it did not: the completion block did
#
#     $out = Receive-Job -Job $j -ErrorAction SilentlyContinue 2>&1
#     $detail = (@($out) | Where-Object { $_ } | ... ) -join ' | '
#
# and Install-CtgBrowser reports through Write-Warning and Write-Host. Neither reaches Receive-Job's
# success output: `2>&1` merges the ERROR stream only, while warnings and Write-Host land in the job's
# Warning and Information streams and are re-emitted to the host, not returned. The ONE thing that did
# come back was the scriptblock's `[bool]` return value -- and on a failed install that is $false,
# which `Where-Object { $_ }` then drops as falsy.
#
# So $detail was ALWAYS empty for a failed install and the agent reported the fallback, "the install
# job finished without a usable sidecar and gave no output", every single time. core1748 hit that on
# 2026-09-15. The fix that was supposed to stop the runner discarding the reason discarded it one
# layer further down.
#
# These tests start real background jobs. They are slower than the rest of the suite on purpose:
# mocking the job streams is what let this ship in the first place.
BeforeAll {
    $Root = Split-Path $PSScriptRoot -Parent
    $script:Runner = Get-Content "$Root/Start-IamRunner.ps1" -Raw

    $m = [regex]::Match($script:Runner, '(?ms)^function Get-CtgJobDiagnostic \{.*?^\}')
    $m.Success | Should -BeTrue -Because 'Start-IamRunner.ps1 must declare Get-CtgJobDiagnostic'
    . ([scriptblock]::Create($m.Value))

    function script:RunJob([scriptblock]$Body) {
        $j = Start-Job -ScriptBlock $Body
        $null = Wait-Job $j
        $d = Get-CtgJobDiagnostic -Job $j
        Remove-Job $j -Force -ErrorAction SilentlyContinue
        return $d
    }
}

Describe 'Get-CtgJobDiagnostic' {
    It 'captures a Write-Warning reason, which is how Install-CtgBrowser reports failure' {
        $d = RunJob { Write-Warning 'browser sidecar: npm install failed (1): ETIMEDOUT registry.npmjs.org'; [bool]$false }
        $d | Should -Match 'ETIMEDOUT'
    }

    It 'captures Write-Host progress, which says how far the install got' {
        $d = RunJob { Write-Host 'browser sidecar: downloading Chromium (playwright install chromium) …'; [bool]$false }
        $d | Should -Match 'Chromium'
    }

    It 'captures a terminating error from inside the job' {
        $d = RunJob { throw 'portable Node install failed: connection refused' }
        $d | Should -Match 'connection refused'
    }

    It 'does not report the scriptblock return value as if it were a reason' {
        # The old code captured ONLY this, then dropped it for being falsy. "False" is not a diagnosis.
        $d = RunJob { Write-Warning 'the real reason'; [bool]$false }
        $d | Should -Not -Match 'False'
        $d | Should -Match 'the real reason'
    }

    It 'returns empty when the job genuinely said nothing, so the fallback still has a job to do' {
        $d = RunJob { [bool]$false }
        $d | Should -BeNullOrEmpty
    }

    It 'keeps the LAST lines, which is where the failure is' {
        $d = RunJob {
            1..10 | ForEach-Object { Write-Host "step $_" }
            Write-Warning 'browser sidecar: Chromium install failed (13)'
            [bool]$false
        }
        $d | Should -Match 'Chromium install failed'
    }

    It 'never throws on a null or already-removed job' {
        { Get-CtgJobDiagnostic -Job $null } | Should -Not -Throw
    }
}
