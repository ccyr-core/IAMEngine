# FR #0000118: remove a leaver from SharePoint SITE groups on every site, and mirror a reference user's
# site groups on onboard. PnP.PowerShell isn't on a test host, so its cmdlets are thin global stubs,
# mocked in the module scope.
BeforeAll {
    # Advanced (CmdletBinding), as real cmdlets are, so they take -ErrorAction.
    function global:Connect-PnPOnline { [CmdletBinding()] param($Url, $ClientId, $Tenant, $CertificatePath, $CertificatePassword, $Thumbprint) }
    function global:Get-PnPTenantSite { [CmdletBinding()] param() }
    function global:Get-PnPUser { [CmdletBinding()] param($Identity) }
    function global:Get-PnPGroup { [CmdletBinding()] param() }
    function global:Get-PnPGroupMember { [CmdletBinding()] param($Group) }
    function global:Remove-PnPGroupMember { [CmdletBinding()] param($Group, $LoginName) }
    function global:Add-PnPGroupMember { [CmdletBinding()] param($Group, $LoginName) }
    # The runner's global progress poster, and Graph — both called by the module when present.
    function global:Send-CtgProgress { param([string]$Message) }
    function global:Get-MgUser { [CmdletBinding()] param($Filter, $Top, $All, $ConsistencyLevel, $Property, $UserId) }
    Import-Module "$PSScriptRoot/../modules/Coretelligent.SharePoint/Coretelligent.SharePoint.psm1" -Force -DisableNameChecking
    $script:Cert = @{ CertificateThumbprint = 'AB' }
}
AfterAll { Remove-Module Coretelligent.SharePoint -Force -ErrorAction SilentlyContinue }

Describe 'Get-CtgSharePointSiteUrls' {
    It 'lists team/communication sites, drops OneDrives and system sites, and caches per tenant' {
        Mock Connect-PnPOnline -ModuleName Coretelligent.SharePoint { }
        Mock Get-PnPTenantSite -ModuleName Coretelligent.SharePoint {
            @(
                [pscustomobject]@{ Url = 'https://contoso.sharepoint.com/sites/Finance'; Template = 'GROUP#0' },
                [pscustomobject]@{ Url = 'https://contoso-my.sharepoint.com/personal/a_contoso_com'; Template = 'SPSPERS#10' },
                [pscustomobject]@{ Url = 'https://contoso.sharepoint.com/search'; Template = 'SRCHCEN#0' },
                [pscustomobject]@{ Url = 'https://contoso.sharepoint.com/sites/HR'; Template = 'SITEPAGEPUBLISHING#0' }
            )
        }
        InModuleScope Coretelligent.SharePoint { $script:CtgSiteCache = @{} }
        $a = Get-CtgSharePointSiteUrls -AdminUrl 'https://contoso-admin.sharepoint.com' -AppId 'app' -Tenant 'contoso.com' -CertArgs $script:Cert
        $b = Get-CtgSharePointSiteUrls -AdminUrl 'https://contoso-admin.sharepoint.com' -AppId 'app' -Tenant 'contoso.com' -CertArgs $script:Cert
        $a | Should -Be @('https://contoso.sharepoint.com/sites/Finance', 'https://contoso.sharepoint.com/sites/HR')
        $b | Should -Be $a
        Should -Invoke Get-PnPTenantSite -ModuleName Coretelligent.SharePoint -Times 1 -Exactly
    }
}

Describe 'site groups' {
    BeforeEach {
        Mock Connect-PnPOnline -ModuleName Coretelligent.SharePoint { }
        Mock Get-PnPGroup -ModuleName Coretelligent.SharePoint { @([pscustomobject]@{ Title = 'Finance Members' }, [pscustomobject]@{ Title = 'Finance Visitors' }, [pscustomobject]@{ Title = 'ChatGPT Pilot' }) }
        # leaver@ and ref@ are on the Finance site (in Members + ChatGPT Pilot); nobody is on the HR site.
        Mock Get-PnPUser -ModuleName Coretelligent.SharePoint { if ($script:OnSite -and $Identity -match 'leaver@|ref@') { [pscustomobject]@{ LoginName = $Identity } } }
        Mock Get-PnPGroupMember -ModuleName Coretelligent.SharePoint {
            $t = [string]$Group.Title
            if ($t -in @('Finance Members', 'ChatGPT Pilot')) { @([pscustomobject]@{ LoginName = 'i:0#.f|membership|leaver@contoso.com' }, [pscustomobject]@{ LoginName = 'i:0#.f|membership|ref@contoso.com' }) } else { @() }
        }
        Mock Remove-PnPGroupMember -ModuleName Coretelligent.SharePoint { }
        Mock Add-PnPGroupMember -ModuleName Coretelligent.SharePoint { }
    }
    It 'offboard removes the leaver from every group they are in, and skips a site they never visited' {
        $script:OnSite = $true
        $r = Invoke-CtgSharePointSiteGroupsOffboard -Email 'leaver@contoso.com' -Sites @('https://contoso.sharepoint.com/sites/Finance') -AppId 'app' -Tenant 'contoso.com' -CertArgs $script:Cert
        Should -Invoke Remove-PnPGroupMember -ModuleName Coretelligent.SharePoint -Times 2 -Exactly
        ($r -join "`n") | Should -Match 'removed leaver@contoso.com from 2 group\(s\) on 1 of 1 site'
        $script:OnSite = $false
        $null = Invoke-CtgSharePointSiteGroupsOffboard -Email 'leaver@contoso.com' -Sites @('https://contoso.sharepoint.com/sites/HR') -AppId 'app' -Tenant 'contoso.com' -CertArgs $script:Cert
        Should -Invoke Get-PnPGroup -ModuleName Coretelligent.SharePoint -Times 1 -Exactly   # only the first call enumerated groups
    }
    It 'onboard mirrors the reference user''s groups, minus the excluded ones' {
        $script:OnSite = $true
        $r = Invoke-CtgSharePointSiteGroupsMirror -NewEmail 'new@contoso.com' -ReferenceEmail 'ref@contoso.com' -Sites @('https://contoso.sharepoint.com/sites/Finance') -AppId 'app' -Tenant 'contoso.com' -CertArgs $script:Cert -Exclude @('ChatGPT*')
        Should -Invoke Add-PnPGroupMember -ModuleName Coretelligent.SharePoint -Times 1 -Exactly -ParameterFilter { $Group -eq 'Finance Members' -and $LoginName -eq 'i:0#.f|membership|new@contoso.com' }
        ($r -join "`n") | Should -Match "not mirrored: site group 'ChatGPT Pilot'"
    }
    It 'one failing site is reported, the rest still run, and the step does not claim success' {
        $script:OnSite = $true
        Mock Connect-PnPOnline -ModuleName Coretelligent.SharePoint { if ($Url -match 'Broken') { throw 'Access denied' } }
        { Invoke-CtgSharePointSiteGroupsOffboard -Email 'leaver@contoso.com' -Sites @('https://contoso.sharepoint.com/sites/Broken', 'https://contoso.sharepoint.com/sites/Finance') -AppId 'app' -Tenant 'contoso.com' -CertArgs $script:Cert } |
            Should -Throw '*1 of 2 site(s)*sites/Broken*Access denied*'
        Should -Invoke Remove-PnPGroupMember -ModuleName Coretelligent.SharePoint -Times 2 -Exactly
    }
}

# Review fixes on PR #111. Each test here failed against the first cut of FR #118.
Describe 'review fixes' {
    BeforeEach {
        $script:OnSite = $true
        Mock Connect-PnPOnline -ModuleName Coretelligent.SharePoint { }
        Mock Get-PnPGroup -ModuleName Coretelligent.SharePoint { @([pscustomobject]@{ Title = 'Finance Members' }, [pscustomobject]@{ Title = 'ChatGPT Pilot' }) }
        Mock Get-PnPUser -ModuleName Coretelligent.SharePoint { if ($script:OnSite -and $Identity -match 'leaver@|ref@') { [pscustomobject]@{ LoginName = $Identity } } }
        Mock Get-PnPGroupMember -ModuleName Coretelligent.SharePoint { @([pscustomobject]@{ LoginName = 'i:0#.f|membership|leaver@contoso.com' }, [pscustomobject]@{ LoginName = 'i:0#.f|membership|ref@contoso.com' }) }
        Mock Remove-PnPGroupMember -ModuleName Coretelligent.SharePoint { }
        Mock Add-PnPGroupMember -ModuleName Coretelligent.SharePoint { }
        Mock Send-CtgProgress -ModuleName Coretelligent.SharePoint { }
        Mock Start-Sleep -ModuleName Coretelligent.SharePoint { }
        Mock Get-PnPTenantSite -ModuleName Coretelligent.SharePoint { @([pscustomobject]@{ Url = 'https://contoso.sharepoint.com/sites/Finance'; Template = 'GROUP#0' }) }
        Mock Get-MgUser -ModuleName Coretelligent.SharePoint {
            if ($Filter -match 'ref@contoso\.com') { @([pscustomobject]@{ UserPrincipalName = 'ref@contoso.com'; DisplayName = 'Rita Ref' }) }
            elseif ($Filter -match "displayName eq 'Rita Ref'") { @([pscustomobject]@{ UserPrincipalName = 'ref@contoso.com'; DisplayName = 'Rita Ref' }) }
            elseif ($Filter -match "displayName eq 'Sam Twin'") { @([pscustomobject]@{ UserPrincipalName = 'sam1@contoso.com' }, [pscustomobject]@{ UserPrincipalName = 'sam2@contoso.com' }) }
        }
        InModuleScope Coretelligent.SharePoint { $script:CtgSiteCache = @{} }
        $script:Ctx = { @{ AppId = 'app'; Tenant = 'contoso.com'; CertArgs = @{ CertificateThumbprint = 'AB' }; AdminUrl = 'https://contoso-admin.sharepoint.com' } }
    }

    # Finding 2: a big tenant walked with no narration tripped the runner's 600 s stall watchdog.
    It 'posts progress while it walks the sites' {
        $script:OnSite = $false
        $sites = @(1..25 | ForEach-Object { "https://contoso.sharepoint.com/sites/S$_" })
        $null = Invoke-CtgSharePointSiteGroupsOffboard -Email 'leaver@contoso.com' -Sites $sites -AppId 'app' -Tenant 'contoso.com' -CertArgs $script:Cert
        Should -Invoke Send-CtgProgress -ModuleName Coretelligent.SharePoint -Times 3
        $null = Invoke-CtgSharePointSiteGroupsMirror -NewEmail 'new@contoso.com' -ReferenceEmail 'ref@contoso.com' -Sites $sites -AppId 'app' -Tenant 'contoso.com' -CertArgs $script:Cert
        Should -Invoke Send-CtgProgress -ModuleName Coretelligent.SharePoint -Times 6
    }

    # Finding 3: a lookup error read as "never on this site" — the offboard reported success.
    It 'a lookup error on a site fails the offboard instead of reading as "not on this site"' {
        Mock Get-PnPUser -ModuleName Coretelligent.SharePoint { throw 'Access is denied. (Exception from HRESULT: 0x80070005)' }
        { Invoke-CtgSharePointSiteGroupsOffboard -Email 'leaver@contoso.com' -Sites @('https://contoso.sharepoint.com/sites/Finance') -AppId 'app' -Tenant 'contoso.com' -CertArgs $script:Cert } |
            Should -Throw '*may still have access*sites/Finance*Access is denied*'
    }
    It 'a user who is genuinely not on the site is still a quiet skip' {
        Mock Get-PnPUser -ModuleName Coretelligent.SharePoint { throw 'User cannot be found.' }
        $r = Invoke-CtgSharePointSiteGroupsOffboard -Email 'leaver@contoso.com' -Sites @('https://contoso.sharepoint.com/sites/Finance') -AppId 'app' -Tenant 'contoso.com' -CertArgs $script:Cert
        ($r -join "`n") | Should -Match 'removed leaver@contoso.com from 0 group\(s\) on 0 of 1 site'
    }
    It 'throttling (429/503) is retried, not skipped' {
        $global:SpUserCalls = 0
        Mock Get-PnPUser -ModuleName Coretelligent.SharePoint {
            $global:SpUserCalls++
            if ($global:SpUserCalls -eq 1) { throw 'The remote server returned an error: (429) Too Many Requests.' }
            else { [pscustomobject]@{ LoginName = $Identity } }
        }
        $r = Invoke-CtgSharePointSiteGroupsOffboard -Email 'leaver@contoso.com' -Sites @('https://contoso.sharepoint.com/sites/Finance') -AppId 'app' -Tenant 'contoso.com' -CertArgs $script:Cert
        Should -Invoke Start-Sleep -ModuleName Coretelligent.SharePoint -Times 1 -Exactly
        Should -Invoke Remove-PnPGroupMember -ModuleName Coretelligent.SharePoint -Times 2 -Exactly
        ($r -join "`n") | Should -Match 'from 2 group\(s\) on 1 of 1 site'
    }
    It 'a group-member read error is an error too, not an empty group' {
        Mock Get-PnPGroupMember -ModuleName Coretelligent.SharePoint { throw 'The remote server returned an error: (500) Internal Server Error.' }
        { Invoke-CtgSharePointSiteGroupsOffboard -Email 'leaver@contoso.com' -Sites @('https://contoso.sharepoint.com/sites/Finance') -AppId 'app' -Tenant 'contoso.com' -CertArgs $script:Cert } |
            Should -Throw '*sites/Finance*500*'
    }

    # Finding 5: in a dry run the WhatIf preference also stopped the temp .pfx (a private key) being
    # deleted, and a fresh copy was written for every site.
    It 'a dry run writes the certificate once and deletes it' {
        $global:SpCertPaths = [System.Collections.Generic.List[string]]::new()
        Mock Connect-PnPOnline -ModuleName Coretelligent.SharePoint { $global:SpCertPaths.Add([string]$CertificatePath) }
        $pfx = @{ CertificateBase64 = [Convert]::ToBase64String([byte[]](1, 2, 3)) }
        $sites = @('https://contoso.sharepoint.com/sites/A', 'https://contoso.sharepoint.com/sites/B', 'https://contoso.sharepoint.com/sites/C')
        try {
            $global:WhatIfPreference = $true
            $null = Invoke-CtgSharePointSiteGroupsOffboard -Email 'leaver@contoso.com' -Sites $sites -AppId 'app' -Tenant 'contoso.com' -CertArgs $pfx
        }
        finally {
            $global:WhatIfPreference = $false
            $leftover = @($global:SpCertPaths | Where-Object { $_ -and (Test-Path -LiteralPath $_) })
            foreach ($f in $leftover) { [System.IO.File]::Delete($f) }
        }
        $global:SpCertPaths.Count | Should -Be 3
        @($global:SpCertPaths | Select-Object -Unique).Count | Should -Be 1
        $leftover.Count | Should -Be 0
        Should -Invoke Remove-PnPGroupMember -ModuleName Coretelligent.SharePoint -Times 0 -Exactly
    }

    # Finding 7: no mirror user = nothing to do; don't touch PnP, the cert, or the site list at all.
    It 'onboard with no mirror user is a no-op that never builds the SharePoint context' {
        $global:SpCtxCalls = 0
        $r = Invoke-CtgSharePointSiteGroupsStep -Lane onboard -Payload ([pscustomobject]@{ UserPrincipalName = 'new@contoso.com' }) -Config ([pscustomobject]@{}) -Context { $global:SpCtxCalls++; throw 'PnP is not installed' }
        $r.Status | Should -Be 'ok'
        ($r.Actions -join "`n") | Should -Match 'no mirror user'
        $global:SpCtxCalls | Should -Be 0
        Should -Invoke Connect-PnPOnline -ModuleName Coretelligent.SharePoint -Times 0 -Exactly
        Should -Invoke Get-PnPTenantSite -ModuleName Coretelligent.SharePoint -Times 0 -Exactly
    }

    # Finding 1: the m365 step creates the hire at a FALLBACK username when the primary belongs to
    # someone else — the mirror must land on the account it actually created, never on the primary.
    It 'onboard mirrors onto the account the m365 step created (provisionedUpn), not the primary candidate' {
        $p = [pscustomobject]@{ UserPrincipalName = 'jsmith@contoso.com'; UserPrincipalNameFallbacks = @('john.smith2@contoso.com'); provisionedUpn = 'john.smith2@contoso.com' }
        $r = Invoke-CtgSharePointSiteGroupsStep -Lane onboard -Payload $p -Config ([pscustomobject]@{ mirrorFromUser = 'ref@contoso.com' }) -Context $script:Ctx
        $r.Email | Should -Be 'john.smith2@contoso.com'
        Should -Invoke Add-PnPGroupMember -ModuleName Coretelligent.SharePoint -Times 2 -Exactly -ParameterFilter { $LoginName -eq 'i:0#.f|membership|john.smith2@contoso.com' }
        Should -Invoke Add-PnPGroupMember -ModuleName Coretelligent.SharePoint -Times 0 -Exactly -ParameterFilter { $LoginName -match 'jsmith@' }
    }
    It 'onboard refuses to guess between username candidates when the created account is unknown' {
        $p = [pscustomobject]@{ UserPrincipalName = 'jsmith@contoso.com'; UserPrincipalNameFallbacks = @('john.smith2@contoso.com'); awaitCloudAccount = $false }
        { Invoke-CtgSharePointSiteGroupsStep -Lane onboard -Payload $p -Config ([pscustomobject]@{ mirrorFromUser = 'ref@contoso.com' }) -Context $script:Ctx } |
            Should -Throw '*which account*Set Username (userPrincipalName) on the case*'
        Should -Invoke Add-PnPGroupMember -ModuleName Coretelligent.SharePoint -Times 0 -Exactly
    }
    It 'onboard with a single username candidate and no step that will report the account uses it' {
        $r = Invoke-CtgSharePointSiteGroupsStep -Lane onboard -Payload ([pscustomobject]@{ UserPrincipalName = 'new@contoso.com'; awaitCloudAccount = $false }) -Config ([pscustomobject]@{ mirrorFromUser = 'ref@contoso.com' }) -Context $script:Ctx
        $r.Email | Should -Be 'new@contoso.com'
        Should -Invoke Add-PnPGroupMember -ModuleName Coretelligent.SharePoint -Times 2 -Exactly
    }
    # Review 3: m365 is a manual checklist item / scim / done by hand, so nothing will ever report the
    # account. With fallbacks, the Username an operator set on the case is the created account.
    It 'onboard with no reporting step uses the Username an operator set on the case, even with fallbacks' {
        $p = [pscustomobject]@{
            UserPrincipalName = 'john.smith2@contoso.com'; UserPrincipalNameFallbacks = @('jsmith@contoso.com', 'john.smith2@contoso.com')
            awaitCloudAccount = $false; fieldSource = [pscustomobject]@{ userPrincipalName = 'operator' }
        }
        $r = Invoke-CtgSharePointSiteGroupsStep -Lane onboard -Payload $p -Config ([pscustomobject]@{ mirrorFromUser = 'ref@contoso.com' }) -Context $script:Ctx
        $r.Email | Should -Be 'john.smith2@contoso.com'
        Should -Invoke Add-PnPGroupMember -ModuleName Coretelligent.SharePoint -Times 2 -Exactly -ParameterFilter { $LoginName -eq 'i:0#.f|membership|john.smith2@contoso.com' }
    }
    It 'an intake-derived Username (not operator-set) with fallbacks still refuses, naming the field to set' {
        $p = [pscustomobject]@{
            UserPrincipalName = 'jsmith@contoso.com'; UserPrincipalNameFallbacks = @('john.smith2@contoso.com')
            awaitCloudAccount = $false; fieldSource = [pscustomobject]@{ userPrincipalName = 'intake' }
        }
        { Invoke-CtgSharePointSiteGroupsStep -Lane onboard -Payload $p -Config ([pscustomobject]@{ mirrorFromUser = 'ref@contoso.com' }) -Context $script:Ctx } |
            Should -Throw '*Set Username (userPrincipalName) on the case*'
    }
    It 'the provisioned account always wins over an operator-set Username' {
        $p = [pscustomobject]@{ UserPrincipalName = 'jsmith@contoso.com'; provisionedUpn = 'john.smith2@contoso.com'; fieldSource = [pscustomobject]@{ userPrincipalName = 'operator' } }
        $r = Invoke-CtgSharePointSiteGroupsStep -Lane onboard -Payload $p -Config ([pscustomobject]@{ mirrorFromUser = 'ref@contoso.com' }) -Context $script:Ctx
        $r.Email | Should -Be 'john.smith2@contoso.com'
    }

    # Finding 4: the mirror user was resolved by display name with -Top 1 — two people, arbitrary pick.
    It 'a mirror user named by a display name two people share fails with a clear message' {
        { Invoke-CtgSharePointSiteGroupsStep -Lane onboard -Payload ([pscustomobject]@{ UserPrincipalName = 'new@contoso.com'; provisionedUpn = 'new@contoso.com' }) -Config ([pscustomobject]@{ mirrorFromUser = 'Sam Twin' }) -Context $script:Ctx } |
            Should -Throw '*2 or more people*Sam Twin*email*'
        Should -Invoke Add-PnPGroupMember -ModuleName Coretelligent.SharePoint -Times 0 -Exactly
    }
    It 'a mirror user named by a unique display name resolves to their UPN' {
        $r = Invoke-CtgSharePointSiteGroupsStep -Lane onboard -Payload ([pscustomobject]@{ UserPrincipalName = 'new@contoso.com'; provisionedUpn = 'new@contoso.com' }) -Config ([pscustomobject]@{ mirrorFromUser = 'Rita Ref' }) -Context $script:Ctx
        ($r.Actions -join "`n") | Should -Match 'mirrored 2 group\(s\) from ref@contoso.com'
    }

    # Finding 6: the mirror policy's exclude list (config.mirrorPolicy.exclude) reaches the step and is honoured.
    It 'the step honours config.mirrorPolicy.exclude' {
        $cfg = [pscustomobject]@{ mirrorFromUser = 'ref@contoso.com'; mirrorPolicy = [pscustomobject]@{ exclude = @('chatgpt*') } }
        $r = Invoke-CtgSharePointSiteGroupsStep -Lane onboard -Payload ([pscustomobject]@{ UserPrincipalName = 'new@contoso.com'; provisionedUpn = 'new@contoso.com' }) -Config $cfg -Context $script:Ctx
        Should -Invoke Add-PnPGroupMember -ModuleName Coretelligent.SharePoint -Times 1 -Exactly -ParameterFilter { $Group -eq 'Finance Members' }
        ($r.Actions -join "`n") | Should -Match "not mirrored: site group 'ChatGPT Pilot'"
    }

    It 'offboard removes the leaver it is given, building the context only then' {
        $r = Invoke-CtgSharePointSiteGroupsStep -Lane offboard -Payload ([pscustomobject]@{}) -LeaverUpn 'leaver@contoso.com' -Context $script:Ctx
        $r.Status | Should -Be 'ok'
        Should -Invoke Remove-PnPGroupMember -ModuleName Coretelligent.SharePoint -Times 2 -Exactly
    }
}

# Second review of PR #111.
Describe 'second review fixes' {
    BeforeEach {
        $global:SpNewSite = $false
        Mock Connect-PnPOnline -ModuleName Coretelligent.SharePoint { }
        Mock Get-PnPGroup -ModuleName Coretelligent.SharePoint { @([pscustomobject]@{ Title = 'Finance Members' }) }
        Mock Get-PnPUser -ModuleName Coretelligent.SharePoint { if ($Identity -match 'leaver@|ref@') { [pscustomobject]@{ LoginName = $Identity } } }
        Mock Get-PnPGroupMember -ModuleName Coretelligent.SharePoint { @([pscustomobject]@{ LoginName = 'i:0#.f|membership|leaver@contoso.com' }, [pscustomobject]@{ LoginName = 'i:0#.f|membership|ref@contoso.com' }) }
        Mock Remove-PnPGroupMember -ModuleName Coretelligent.SharePoint { }
        Mock Add-PnPGroupMember -ModuleName Coretelligent.SharePoint { }
        Mock Send-CtgProgress -ModuleName Coretelligent.SharePoint { }
        # Finance always exists; NewProject appears once $global:SpNewSite is set (created mid-cache-window).
        Mock Get-PnPTenantSite -ModuleName Coretelligent.SharePoint {
            @([pscustomobject]@{ Url = 'https://contoso.sharepoint.com/sites/Finance'; Template = 'GROUP#0' })
            if ($global:SpNewSite) { [pscustomobject]@{ Url = 'https://contoso.sharepoint.com/sites/NewProject'; Template = 'GROUP#0' } }
        }
        Mock Get-MgUser -ModuleName Coretelligent.SharePoint { if ($Filter -match 'ref@contoso\.com') { @([pscustomobject]@{ UserPrincipalName = 'ref@contoso.com' }) } }
        InModuleScope Coretelligent.SharePoint { $script:CtgSiteCache = @{} }
        $script:Ctx = { @{ AppId = 'app'; Tenant = 'contoso.com'; CertArgs = @{ CertificateThumbprint = 'AB' }; AdminUrl = 'https://contoso-admin.sharepoint.com' } }
    }

    # N1: a single-pattern client whose primary jsmith@ is an EXISTING John Smith, with m365 paused on a
    # collision decision. No provisionedUpn yet and no fallbacks, so the first cut mirrored onto him.
    It 'onboard waits for the created account while the case has a cloud-account step, even with one candidate' {
        foreach ($p in @(
                [pscustomobject]@{ UserPrincipalName = 'jsmith@contoso.com'; awaitCloudAccount = $true; provisionedUpn = $null },
                [pscustomobject]@{ UserPrincipalName = 'jsmith@contoso.com' })) {   # flag absent (older app) = wait too
            { Invoke-CtgSharePointSiteGroupsStep -Lane onboard -Payload $p -Config ([pscustomobject]@{ mirrorFromUser = 'ref@contoso.com' }) -Context $script:Ctx } |
                Should -Throw '*waiting for the Microsoft 365 step*'
        }
        Should -Invoke Add-PnPGroupMember -ModuleName Coretelligent.SharePoint -Times 0 -Exactly
        Should -Invoke Get-PnPTenantSite -ModuleName Coretelligent.SharePoint -Times 0 -Exactly
    }

    # N2: a site created inside the 6 h cache window was never walked on offboard.
    It 'offboard always lists sites fresh (and refreshes the cache); onboard may reuse it' {
        $null = Invoke-CtgSharePointSiteGroupsStep -Lane offboard -Payload ([pscustomobject]@{}) -LeaverUpn 'leaver@contoso.com' -Context $script:Ctx
        $global:SpNewSite = $true
        $null = Invoke-CtgSharePointSiteGroupsStep -Lane offboard -Payload ([pscustomobject]@{}) -LeaverUpn 'leaver@contoso.com' -Context $script:Ctx
        Should -Invoke Get-PnPTenantSite -ModuleName Coretelligent.SharePoint -Times 2 -Exactly
        Should -Invoke Connect-PnPOnline -ModuleName Coretelligent.SharePoint -Times 1 -Exactly -ParameterFilter { $Url -match 'NewProject' }
        # That fresh listing refreshed the cache, so an onboard mirror right after reuses it: no third listing.
        $null = Invoke-CtgSharePointSiteGroupsStep -Lane onboard -Payload ([pscustomobject]@{ provisionedUpn = 'new@contoso.com' }) -Config ([pscustomobject]@{ mirrorFromUser = 'ref@contoso.com' }) -Context $script:Ctx
        Should -Invoke Get-PnPTenantSite -ModuleName Coretelligent.SharePoint -Times 2 -Exactly
        Should -Invoke Connect-PnPOnline -ModuleName Coretelligent.SharePoint -Times 2 -Exactly -ParameterFilter { $Url -match 'NewProject' }
    }
}
