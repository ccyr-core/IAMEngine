# FR #0000128: a case can choose DELETE instead of suspend for the Google account. The executor deletes
# last (after evidence, group removal, OU move and sign-out) and HOLDS the delete when a Drive transfer
# was requested — Google runs the transfer in the background, and deleting the owner first loses files.
BeforeAll {
    Import-Module "$PSScriptRoot/../modules/Coretelligent.GoogleWorkspace/Coretelligent.GoogleWorkspace.psm1" -Force -DisableNameChecking
    $script:User = [pscustomobject]@{ UserPrincipalName = 'jdoe@brightonpark.com' }
    $script:Api = {
        param($Method, $Path, $Body)
        if ($Method -eq 'GET' -and $Path -like '/users/*') { return [pscustomobject]@{ primaryEmail = 'jdoe@brightonpark.com' } }
        if ($Method -eq 'GET' -and $Path -like '/groups*') { return [pscustomobject]@{ groups = @() } }
        return $null
    }
}
AfterAll { Remove-Module Coretelligent.GoogleWorkspace -Force -ErrorAction SilentlyContinue }

Describe 'Invoke-CtgGoogleOffboarding — per-case delete' {
    It 'deletes the user when the case chose it, after suspending' {
        Mock Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace -MockWith $script:Api
        $r = Invoke-CtgGoogleOffboarding -User $script:User -Config ([pscustomobject]@{ deleteUser = $true; signOut = $false })
        Should -Invoke Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace -Times 1 -Exactly -ParameterFilter { $Method -eq 'DELETE' -and $Path -eq '/users/jdoe@brightonpark.com' }
        ($r.Actions -join "`n") | Should -Match 'deleted Google user'
    }
    It 'holds the delete when the transfer status cannot be read, and leaves a MANUAL checklist line' {
        Mock Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace -MockWith $script:Api
        $r = Invoke-CtgGoogleOffboarding -User $script:User -Config ([pscustomobject]@{ deleteUser = $true; transferTarget = 'boss@brightonpark.com'; signOut = $false })
        Should -Invoke Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace -Times 0 -Exactly -ParameterFilter { $Method -eq 'DELETE' -and $Path -eq '/users/jdoe@brightonpark.com' }
        ($r.Actions -join "`n") | Should -Match 'MANUAL: delete jdoe@brightonpark.com'
    }
    It 'never deletes by default' {
        Mock Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace -MockWith $script:Api
        $null = Invoke-CtgGoogleOffboarding -User $script:User -Config ([pscustomobject]@{ signOut = $false })
        Should -Invoke Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace -Times 0 -Exactly -ParameterFilter { $Method -eq 'DELETE' -and $Path -eq '/users/jdoe@brightonpark.com' }
    }
}

# Review N1: a transfer the client asks for as standing config must not turn every approved delete into
# a silent "suspended" success, and a re-run must not post the transfer again.
Describe 'Invoke-CtgGoogleOffboarding — delete held for a Drive transfer' {
    BeforeAll {
        $script:Cfg = [pscustomobject]@{ deleteUser = $true; transferTarget = 'boss@brightonpark.com'; signOut = $false }
        $script:ApiWithTransfer = {
            param($Method, $Path, $Body)
            if ($Method -eq 'GET' -and $Path -like '*/datatransfer/v1/transfers*') { return [pscustomobject]@{ dataTransfers = @([pscustomobject]@{ overallTransferStatusCode = $script:TransferCode }) } }
            if ($Method -eq 'GET' -and $Path -like '/users/*') { return [pscustomobject]@{ primaryEmail = 'jdoe@brightonpark.com'; id = '1234567890' } }
            if ($Method -eq 'GET' -and $Path -like '/groups*') { return [pscustomobject]@{ groups = @() } }
            return $null
        }
    }
    It 'while the transfer runs: no second transfer, no delete, and an automatic re-check' {
        $script:TransferCode = 'inProgress'
        Mock Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace -MockWith $script:ApiWithTransfer
        $r = Invoke-CtgGoogleOffboarding -User $script:User -Config $script:Cfg
        Should -Invoke Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace -Times 0 -Exactly -ParameterFilter { $Method -eq 'POST' -and $Path -eq '/dataTransfer' }
        Should -Invoke Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace -Times 0 -Exactly -ParameterFilter { $Method -eq 'DELETE' -and $Path -eq '/users/jdoe@brightonpark.com' }
        $r.PSObject.Properties['RetryAfterMinutes'] | Should -Not -BeNullOrEmpty
        $r.RetryAfterMinutes | Should -BeGreaterThan 0
        ($r.Actions -join "`n") | Should -Match 'MANUAL: delete'
    }
    It 'once Google reports the transfer complete: deletes, without posting it again' {
        $script:TransferCode = 'completed'
        Mock Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace -MockWith $script:ApiWithTransfer
        $r = Invoke-CtgGoogleOffboarding -User $script:User -Config $script:Cfg
        Should -Invoke Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace -Times 0 -Exactly -ParameterFilter { $Method -eq 'POST' -and $Path -eq '/dataTransfer' }
        Should -Invoke Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace -Times 1 -Exactly -ParameterFilter { $Method -eq 'DELETE' -and $Path -eq '/users/jdoe@brightonpark.com' }
        ($r.Actions -join "`n") | Should -Not -Match 'MANUAL'
    }
    It 'a failed transfer holds the delete with no automatic re-check (a human has to fix it)' {
        $script:TransferCode = 'failed'
        Mock Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace -MockWith $script:ApiWithTransfer
        $r = Invoke-CtgGoogleOffboarding -User $script:User -Config $script:Cfg
        Should -Invoke Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace -Times 0 -Exactly -ParameterFilter { $Method -eq 'DELETE' -and $Path -eq '/users/jdoe@brightonpark.com' }
        $r.PSObject.Properties['RetryAfterMinutes'] | Should -BeNullOrEmpty
        ($r.Actions -join "`n") | Should -Match 'MANUAL: delete.*FAILED'
    }
}

Describe 'Confirm-CtgGoogle — per-case delete' {
    It 'passes a chosen delete when the account is gone' {
        Mock Get-CtgGoogleUser -ModuleName Coretelligent.GoogleWorkspace -MockWith { $null }
        $v = Confirm-CtgGoogle -User $script:User -Config ([pscustomobject]@{ deleteUser = $true }) -Action offboard
        $v.ok | Should -BeTrue
    }
    It 'fails a chosen delete while the account still exists' {
        Mock Get-CtgGoogleUser -ModuleName Coretelligent.GoogleWorkspace -MockWith { [pscustomobject]@{ primaryEmail = 'jdoe@brightonpark.com'; suspended = $true } }
        $v = Confirm-CtgGoogle -User $script:User -Config ([pscustomobject]@{ deleteUser = $true }) -Action offboard
        $v.ok | Should -BeFalse
    }
    It 'fails a chosen delete that was held for a Drive transfer while the account still exists' {
        Mock Get-CtgGoogleUser -ModuleName Coretelligent.GoogleWorkspace -MockWith { [pscustomobject]@{ primaryEmail = 'jdoe@brightonpark.com'; suspended = $true; orgUnitPath = '/Email & Calendar/Inactive' } }
        $v = Confirm-CtgGoogle -User $script:User -Config ([pscustomobject]@{ deleteUser = $true; transferTarget = 'boss@brightonpark.com' }) -Action offboard
        $v.ok | Should -BeFalse
    }
}
