# ExchangeOnlineManagement 3.10.0's REST cmdlets call HttpResponseMessage.GetResponseHeader() — a
# method that no longer exists on PS7.6's HttpResponseMessage — so every Exchange job dies with
# "does not contain a method named 'GetResponseHeader'" (puretech/core2104, 2026-07-15). The runner
# pins to the known-good 3.9.2, but the pin only helps if it's INSTALLED; a host with only the broken
# 3.10.0 used to fall back to it and limp. Install-CtgExoPin self-heals the pin at startup. These
# tests exercise that guard.
#
# Start-IamRunner.ps1 is not dot-sourceable (mandatory param block + main loop), so — like the Graph
# skew tests — we pull the function out of the script text and evaluate just it.
BeforeAll {
    $Root = Split-Path $PSScriptRoot -Parent
    $script:Runner = Get-Content "$Root/Start-IamRunner.ps1" -Raw

    $m = [regex]::Match($script:Runner, '(?ms)^function Install-CtgExoPin \{.*?^\}')
    $m.Success | Should -BeTrue -Because 'Start-IamRunner.ps1 must declare Install-CtgExoPin'
    . ([scriptblock]::Create($m.Value))

    # The out-of-process install seam. Dot-sourced (not stubbed) so these tests also assert the
    # script really declares it — mocking a command Pester cannot resolve is a CommandNotFound error.
    $p = [regex]::Match($script:Runner, '(?ms)^function Invoke-CtgPwshInstall \{.*?^\}')
    $p.Success | Should -BeTrue -Because 'Start-IamRunner.ps1 must declare Invoke-CtgPwshInstall'
    . ([scriptblock]::Create($p.Value))

    function Initialize-CtgGallery { }  # stub the gallery bootstrap the guard calls before installing

    # This pwsh has no PowerShellGet, so there is no real Install-Module for Pester to hook -
    # declare a stub with the parameters the guard passes, then Mock over it.
    function Install-Module {
        param([string]$Name, [version]$RequiredVersion, [string]$Scope, [switch]$Force,
              [switch]$AllowClobber, [switch]$Confirm, [switch]$AcceptLicense, [string]$ErrorAction)
    }

    function script:FakeModule([string]$Name, [string]$Version) {
        [pscustomobject]@{ Name = $Name; Version = [version]$Version }
    }
}

Describe 'Install-CtgExoPin' {
    It 'installs the pin, at the exact requested version, when it is absent' {
        # The failing state: only the broken 3.10.0 is on the host, the 3.9.2 pin is missing.
        Mock Get-Module { @(FakeModule 'ExchangeOnlineManagement' '3.10.0') }
        Mock Invoke-CtgPwshInstall { [pscustomobject]@{ Code = 0; Tail = '' } }
        Mock Write-Warning { }
        Install-CtgExoPin -Version '3.9.2'
        Should -Invoke Invoke-CtgPwshInstall -Times 1 -Exactly -ParameterFilter {
            $Name -eq 'ExchangeOnlineManagement' -and $Version -eq '3.9.2'
        }
    }

    It 'is a no-op when the pin is already installed (even alongside the broken build)' {
        Mock Get-Module {
            @(
                (FakeModule 'ExchangeOnlineManagement' '3.9.2'),
                (FakeModule 'ExchangeOnlineManagement' '3.10.0')   # broken build present too — pin still wins
            )
        }
        Mock Install-Module { }
        Install-CtgExoPin -Version '3.9.2'
        Should -Invoke Install-Module -Times 0 -Exactly
    }

    It 'installs the pin when EXO is not present at all' {
        Mock Get-Module { @() }
        Mock Invoke-CtgPwshInstall { [pscustomobject]@{ Code = 0; Tail = '' } }
        Mock Write-Warning { }
        Install-CtgExoPin -Version '3.9.2'
        Should -Invoke Invoke-CtgPwshInstall -Times 1 -Exactly -ParameterFilter { $Version -eq '3.9.2' }
    }

    It 'never throws when the gallery is unreachable (best-effort, never blocks startup)' {
        Mock Get-Module { @(FakeModule 'ExchangeOnlineManagement' '3.10.0') }
        Mock Invoke-CtgPwshInstall { [pscustomobject]@{ Code = 1; Tail = 'gallery unreachable' } }
        Mock Write-Warning { }
        { Install-CtgExoPin -Version '3.9.2' } | Should -Not -Throw
        Should -Invoke Invoke-CtgPwshInstall -Times 1 -Exactly
    }
}

Describe 'EXO pin self-heal (script invariants)' {
    It 'runs the pin self-heal BEFORE resolving/importing ExchangeOnlineManagement' {
        $heal   = $script:Runner.IndexOf('Install-CtgExoPin -Version $ExoModuleVersion')
        $import = $script:Runner.IndexOf('Import-Module ExchangeOnlineManagement -RequiredVersion')
        $heal | Should -BeGreaterThan -1
        ($heal -lt $import) | Should -BeTrue -Because 'the pin must be present before the import picks a build'
    }

    It 'defaults the pin to a build known to survive PS7.6 (not 3.10.0)' {
        $script:Runner | Should -Match "ExoModuleVersion = '3\.9\.2'"
    }
}

# FR #0000129 / #0000130: startup installs and imports the pin, but Repair-CtgMissingModule used to
# install the gallery LATEST for any self-healed module. For ExchangeOnlineManagement that put the
# BROKEN 3.10.0 on the host permanently, so the moment the pin was missing the startup fallback picked
# it and every Exchange job died with "does not contain a method named 'GetResponseHeader'".
# core1748 hit it twice on 2026-09-08.
Describe 'the self-heal respects the EXO pin' {
    It 'asks for the pinned version rather than the gallery latest' {
        $repair = [regex]::Match($script:Runner, '(?ms)^function Repair-CtgMissingModule \{.*?^\}').Value
        $repair | Should -Not -BeNullOrEmpty
        # The pin must be chosen BEFORE the install decision that falls back to latest. Plain substring
        # rather than a regex — the line is full of $ and braces that a pattern would have to escape.
        $repair.Contains("-eq 'ExchangeOnlineManagement'") | Should -BeTrue
        $repair.Contains('$reqVer = $ExoModuleVersion') | Should -BeTrue
        $pinAt   = $repair.IndexOf("-eq 'ExchangeOnlineManagement'")
        $installAt = $repair.IndexOf('if ($reqVer)')
        $pinAt | Should -BeGreaterThan -1
        $installAt | Should -BeGreaterThan $pinAt
    }

    It 'still pins a Microsoft.Graph submodule to the installed Graph version (unchanged)' {
        # The Graph pin exists for the sibling reason — mismatched submodule versions throw
        # "Assembly with same name is already loaded". This change must not disturb it.
        $repair = [regex]::Match($script:Runner, '(?ms)^function Repair-CtgMissingModule \{.*?^\}').Value
        $repair | Should -Match "Microsoft.Graph.Authentication"
    }
}

# FR #0000130: the Exchange-finish failure hint blamed permissions and certificates for this error,
# which sent an operator to re-consent an app that was already correctly configured.
Describe 'the Exchange finish hint names the real cause' {
    It 'does not blame permissions for a GetResponseHeader failure' {
        $fn = [regex]::Match($script:Runner, '(?ms)WARN Exchange Online finish failed').Value
        $fn | Should -Not -BeNullOrEmpty
        # The module-version branch must exist and must be reached BEFORE the catch-all hint.
        $branchAt = $script:Runner.IndexOf('GetResponseHeader|does not contain a method named')
        $catchAllAt = $script:Runner.IndexOf('grant the m365-admin app Exchange.ManageAsApp + set its cert')
        $branchAt | Should -BeGreaterThan -1
        $catchAllAt | Should -BeGreaterThan $branchAt
    }

    It 'says plainly that it is NOT a permissions problem, and names the fix' {
        $script:Runner | Should -Match 'NOT a permissions or certificate problem'
        $script:Runner | Should -Match 'Install-Module ExchangeOnlineManagement -RequiredVersion'
    }
}

# The pin's self-heal ran Install-Module INSIDE the runner process, which by that point has imported
# Graph, AD and a dozen Coretelligent.* modules. PowerShellGet then refuses with "The version
# '1.4.8.1' of module 'PackageManagement' is currently in use. Retry the operation after closing the
# applications." -- caught, written to a Write-Warning, and on a Windows SYSTEM scheduled task that
# warning goes to a console nobody is attached to. So on core1748 the self-heal failed at EVERY
# startup, invisibly, the fallback loaded the broken 3.10.0, and every Exchange job died with
# "does not contain a method named 'GetResponseHeader'" (UM0031200, 2026-09-11).
Describe 'Install-CtgExoPin installs out-of-process and says so when it cannot' {
    BeforeEach {
        $script:LastExoPinError = $null
    }

    It 'installs the pin in a CLEAN child pwsh, never in the running session' {
        # In-session Install-Module is the bug: the runner's own loaded modules block it.
        Mock Get-Module { @(FakeModule 'ExchangeOnlineManagement' '3.10.0') }
        Mock Invoke-CtgPwshInstall { [pscustomobject]@{ Code = 0; Tail = '' } }
        Mock Install-Module { }
        Mock Write-Warning { }
        Install-CtgExoPin -Version '3.9.2'
        Should -Invoke Invoke-CtgPwshInstall -Times 1 -Exactly -ParameterFilter {
            $Name -eq 'ExchangeOnlineManagement' -and $Version -eq '3.9.2'
        }
        Should -Invoke Install-Module -Times 0 -Exactly
    }

    It 'records WHY when the pin is still absent after the attempt' {
        # The host state that caused UM0031200: the install is refused and the pin never appears.
        Mock Get-Module { @(FakeModule 'ExchangeOnlineManagement' '3.10.0') }
        Mock Invoke-CtgPwshInstall {
            [pscustomobject]@{ Code = 1; Tail = "The version '1.4.8.1' of module 'PackageManagement' is currently in use." }
        }
        Mock Write-Warning { }
        Install-CtgExoPin -Version '3.9.2'
        $script:LastExoPinError | Should -Not -BeNullOrEmpty
        $script:LastExoPinError | Should -Match 'PackageManagement'
    }

    It 'names the build it will fall back to, so the reason is actionable' {
        # A version that appears nowhere in the source, so this can only pass by actually reading the
        # host's installed build -- not by a hardcoded '3.10.0' in the message.
        Mock Get-Module { @(FakeModule 'ExchangeOnlineManagement' '3.11.7') }
        Mock Invoke-CtgPwshInstall { [pscustomobject]@{ Code = 1; Tail = 'gallery unreachable' } }
        Mock Write-Warning { }
        Install-CtgExoPin -Version '3.9.2'
        $script:LastExoPinError | Should -Match '3\.11\.7'
    }

    It 'clears a previously recorded failure once the pin IS present' {
        # The agent having the pin outranks a reason it did not, earlier -- mirrors the browser capability.
        $script:LastExoPinError = 'a stale reason from the last boot'
        Mock Get-Module { @(FakeModule 'ExchangeOnlineManagement' '3.9.2') }
        Mock Invoke-CtgPwshInstall { throw 'must not be called when the pin is already present' }
        Install-CtgExoPin -Version '3.9.2'
        $script:LastExoPinError | Should -BeNullOrEmpty
    }

    It 'never throws when the child process itself cannot be started' {
        Mock Get-Module { @(FakeModule 'ExchangeOnlineManagement' '3.10.0') }
        Mock Invoke-CtgPwshInstall { throw 'pwsh not found' }
        Mock Write-Warning { }
        { Install-CtgExoPin -Version '3.9.2' } | Should -Not -Throw
        $script:LastExoPinError | Should -Not -BeNullOrEmpty
    }
}
