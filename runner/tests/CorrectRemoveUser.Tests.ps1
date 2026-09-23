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

# ── Review fixes ──────────────────────────────────────────────────────────────────────────────────────
# The app no longer moves the case to the corrected identity until every correction job has succeeded,
# so a Remove (or a re-run correction) can meet an account under EITHER name. config.knownIdentities
# carries every identity the case has given the user; executors try them all, and a Remove that finds
# nothing says WARN instead of reporting a clean success.
Describe 'review fix: Remove searches every identity the case gave the user' {
    BeforeAll {
        $script:Known = [pscustomobject]@{ knownIdentities = @(
                [pscustomobject]@{ SamAccountName = 'jsmyth'; UserPrincipalName = 'jsmyth@acme.com' },
                [pscustomobject]@{ SamAccountName = 'jsmith'; UserPrincipalName = 'jsmith@acme.com' }) }
    }
    It 'AD: deletes the account under its CORRECTED name when the old one is gone' {
        Mock Get-ADUser -ModuleName Coretelligent.ActiveDirectory { $null }
        Mock Get-ADUser -ModuleName Coretelligent.ActiveDirectory -ParameterFilter { $Identity -eq 'jsmith' } { [pscustomobject]@{ SamAccountName = 'jsmith'; DistinguishedName = 'CN=John Smith,DC=acme,DC=com'; MemberOf = @() } }
        Mock Remove-ADObject -ModuleName Coretelligent.ActiveDirectory { }
        $null = Invoke-CtgADRemoveUser -User $script:Case -Config $script:Known
        Should -Invoke Remove-ADObject -ModuleName Coretelligent.ActiveDirectory -Times 1 -Exactly -ParameterFilter { $Identity -eq 'CN=John Smith,DC=acme,DC=com' }
    }
    It 'AD: found under none of them is a WARN, not a clean success' {
        Mock Get-ADUser -ModuleName Coretelligent.ActiveDirectory { $null }
        Mock Remove-ADObject -ModuleName Coretelligent.ActiveDirectory { }
        $r = Invoke-CtgADRemoveUser -User $script:Case -Config $script:Known
        Should -Invoke Remove-ADObject -ModuleName Coretelligent.ActiveDirectory -Times 0 -Exactly
        ($r.Actions -join ' ') | Should -Match '^WARN .*jsmith@acme\.com'
    }
    It 'M365: deletes the account under its corrected UPN when the old one is gone' {
        Mock Get-MgUser -ModuleName Coretelligent.M365 { $null }
        Mock Get-MgUser -ModuleName Coretelligent.M365 -ParameterFilter { $UserId -eq 'jsmith@acme.com' } { [pscustomobject]@{ Id = 'u2'; UserPrincipalName = 'jsmith@acme.com'; OnPremisesSyncEnabled = $null } }
        Mock Remove-MgUser -ModuleName Coretelligent.M365 { }
        Mock Remove-MgDirectoryDeletedItem -ModuleName Coretelligent.M365 { }
        $r = Invoke-CtgM365RemoveUser -User $script:Case -Config $script:Known
        Should -Invoke Remove-MgUser -ModuleName Coretelligent.M365 -Times 1 -Exactly -ParameterFilter { $UserId -eq 'u2' }
        ($r.Actions -join ' ') | Should -Match 'deleted Entra user jsmith@acme\.com'
    }
    It 'M365: found under none of them is a WARN' {
        Mock Get-MgUser -ModuleName Coretelligent.M365 { $null }
        Mock Remove-MgUser -ModuleName Coretelligent.M365 { }
        $r = Invoke-CtgM365RemoveUser -User $script:Case -Config $script:Known
        Should -Invoke Remove-MgUser -ModuleName Coretelligent.M365 -Times 0 -Exactly
        ($r.Actions -join ' ') | Should -Match '^WARN '
    }
    It 'Google: deletes the account under its corrected address, by its primary email' {
        Mock Get-CtgGoogleUser -ModuleName Coretelligent.GoogleWorkspace { $null }
        Mock Get-CtgGoogleUser -ModuleName Coretelligent.GoogleWorkspace -ParameterFilter { $Email -eq 'jsmith@acme.com' } { [pscustomobject]@{ primaryEmail = 'jsmith@acme.com' } }
        Mock Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace { }
        $null = Invoke-CtgGoogleRemoveUser -User $script:Case -Config $script:Known
        Should -Invoke Invoke-CtgGoogleApi -ModuleName Coretelligent.GoogleWorkspace -Times 1 -Exactly -ParameterFilter { $Method -eq 'DELETE' -and $Path -eq '/users/jsmith@acme.com' }
    }
}

Describe 'review fix: a correction re-run after a partial first run' {
    It 'AD: finds the account under the corrected sam and reports it already correct' {
        Mock Get-ADUser -ModuleName Coretelligent.ActiveDirectory { $null }
        Mock Get-ADUser -ModuleName Coretelligent.ActiveDirectory -ParameterFilter { $Identity -eq 'jsmith' } {
            [pscustomobject]@{ SamAccountName = 'jsmith'; DistinguishedName = 'CN=John Smith,DC=acme,DC=com'; GivenName = 'John'; Surname = 'Smith'; DisplayName = 'John Smith'; Name = 'John Smith'
                UserPrincipalName = 'jsmith@acme.com'; mail = 'jsmith@acme.com'; proxyAddresses = @('SMTP:jsmith@acme.com', 'smtp:jsmyth@acme.com') }
        }
        Mock Set-ADUser -ModuleName Coretelligent.ActiveDirectory { }
        Mock Rename-ADObject -ModuleName Coretelligent.ActiveDirectory { }
        $r = Invoke-CtgADCorrectUser -User $script:Case -Config ([pscustomobject]@{ lastName = 'Smith'; displayName = 'John Smith'; newUpn = 'jsmith@acme.com'; newSam = 'jsmith' })
        Should -Invoke Set-ADUser -ModuleName Coretelligent.ActiveDirectory -Times 0 -Exactly
        ($r.Actions -join ' ') | Should -Match 'already correct'
    }
    It 'M365: an account the first run already renamed is found by the new UPN and is already correct' {
        Mock Get-MgUser -ModuleName Coretelligent.M365 { $null }
        Mock Get-MgUser -ModuleName Coretelligent.M365 -ParameterFilter { $UserId -eq 'jsmith@acme.com' } { [pscustomobject]@{ Id = 'u1'; UserPrincipalName = 'jsmith@acme.com'; GivenName = 'John'; Surname = 'Smith'; DisplayName = 'John Smyth'; OnPremisesSyncEnabled = $null } }
        Mock Update-MgUser -ModuleName Coretelligent.M365 { }
        $r = Invoke-CtgM365CorrectUser -User $script:Case -Config ([pscustomobject]@{ lastName = 'Smith'; newUpn = 'jsmith@acme.com' })
        Should -Invoke Update-MgUser -ModuleName Coretelligent.M365 -Times 0 -Exactly
        ($r.Actions -join ' ') | Should -Match 'already correct'
    }
    It 'M365: a synced user that directory sync already renamed is left to AD, not a failure' {
        Mock Get-MgUser -ModuleName Coretelligent.M365 { $null }
        Mock Get-MgUser -ModuleName Coretelligent.M365 -ParameterFilter { $UserId -eq 'jsmith@acme.com' } { [pscustomobject]@{ Id = 'u1'; UserPrincipalName = 'jsmith@acme.com'; OnPremisesSyncEnabled = $true } }
        Mock Update-MgUser -ModuleName Coretelligent.M365 { }
        $r = Invoke-CtgM365CorrectUser -User $script:Case -Config ([pscustomobject]@{ newUpn = 'jsmith@acme.com' })
        Should -Invoke Update-MgUser -ModuleName Coretelligent.M365 -Times 0 -Exactly
        ($r.Actions -join ' ') | Should -Match 'synced from AD'
    }
    It 'M365: a UPN that differs only in case is already at the target' {
        Mock Get-MgUser -ModuleName Coretelligent.M365 { [pscustomobject]@{ Id = 'u1'; UserPrincipalName = 'JSmith@acme.com'; OnPremisesSyncEnabled = $null } }
        Mock Update-MgUser -ModuleName Coretelligent.M365 { }
        $null = Invoke-CtgM365CorrectUser -User $script:Case -Config ([pscustomobject]@{ newUpn = 'jsmith@acme.com' })
        Should -Invoke Update-MgUser -ModuleName Coretelligent.M365 -Times 0 -Exactly
    }
}

Describe 'review fix: the Exchange address correction' {
    It 'a mailbox-optional job (queued off the M365 line) warns when the user has no mailbox' {
        Mock Get-Mailbox -ModuleName Coretelligent.Exchange { $null }
        Mock Set-Mailbox -ModuleName Coretelligent.Exchange { }
        $r = Invoke-CtgExchangeCorrectAddress -User $script:Case -Config ([pscustomobject]@{ newUpn = 'jsmith@acme.com'; mailboxOptional = $true })
        Should -Invoke Set-Mailbox -ModuleName Coretelligent.Exchange -Times 0 -Exactly
        ($r.Actions -join ' ') | Should -Match '^WARN no Exchange Online mailbox'
    }
    It 'a planned exchange line with no mailbox still fails' {
        Mock Get-Mailbox -ModuleName Coretelligent.Exchange { $null }
        { Invoke-CtgExchangeCorrectAddress -User $script:Case -Config ([pscustomobject]@{ newUpn = 'jsmith@acme.com' }) } | Should -Throw '*mailbox not found*'
    }
}

# Start-IamRunner.ps1 isn't dot-sourceable: lift the exchange-correct-user handler literal out of it
# via the AST and exercise it against a stub exchange lane.
Describe 'review fix: the exchange-correct-user runner lane' {
    BeforeAll {
        $path = Join-Path (Split-Path $PSScriptRoot -Parent) 'Start-IamRunner.ps1'
        $ast = [System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$null, [ref]$null)
        $assign = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq "`$DISPATCH['exchange-correct-user']" }, $true) | Select-Object -First 1
        $assign | Should -Not -BeNullOrEmpty
        $global:CtgTestSeenCreds = $null
        $global:DISPATCH = @{ exchange = @{ Connect = { param($job, $creds) $global:CtgTestSeenCreds = $creds } } }
        $script:Handler = & ([scriptblock]::Create($assign.Right.Extent.Text))
    }
    AfterAll { Remove-Variable -Name DISPATCH, CtgTestSeenCreds -Scope Global -ErrorAction SilentlyContinue }
    It 'connects to Exchange Online only — never the on-prem Exchange session (hybrid)' {
        $creds = @{ 'm365-admin' = 'exo'; 'exchange-onprem' = 'onprem' }
        & $script:Handler.Connect ([pscustomobject]@{ id = 'j' }) $creds
        $global:CtgTestSeenCreds | Should -Not -BeNullOrEmpty
        $global:CtgTestSeenCreds.ContainsKey('m365-admin') | Should -BeTrue
        $global:CtgTestSeenCreds.ContainsKey('exchange-onprem') | Should -BeFalse
        $creds.ContainsKey('exchange-onprem') | Should -BeTrue -Because 'the job''s own brokered creds are not mutated'
    }
    It 'closes its Exchange Online session when the job ends' {
        $script:Handler.ContainsKey('Disconnect') | Should -BeTrue
        $script:Handler.Disconnect.ToString() | Should -Match 'Disconnect-CtgExchange'
    }
}
