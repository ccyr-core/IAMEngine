# FR #0000125: Brighton Park's offboard failed on "'Get-MailboxStatistics' is not recognized" right
# after a successful app-only Connect-ExchangeOnline, and the runner then tried to INSTALL a module.
#
# Exchange Online builds an app-only session from the app's RBAC role and leaves out every cmdlet the
# role doesn't grant. So a missing EXO cmdlet in a connected session is a role gap, not a missing
# module -- the module is installed; the connect just used it. Two consequences, both tested here:
#   - the connection test must check the cmdlets the lanes call, not treat "connected" as proof of
#     the Exchange Administrator role (it claimed exactly that);
#   - the missing-command handler must name the role, not attempt an install that cannot help.
BeforeAll {
    $Root = Split-Path $PSScriptRoot -Parent
    Import-Module "$Root/modules/Coretelligent.Exchange/Coretelligent.Exchange.psd1" -Force
    $script:Runner = Get-Content "$Root/Start-IamRunner.ps1" -Raw
    $script:Module = Get-Content "$Root/modules/Coretelligent.Exchange/Coretelligent.Exchange.psm1" -Raw
}

AfterAll {
    Remove-Module Coretelligent.Exchange -Force -ErrorAction SilentlyContinue
}

Describe 'Test-CtgExoCmdlet' {
    It 'knows the cmdlet that failed on Brighton Park' {
        Test-CtgExoCmdlet 'Get-MailboxStatistics' | Should -BeTrue
    }
    It 'does not claim our own functions or unrelated cmdlets' {
        Test-CtgExoCmdlet 'Get-CtgMailboxSizeGB' | Should -BeFalse
        Test-CtgExoCmdlet 'Get-MgUser' | Should -BeFalse
        Test-CtgExoCmdlet '' | Should -BeFalse
    }
    It 'does not list the on-prem RemoteMailbox cmdlets (they come from a different session)' {
        Test-CtgExoCmdlet 'Enable-RemoteMailbox' | Should -BeFalse
    }
}

Describe 'Get-CtgExoMissingCmdlet' {
    It 'reports exactly the cmdlets absent from the session' {
        function global:Get-FakeExoPresent { }
        try {
            $missing = Get-CtgExoMissingCmdlet -Name @('Get-FakeExoPresent', 'Get-FakeExoAbsentXyz')
            $missing | Should -Be @('Get-FakeExoAbsentXyz')
        }
        finally { Remove-Item function:global:Get-FakeExoPresent -ErrorAction SilentlyContinue }
    }
    It 'is empty when everything is present' {
        @(Get-CtgExoMissingCmdlet -Name @('Get-Command')).Count | Should -Be 0
    }
    It 'covers every EXO cmdlet the module calls, so the connection test cannot miss one' {
        $exo = 'Mailbox\w*|Recipient\w*|DistributionGroup\w*|UnifiedGroup\w*|CASMailbox'
        $called = [regex]::Matches($script:Module, "\b(?:Get|Set|Add|Remove|New|Enable|Disable)-(?:$exo)\b") |
            ForEach-Object Value | Where-Object { $_ -notmatch 'RemoteMailbox' } | Sort-Object -Unique
        foreach ($c in $called) { Test-CtgExoCmdlet $c | Should -BeTrue -Because "$c is called by the Exchange lanes" }
    }
}

Describe 'the runner' {
    It 'checks for an EXO role gap before trying to install a module' {
        $gap = $script:Runner.IndexOf('is not available in this Exchange Online session')
        $install = $script:Runner.IndexOf("locating + installing its module")
        $gap | Should -BeGreaterThan 0
        $gap | Should -BeLessThan $install
    }
    It 'no longer claims a connect proves the Exchange Administrator role' {
        $script:Runner | Should -Not -Match 'PROVES the app holds Exchange\.ManageAsApp \+ the\s+# Exchange Administrator role'
        $script:Runner | Should -Match 'Get-CtgExoMissingCmdlet'
    }
}
