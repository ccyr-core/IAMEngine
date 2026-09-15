# FR #0000170: "This error appears on a lot of different cases, even ones with the correct permission
# attached."
#
# The data says the warning is TRUE, and says something the message does not. Across 553 offboard
# m365/entra jobs, 36 carry this denial, spread over 9 clients -- and 8 of those 9 were denied on
# EVERY attempt and succeeded zero times. A privileged-target cause would show mixed results inside a
# client; all-or-nothing per tenant means the grant really is absent there. core1347 is the lone
# mixed one: DENIED 2026-08-21, REMOVED 2026-08-31, i.e. it resolved once someone acted.
#
# What the message gets wrong is the REMEDY. It offers "re-run this step after it reconnects", but a
# re-run cannot clear a stale token: the runner connects once per tenant and reuses that token, so the
# second attempt presents exactly the token that was refused. Worse, the runner HAS an automatic fix
# for this -- Start-IamRunner.ps1 drops the Graph session and retries once on
# Authorization_RequestDenied -- and this path can never reach it, because the MFA block deliberately
# does not rethrow (so a missing permission cannot fail the whole offboard). The one self-heal built
# for this error is structurally unreachable from the one place that most needs it.
BeforeAll {
    $Root = Split-Path $PSScriptRoot -Parent
    $script:M365 = Get-Content "$Root/modules/Coretelligent.M365/Coretelligent.M365.psm1" -Raw
    $script:Runner = Get-Content "$Root/Start-IamRunner.ps1" -Raw
    $m = [regex]::Match($script:M365, "WARN MFA methods NOT removed[^`"]*UserAuthenticationMethod[^`"]*")
    $m.Success | Should -BeTrue -Because 'the permission-denied MFA hint must exist'
    $script:Hint = $m.Value
}

Describe 'the MFA-denied hint' {
    It 'still names the permission to grant' {
        $script:Hint | Should -Match 'UserAuthenticationMethod\.ReadWrite\.All'
    }

    It 'does not tell the operator that re-running the step will clear a stale token' {
        # It cannot: the runner reuses the per-tenant token, so a re-run presents the refused one again.
        # This is the sentence FR #0000170 acted on and got nowhere with.
        $script:Hint | Should -Not -Match 're-run this step after it reconnects'
    }

    It 'names the restart as the thing that actually refreshes the token' {
        $script:Hint | Should -Match 'restart'
    }

    It 'says which of the two causes to check first, rather than listing both flatly' {
        # 8 of the 9 affected clients had never succeeded once: absent grant is far the likelier cause,
        # and the message should rank them instead of leaving the operator to guess.
        $script:Hint | Should -Match 'check the grant first|most often|usually'
    }
}

Describe 'the stale-token self-heal cannot see this denial' {
    It 'the MFA block swallows the error instead of rethrowing' {
        # Documents WHY the self-heal never fires here, so the next person does not assume it does.
        # Deliberate (a missing grant must not fail the offboard) but it has a cost worth recording.
        $script:M365 | Should -Match 'deliberately do NOT rethrow'
    }

    It 'the self-heal it cannot reach is gated on the exception propagating' {
        $script:Runner | Should -Match 'RequestDenied — refreshing the Graph token'
    }
}
