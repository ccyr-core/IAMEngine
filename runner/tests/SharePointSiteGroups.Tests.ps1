# FR #0000118: remove a leaver from SharePoint SITE groups on every site, and mirror a reference user's
# site groups on onboard. PnP.PowerShell isn't on a test host, so its cmdlets are thin global stubs,
# mocked in the module scope.
BeforeAll {
    function global:Connect-PnPOnline { param($Url, $ClientId, $Tenant, $CertificatePath, $CertificatePassword, $Thumbprint) }
    function global:Get-PnPTenantSite { param() }
    function global:Get-PnPUser { param($Identity) }
    function global:Get-PnPGroup { param() }
    function global:Get-PnPGroupMember { param($Group) }
    function global:Remove-PnPGroupMember { param($Group, $LoginName) }
    function global:Add-PnPGroupMember { param($Group, $LoginName) }
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
    It 'one failing site warns and the rest still run' {
        $script:OnSite = $true
        Mock Connect-PnPOnline -ModuleName Coretelligent.SharePoint { if ($Url -match 'Broken') { throw 'Access denied' } }
        $r = Invoke-CtgSharePointSiteGroupsOffboard -Email 'leaver@contoso.com' -Sites @('https://contoso.sharepoint.com/sites/Broken', 'https://contoso.sharepoint.com/sites/Finance') -AppId 'app' -Tenant 'contoso.com' -CertArgs $script:Cert
        ($r -join "`n") | Should -Match 'WARN SharePoint site https://contoso.sharepoint.com/sites/Broken not cleaned'
        Should -Invoke Remove-PnPGroupMember -ModuleName Coretelligent.SharePoint -Times 2 -Exactly
    }
}
