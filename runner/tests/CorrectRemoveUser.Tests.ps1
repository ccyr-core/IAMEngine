# FR #0000088: correct (names / username / email) or hard-remove a user THIS engine created.
BeforeAll {
    # Thin stubs for cmdlets that aren't on a test host, so Pester can Mock them in module scope.
    function global:Get-ADUser { [CmdletBinding()] param($Identity, $Filter, $Properties, $Server, $Credential) }
    function global:Set-ADUser { [CmdletBinding()] param($Identity, $GivenName, $Surname, $DisplayName, $UserPrincipalName, $SamAccountName, $Replace, $Server, $Credential) }
    function global:Rename-ADObject { [CmdletBinding()] param($Identity, $NewName, $Server, $Credential) }
    function global:Remove-ADObject { [CmdletBinding()] param($Identity, [switch]$Recursive, [switch]$Confirm, $Server, $Credential) }
    function global:Get-MgUser { param($UserId, $Property) }
    function global:Remove-MgUser { param($UserId) }
    function global:Remove-MgDirectoryDeletedItem { param($DirectoryObjectId) }
    function global:Update-MgUser { param($UserId, $BodyParameter) }
    function global:Get-Mailbox { param($Identity) }
    function global:Set-Mailbox { param($Identity, $WindowsEmailAddress) }
    foreach ($m in 'ActiveDirectory', 'M365', 'Exchange', 'GoogleWorkspace') {
        Import-Module "$PSScriptRoot/../modules/Coretelligent.$m/Coretelligent.$m.psm1" -Force -DisableNameChecking
    }
    $script:Case = [pscustomobject]@{ SamAccountName = 'jsmyth'; UserPrincipalName = 'jsmyth@acme.com'; DisplayName = 'John Smyth' }
}
AfterAll { foreach ($m in 'ActiveDirectory', 'M365', 'Exchange', 'GoogleWorkspace') { Remove-Module "Coretelligent.$m" -Force -ErrorAction SilentlyContinue } }

Describe 'Invoke-CtgADRemoveUser' {
    It 'deletes the account (recursively) and keeps its groups as evidence' {
        Mock Get-ADUser -ModuleName Coretelligent.ActiveDirectory { [pscustomobject]@{ SamAccountName = 'jsmyth'; DistinguishedName = 'CN=John Smyth,OU=Staff,DC=acme,DC=com'; MemberOf = @('CN=Finance,DC=acme,DC=com') } }
        Mock Remove-ADObject -ModuleName Coretelligent.ActiveDirectory { }
        $r = Invoke-CtgADRemoveUser -User $script:Case -Config ([pscustomobject]@{})
        Should -Invoke Remove-ADObject -ModuleName Coretelligent.ActiveDirectory -Times 1 -Exactly -ParameterFilter { $Identity -eq 'CN=John Smyth,OU=Staff,DC=acme,DC=com' -and $Recursive }
        $r.Evidence.Groups | Should -Contain 'CN=Finance,DC=acme,DC=com'
    }
    It 'is a no-op when the account is already gone' {
        Mock Get-ADUser -ModuleName Coretelligent.ActiveDirectory { $null }
        Mock Remove-ADObject -ModuleName Coretelligent.ActiveDirectory { }
        $r = Invoke-CtgADRemoveUser -User $script:Case -Config ([pscustomobject]@{})
        Should -Invoke Remove-ADObject -ModuleName Coretelligent.ActiveDirectory -Times 0 -Exactly
        ($r.Actions -join ' ') | Should -Match 'nothing deleted'
    }
    It 'refuses to find the user by display name alone' {
        { Invoke-CtgADRemoveUser -User ([pscustomobject]@{ DisplayName = 'John Smyth' }) -Config ([pscustomobject]@{}) } | Should -Throw '*refusing to look the user up by display name*'
    }
}

Describe 'Invoke-CtgADCorrectUser' {
    It 'fixes the names, renames the object, and moves the UPN keeping the old address as an alias' {
        Mock Get-ADUser -ModuleName Coretelligent.ActiveDirectory {
            [pscustomobject]@{ SamAccountName = 'jsmyth'; DistinguishedName = 'CN=John Smyth,OU=Staff,DC=acme,DC=com'; GivenName = 'John'; Surname = 'Smyth'; DisplayName = 'John Smyth'; Name = 'John Smyth'
                UserPrincipalName = 'jsmyth@acme.com'; mail = 'jsmyth@acme.com'; proxyAddresses = @('SMTP:jsmyth@acme.com', 'smtp:jsmyth@acme.onmicrosoft.com') }
        }
        Mock Set-ADUser -ModuleName Coretelligent.ActiveDirectory { }
        Mock Rename-ADObject -ModuleName Coretelligent.ActiveDirectory { }
        $r = Invoke-CtgADCorrectUser -User $script:Case -Config ([pscustomobject]@{ lastName = 'Smith'; displayName = 'John Smith'; newUpn = 'jsmith@acme.com' })
        Should -Invoke Set-ADUser -ModuleName Coretelligent.ActiveDirectory -ParameterFilter { $Surname -eq 'Smith' -and $DisplayName -eq 'John Smith' } -Times 1 -Exactly
        Should -Invoke Rename-ADObject -ModuleName Coretelligent.ActiveDirectory -ParameterFilter { $NewName -eq 'John Smith' } -Times 1 -Exactly
        Should -Invoke Set-ADUser -ModuleName Coretelligent.ActiveDirectory -Times 1 -Exactly -ParameterFilter {
            $UserPrincipalName -eq 'jsmith@acme.com' -and $SamAccountName -eq 'jsmith' -and $Replace.mail -eq 'jsmith@acme.com' -and
            $Replace.proxyAddresses[0] -ceq 'SMTP:jsmith@acme.com' -and ($Replace.proxyAddresses -ccontains 'smtp:jsmyth@acme.com')
        }
        ($r.Actions -join ' ') | Should -Match 'old address stays as an alias'
    }
    It 'says so when there is nothing to change' {
        Mock Get-ADUser -ModuleName Coretelligent.ActiveDirectory { [pscustomobject]@{ SamAccountName = 'jsmyth'; DistinguishedName = 'CN=John Smyth,DC=acme,DC=com'; GivenName = 'John'; Surname = 'Smyth'; DisplayName = 'John Smyth'; Name = 'John Smyth'; UserPrincipalName = 'jsmyth@acme.com'; mail = $null; proxyAddresses = @() } }
        Mock Set-ADUser -ModuleName Coretelligent.ActiveDirectory { }
        $r = Invoke-CtgADCorrectUser -User $script:Case -Config ([pscustomobject]@{ firstName = 'John' })
        Should -Invoke Set-ADUser -ModuleName Coretelligent.ActiveDirectory -Times 0 -Exactly
        ($r.Actions -join ' ') | Should -Match 'already correct'
    }
}

Describe 'M365 correct / remove' {
    It 'removes and permanently purges a cloud-mastered user' {
        Mock Get-MgUser -ModuleName Coretelligent.M365 { [pscustomobject]@{ Id = 'u1'; UserPrincipalName = 'jsmyth@acme.com'; OnPremisesSyncEnabled = $null } }
        Mock Remove-MgUser -ModuleName Coretelligent.M365 { }
        Mock Remove-MgDirectoryDeletedItem -ModuleName Coretelligent.M365 { }
        $r = Invoke-CtgM365RemoveUser -User $script:Case -Config ([pscustomobject]@{})
        Should -Invoke Remove-MgUser -ModuleName Coretelligent.M365 -Times 1 -Exactly -ParameterFilter { $UserId -eq 'u1' }
        Should -Invoke Remove-MgDirectoryDeletedItem -ModuleName Coretelligent.M365 -Times 1 -Exactly -ParameterFilter { $DirectoryObjectId -eq 'u1' }
        ($r.Actions -join ' ') | Should -Match 'permanently purged'
    }
    It 'leaves an AD-synced user to the AD step, for both remove and correct' {
        Mock Get-MgUser -ModuleName Coretelligent.M365 { [pscustomobject]@{ Id = 'u1'; UserPrincipalName = 'jsmyth@acme.com'; OnPremisesSyncEnabled = $true } }
        Mock Remove-MgUser -ModuleName Coretelligent.M365 { }
        Mock Update-MgUser -ModuleName Coretelligent.M365 { }
        $null = Invoke-CtgM365RemoveUser -User $script:Case -Config ([pscustomobject]@{})
        $null = Invoke-CtgM365CorrectUser -User $script:Case -Config ([pscustomobject]@{ newUpn = 'jsmith@acme.com' })
        Should -Invoke Remove-MgUser -ModuleName Coretelligent.M365 -Times 0 -Exactly
        Should -Invoke Update-MgUser -ModuleName Coretelligent.M365 -Times 0 -Exactly
    }
    It 'updates only what differs on a cloud user' {
        Mock Get-MgUser -ModuleName Coretelligent.M365 { [pscustomobject]@{ Id = 'u1'; UserPrincipalName = 'jsmyth@acme.com'; GivenName = 'John'; Surname = 'Smyth'; DisplayName = 'John Smyth'; OnPremisesSyncEnabled = $null } }
        Mock Update-MgUser -ModuleName Coretelligent.M365 { }
        $null = Invoke-CtgM365CorrectUser -User $script:Case -Config ([pscustomobject]@{ firstName = 'John'; lastName = 'Smith'; newUpn = 'jsmith@acme.com' })
        Should -Invoke Update-MgUser -ModuleName Coretelligent.M365 -Times 1 -Exactly -ParameterFilter { $BodyParameter.surname -eq 'Smith' -and $BodyParameter.userPrincipalName -eq 'jsmith@acme.com' -and -not $BodyParameter.ContainsKey('givenName') }
    }
}

Describe 'Invoke-CtgExchangeCorrectAddress' {
    It 'moves the primary address on a cloud mailbox' {
        Mock Get-Mailbox -ModuleName Coretelligent.Exchange { [pscustomobject]@{ Identity = 'jsmyth'; PrimarySmtpAddress = 'jsmyth@acme.com'; IsDirSynced = $false } }
        Mock Set-Mailbox -ModuleName Coretelligent.Exchange { }
        $null = Invoke-CtgExchangeCorrectAddress -User $script:Case -Config ([pscustomobject]@{ newUpn = 'jsmith@acme.com' })
        Should -Invoke Set-Mailbox -ModuleName Coretelligent.Exchange -Times 1 -Exactly -ParameterFilter { $WindowsEmailAddress -eq 'jsmith@acme.com' }
    }
    It 'leaves a synced mailbox to AD' {
        Mock Get-Mailbox -ModuleName Coretelligent.Exchange { [pscustomobject]@{ Identity = 'jsmyth'; PrimarySmtpAddress = 'jsmyth@acme.com'; IsDirSynced = $true } }
        Mock Set-Mailbox -ModuleName Coretelligent.Exchange { }
        $null = Invoke-CtgExchangeCorrectAddress -User $script:Case -Config ([pscustomobject]@{ newUpn = 'jsmith@acme.com' })
        Should -Invoke Set-Mailbox -ModuleName Coretelligent.Exchange -Times 0 -Exactly
    }
}

Describe 'Google correct / remove' {
    It 'deletes the user, and says Google keeps it 20 days' {
        Mock Get-CtgGoogleUser -ModuleName Coretelligent.GoogleWorkspace { [pscustomobject]@{ primaryEmail = 'jsmyth@acme.com' } }
        Mock Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace { }
        $r = Invoke-CtgGoogleRemoveUser -User $script:Case -Config ([pscustomobject]@{})
        Should -Invoke Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace -Times 1 -Exactly -ParameterFilter { $Method -eq 'DELETE' -and $Path -eq '/users/jsmyth@acme.com' }
        ($r.Actions -join ' ') | Should -Match '20 days'
    }
    It 'renames the primary email and fixes the surname in one update' {
        Mock Get-CtgGoogleUser -ModuleName Coretelligent.GoogleWorkspace { [pscustomobject]@{ primaryEmail = 'jsmyth@acme.com'; name = [pscustomobject]@{ givenName = 'John'; familyName = 'Smyth' } } }
        Mock Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace { }
        $null = Invoke-CtgGoogleCorrectUser -User $script:Case -Config ([pscustomobject]@{ firstName = 'John'; lastName = 'Smith'; newUpn = 'jsmith@acme.com' })
        Should -Invoke Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace -Times 1 -Exactly -ParameterFilter { $Method -eq 'PUT' -and $Path -eq '/users/jsmyth@acme.com' -and $Body.primaryEmail -eq 'jsmith@acme.com' -and $Body.name.familyName -eq 'Smith' -and -not $Body.name.ContainsKey('givenName') }
    }
}
