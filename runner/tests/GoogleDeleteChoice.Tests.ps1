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
    It 'holds the delete (suspends and warns) when a Drive transfer was requested' {
        Mock Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace -MockWith $script:Api
        $r = Invoke-CtgGoogleOffboarding -User $script:User -Config ([pscustomobject]@{ deleteUser = $true; transferTarget = 'boss@brightonpark.com'; signOut = $false })
        Should -Invoke Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace -Times 0 -Exactly -ParameterFilter { $Method -eq 'DELETE' -and $Path -eq '/users/jdoe@brightonpark.com' }
        ($r.Actions -join "`n") | Should -Match 'WARN delete held'
    }
    It 'never deletes by default' {
        Mock Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace -MockWith $script:Api
        $null = Invoke-CtgGoogleOffboarding -User $script:User -Config ([pscustomobject]@{ signOut = $false })
        Should -Invoke Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace -Times 0 -Exactly -ParameterFilter { $Method -eq 'DELETE' -and $Path -eq '/users/jdoe@brightonpark.com' }
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
}
