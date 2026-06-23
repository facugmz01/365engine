<#
.SYNOPSIS
    EXPORT-AllIntune.ps1 v4
    Exporta TODAS las configuraciones de Intune del tenant origen.
    Scopes ReadWrite para Scripts/Remediations + reintento automatico.
.NOTES
    Ejecutar en el TENANT ORIGEN
    Requisitos: PowerShell 7+, Microsoft.Graph module
#>

#=============================================================
# CONFIGURACION
#=============================================================
$ExportRoot = ".\IntuneExport_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
$SkipCategories = @()

#=============================================================
# VARIABLES
#=============================================================
$ErrorActionPreference = "Continue"
$BetaUri = "https://graph.microsoft.com/beta"
$V1Uri   = "https://graph.microsoft.com/v1.0"
$Summary = @()

$AllScopes = @(
    "DeviceManagementConfiguration.ReadWrite.All",
    "DeviceManagementManagedDevices.ReadWrite.All",
    "DeviceManagementApps.ReadWrite.All",
    "DeviceManagementServiceConfig.ReadWrite.All",
    "Policy.Read.All",
    "Policy.Read.ConditionalAccess",
    "DeviceManagementRBAC.ReadWrite.All"
)

#=============================================================
# FUNCIONES
#=============================================================
function Get-AllPages {
    param([string]$Uri)
    $all = @()
    do {
        $r = Invoke-MgGraphRequest -Method GET -Uri $Uri
        if ($r.value) { $all += $r.value }
        $Uri = $r.'@odata.nextLink'
    } while ($Uri)
    return $all
}

function Save-Json {
    param($Obj, [string]$Path)
    $dir = Split-Path $Path -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $Obj | ConvertTo-Json -Depth 100 | Out-File $Path -Encoding UTF8
}

function Get-SafeName {
    param([string]$N)
    $inv = [IO.Path]::GetInvalidFileNameChars() -join ''
    $rx = "[{0}]" -f [Regex]::Escape($inv)
    $clean = ($N -replace $rx, '_')
    return $clean.Substring(0, [Math]::Min($clean.Length, 100))
}

function Get-Assignments {
    param([string]$Uri)
    try { $r = Invoke-MgGraphRequest -Method GET -Uri "$Uri/assignments"; if ($r.value) { return $r.value } } catch {}
    return @()
}

function Export-Cat {
    param([string]$Id, [string]$Name, [scriptblock]$Action)
    if ($SkipCategories -contains $Id) { Write-Host "  OMITIDA: $Name" -ForegroundColor DarkGray; return }
    Write-Host "`n  >> $Name" -ForegroundColor White
    $p = Join-Path $ExportRoot $Id
    New-Item -ItemType Directory -Path $p -Force | Out-Null
    try {
        $c = & $Action $p
        if ($null -eq $c) { $c = 0 }
        Write-Host "     OK: $c elementos" -ForegroundColor Green
        $script:Summary += [PSCustomObject]@{ Categoria = $Name; Elementos = $c; Estado = "OK" }
    } catch {
        Write-Host "     ERROR: $($_.Exception.Message)" -ForegroundColor Red
        $script:Summary += [PSCustomObject]@{ Categoria = $Name; Elementos = 0; Estado = "ERROR: $($_.Exception.Message)" }
    }
}

function Ensure-GraphPermissions {
    Write-Host "`n  Verificando permisos para Scripts/Remediations..." -ForegroundColor Yellow
    $endpoints = @(
        @{ Name = "Scripts"; Uri = "$BetaUri/deviceManagement/deviceManagementScripts?`$top=1" },
        @{ Name = "Remediations"; Uri = "$BetaUri/deviceManagement/deviceHealthScripts?`$top=1" }
    )
    $needsReconnect = $false
    foreach ($ep in $endpoints) {
        try {
            Invoke-MgGraphRequest -Method GET -Uri $ep.Uri | Out-Null
            Write-Host "     OK $($ep.Name)" -ForegroundColor Green
        } catch {
            if ($_.Exception.Message -match "Forbidden") {
                Write-Host "     BLOQUEADO $($ep.Name)" -ForegroundColor Yellow
                $needsReconnect = $true
            }
        }
    }
    if ($needsReconnect) {
        Write-Host "`n  Reconectando con permisos elevados (-ForceRefresh)..." -ForegroundColor Cyan
        Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null
        Start-Sleep -Seconds 2
        Connect-MgGraph -Scopes $AllScopes -ForceRefresh -NoWelcome
        foreach ($ep in $endpoints) {
            try {
                Invoke-MgGraphRequest -Method GET -Uri $ep.Uri | Out-Null
                Write-Host "     OK $($ep.Name) (post-reconexion)" -ForegroundColor Green
            } catch {
                Write-Host "     SIGUE BLOQUEADO $($ep.Name) - necesitas Intune Admin o Global Admin" -ForegroundColor Red
            }
        }
    }
}

#=============================================================
# EJECUCION
#=============================================================
Write-Host "`n====================================================================" -ForegroundColor Cyan
Write-Host "  EXPORTACION COMPLETA DE INTUNE v4 - TENANT ORIGEN" -ForegroundColor Cyan
Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Gray
Write-Host "====================================================================" -ForegroundColor Cyan

# [1/4] Conexion
Write-Host "`n[1/4] Conectando a Microsoft Graph..." -ForegroundColor Yellow
if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) {
    Install-Module Microsoft.Graph -Scope CurrentUser -Force -AllowClobber
}
Import-Module Microsoft.Graph.Authentication -Force
Connect-MgGraph -Scopes $AllScopes -NoWelcome
$ctx = Get-MgContext
Write-Host "  OK Conectado: $($ctx.Account)" -ForegroundColor Green
Write-Host "  OK Tenant:    $($ctx.TenantId)" -ForegroundColor Green

# [2/4] Permisos
Write-Host "`n[2/4] Verificando permisos..." -ForegroundColor Yellow
Ensure-GraphPermissions
New-Item -ItemType Directory -Path $ExportRoot -Force | Out-Null

# [3/4] Exportar
Write-Host "`n[3/4] Exportando configuraciones..." -ForegroundColor Yellow

# 01. Settings Catalog
Export-Cat -Id "01_SettingsCatalog" -Name "Settings Catalog Policies" -Action {
    param($p)
    $pols = Get-AllPages -Uri "$BetaUri/deviceManagement/configurationPolicies?`$top=100"
    $c = 0
    foreach ($pol in $pols) {
        $sets = Get-AllPages -Uri "$BetaUri/deviceManagement/configurationPolicies/$($pol.id)/settings?`$top=1000"
        $asgn = Get-Assignments -Uri "$BetaUri/deviceManagement/configurationPolicies/$($pol.id)"
        $exp = @{ name=$pol.name; description=$pol.description; platforms=$pol.platforms; technologies=$pol.technologies; templateReference=$pol.templateReference; settings=$sets; assignments=$asgn }
        Save-Json -Obj $exp -Path (Join-Path $p "$(($c).ToString('D3'))_$(Get-SafeName $pol.name).json")
        Write-Host "     $($pol.name)" -ForegroundColor Gray; $c++
    }; return $c
}

# 02. Device Configurations
Export-Cat -Id "02_DeviceConfigurations" -Name "Device Configuration Profiles" -Action {
    param($p)
    $cfgs = Get-AllPages -Uri "$BetaUri/deviceManagement/deviceConfigurations?`$top=100"
    $c = 0
    foreach ($cfg in $cfgs) {
        $asgn = Get-Assignments -Uri "$BetaUri/deviceManagement/deviceConfigurations/$($cfg.id)"
        $cfg | Add-Member -NotePropertyName "_assignments" -NotePropertyValue $asgn -Force
        Save-Json -Obj $cfg -Path (Join-Path $p "$(($c).ToString('D3'))_$(Get-SafeName $cfg.displayName).json")
        Write-Host "     $($cfg.displayName)" -ForegroundColor Gray; $c++
    }; return $c
}

# 03. Compliance
Export-Cat -Id "03_CompliancePolicies" -Name "Compliance Policies" -Action {
    param($p)
    $pols = Get-AllPages -Uri "$BetaUri/deviceManagement/deviceCompliancePolicies?`$top=100"
    $c = 0
    foreach ($pol in $pols) {
        $asgn = Get-Assignments -Uri "$BetaUri/deviceManagement/deviceCompliancePolicies/$($pol.id)"
        $pol | Add-Member -NotePropertyName "_assignments" -NotePropertyValue $asgn -Force
        Save-Json -Obj $pol -Path (Join-Path $p "$(($c).ToString('D3'))_$(Get-SafeName $pol.displayName).json")
        Write-Host "     $($pol.displayName)" -ForegroundColor Gray; $c++
    }; return $c
}

# 04. Endpoint Security
Export-Cat -Id "04_EndpointSecurity" -Name "Endpoint Security (Intents)" -Action {
    param($p)
    $intents = Get-AllPages -Uri "$BetaUri/deviceManagement/intents?`$top=100"
    $c = 0
    foreach ($i in $intents) {
        $cats = Get-AllPages -Uri "$BetaUri/deviceManagement/intents/$($i.id)/categories"
        $allS = @()
        foreach ($cat in $cats) {
            $cs = Get-AllPages -Uri "$BetaUri/deviceManagement/intents/$($i.id)/categories/$($cat.id)/settings"
            $allS += @{ categoryId=$cat.id; displayName=$cat.displayName; settings=$cs }
        }
        $asgn = Get-Assignments -Uri "$BetaUri/deviceManagement/intents/$($i.id)"
        $exp = @{ displayName=$i.displayName; description=$i.description; templateId=$i.templateId; settingCategories=$allS; assignments=$asgn }
        Save-Json -Obj $exp -Path (Join-Path $p "$(($c).ToString('D3'))_$(Get-SafeName $i.displayName).json")
        Write-Host "     $($i.displayName)" -ForegroundColor Gray; $c++
    }; return $c
}

# 05. Conditional Access
Export-Cat -Id "05_ConditionalAccess" -Name "Conditional Access Policies" -Action {
    param($p)
    $pols = Get-AllPages -Uri "$V1Uri/identity/conditionalAccess/policies"
    $c = 0
    foreach ($pol in $pols) {
        Save-Json -Obj $pol -Path (Join-Path $p "$(($c).ToString('D3'))_$(Get-SafeName $pol.displayName).json")
        Write-Host "     [$($pol.state)] $($pol.displayName)" -ForegroundColor Gray; $c++
    }; return $c
}

# 06. Autopilot
Export-Cat -Id "06_AutopilotProfiles" -Name "Autopilot Deployment Profiles" -Action {
    param($p)
    $profs = Get-AllPages -Uri "$BetaUri/deviceManagement/windowsAutopilotDeploymentProfiles?`$top=100"
    $c = 0
    foreach ($pr in $profs) {
        $asgn = Get-Assignments -Uri "$BetaUri/deviceManagement/windowsAutopilotDeploymentProfiles/$($pr.id)"
        $pr | Add-Member -NotePropertyName "_assignments" -NotePropertyValue $asgn -Force
        Save-Json -Obj $pr -Path (Join-Path $p "$(($c).ToString('D3'))_$(Get-SafeName $pr.displayName).json")
        Write-Host "     $($pr.displayName)" -ForegroundColor Gray; $c++
    }; return $c
}

# 07. Enrollment
Export-Cat -Id "07_EnrollmentConfigs" -Name "Enrollment Configurations" -Action {
    param($p)
    $cfgs = Get-AllPages -Uri "$BetaUri/deviceManagement/deviceEnrollmentConfigurations?`$top=100"
    $c = 0
    foreach ($cfg in $cfgs) {
        $asgn = Get-Assignments -Uri "$BetaUri/deviceManagement/deviceEnrollmentConfigurations/$($cfg.id)"
        $cfg | Add-Member -NotePropertyName "_assignments" -NotePropertyValue $asgn -Force
        Save-Json -Obj $cfg -Path (Join-Path $p "$(($c).ToString('D3'))_$(Get-SafeName $cfg.displayName).json")
        Write-Host "     $($cfg.displayName)" -ForegroundColor Gray; $c++
    }; return $c
}

# 08. Scripts (con fix permisos)
Export-Cat -Id "08_Scripts" -Name "PowerShell Scripts" -Action {
    param($p)
    $scripts = $null
    try {
        $scripts = Get-AllPages -Uri "$BetaUri/deviceManagement/deviceManagementScripts?`$top=100"
    } catch {
        if ($_.Exception.Message -match "Forbidden") {
            Write-Host "     Reintentando con reconexion..." -ForegroundColor Yellow
            Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null
            Start-Sleep -Seconds 2
            Connect-MgGraph -Scopes $AllScopes -ForceRefresh -NoWelcome
            $scripts = Get-AllPages -Uri "$BetaUri/deviceManagement/deviceManagementScripts?`$top=100"
        } else { throw $_ }
    }
    $c = 0
    foreach ($s in $scripts) {
        $detail = Invoke-MgGraphRequest -Method GET -Uri "$BetaUri/deviceManagement/deviceManagementScripts/$($s.id)"
        $asgn = Get-Assignments -Uri "$BetaUri/deviceManagement/deviceManagementScripts/$($s.id)"
        $detail | Add-Member -NotePropertyName "_assignments" -NotePropertyValue $asgn -Force
        $fn = "$(($c).ToString('D3'))_$(Get-SafeName $s.displayName)"
        Save-Json -Obj $detail -Path (Join-Path $p "$fn.json")
        if ($detail.scriptContent) {
            try {
                $decoded = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($detail.scriptContent))
                $decoded | Out-File (Join-Path $p "$fn.ps1") -Encoding UTF8
            } catch {}
        }
        Write-Host "     $($s.displayName)" -ForegroundColor Gray; $c++
    }; return $c
}

# 09. Remediations (con fix permisos)
Export-Cat -Id "09_Remediations" -Name "Proactive Remediations" -Action {
    param($p)
    $scripts = $null
    try {
        $scripts = Get-AllPages -Uri "$BetaUri/deviceManagement/deviceHealthScripts?`$top=100"
    } catch {
        if ($_.Exception.Message -match "Forbidden") {
            Write-Host "     Reintentando con reconexion..." -ForegroundColor Yellow
            Disconnect-MgGraph -ErrorAction SilentlyContinue | Out-Null
            Start-Sleep -Seconds 2
            Connect-MgGraph -Scopes $AllScopes -ForceRefresh -NoWelcome
            $scripts = Get-AllPages -Uri "$BetaUri/deviceManagement/deviceHealthScripts?`$top=100"
        } else { throw $_ }
    }
    $c = 0
    foreach ($s in $scripts) {
        if ($s.isGlobalScript -eq $true) { continue }
        $detail = Invoke-MgGraphRequest -Method GET -Uri "$BetaUri/deviceManagement/deviceHealthScripts/$($s.id)"
        $asgn = Get-Assignments -Uri "$BetaUri/deviceManagement/deviceHealthScripts/$($s.id)"
        $detail | Add-Member -NotePropertyName "_assignments" -NotePropertyValue $asgn -Force
        Save-Json -Obj $detail -Path (Join-Path $p "$(($c).ToString('D3'))_$(Get-SafeName $s.displayName).json")
        Write-Host "     $($s.displayName)" -ForegroundColor Gray; $c++
    }; return $c
}

# 10. App Protection
Export-Cat -Id "10_AppProtection" -Name "App Protection Policies" -Action {
    param($p)
    $pols = Get-AllPages -Uri "$BetaUri/deviceAppManagement/managedAppPolicies?`$top=100"
    $c = 0
    foreach ($pol in $pols) {
        Save-Json -Obj $pol -Path (Join-Path $p "$(($c).ToString('D3'))_$(Get-SafeName $pol.displayName).json")
        Write-Host "     $($pol.displayName)" -ForegroundColor Gray; $c++
    }; return $c
}

# 11. App Config
Export-Cat -Id "11_AppConfiguration" -Name "App Configuration Policies" -Action {
    param($p)
    $cfgs = Get-AllPages -Uri "$BetaUri/deviceAppManagement/mobileAppConfigurations?`$top=100"
    $c = 0
    foreach ($cfg in $cfgs) {
        Save-Json -Obj $cfg -Path (Join-Path $p "$(($c).ToString('D3'))_$(Get-SafeName $cfg.displayName).json")
        Write-Host "     $($cfg.displayName)" -ForegroundColor Gray; $c++
    }; return $c
}

# 12. Filters
Export-Cat -Id "12_Filters" -Name "Assignment Filters" -Action {
    param($p)
    $fs = Get-AllPages -Uri "$BetaUri/deviceManagement/assignmentFilters?`$top=100"
    $c = 0
    foreach ($f in $fs) {
        Save-Json -Obj $f -Path (Join-Path $p "$(($c).ToString('D3'))_$(Get-SafeName $f.displayName).json")
        Write-Host "     $($f.displayName)" -ForegroundColor Gray; $c++
    }; return $c
}

# 13. Admin Templates
Export-Cat -Id "13_AdminTemplates" -Name "Administrative Templates (GPO)" -Action {
    param($p)
    $gps = Get-AllPages -Uri "$BetaUri/deviceManagement/groupPolicyConfigurations?`$top=100"
    $c = 0
    foreach ($gp in $gps) {
        $dvs = Get-AllPages -Uri "$BetaUri/deviceManagement/groupPolicyConfigurations/$($gp.id)/definitionValues?`$expand=definition"
        foreach ($dv in $dvs) {
            try {
                $pvs = Get-AllPages -Uri "$BetaUri/deviceManagement/groupPolicyConfigurations/$($gp.id)/definitionValues/$($dv.id)/presentationValues"
                $dv | Add-Member -NotePropertyName "_presentationValues" -NotePropertyValue $pvs -Force
            } catch {}
        }
        $asgn = Get-Assignments -Uri "$BetaUri/deviceManagement/groupPolicyConfigurations/$($gp.id)"
        $exp = @{ displayName=$gp.displayName; description=$gp.description; definitionValues=$dvs; assignments=$asgn }
        Save-Json -Obj $exp -Path (Join-Path $p "$(($c).ToString('D3'))_$(Get-SafeName $gp.displayName).json")
        Write-Host "     $($gp.displayName) ($($dvs.Count) settings)" -ForegroundColor Gray; $c++
    }; return $c
}

# 14. Update Rings
Export-Cat -Id "14_UpdateRings" -Name "Windows Update Rings" -Action {
    param($p)
    $us = Get-AllPages -Uri "$BetaUri/deviceManagement/deviceConfigurations?`$filter=isof('microsoft.graph.windowsUpdateForBusinessConfiguration')&`$top=100"
    $c = 0
    foreach ($u in $us) {
        $asgn = Get-Assignments -Uri "$BetaUri/deviceManagement/deviceConfigurations/$($u.id)"
        $u | Add-Member -NotePropertyName "_assignments" -NotePropertyValue $asgn -Force
        Save-Json -Obj $u -Path (Join-Path $p "$(($c).ToString('D3'))_$(Get-SafeName $u.displayName).json")
        Write-Host "     $($u.displayName)" -ForegroundColor Gray; $c++
    }; return $c
}

# [4/4] Resumen
Write-Host "`n[4/4] Resumen" -ForegroundColor Yellow
$txt = @"
====================================================================
  EXPORTACION INTUNE v4 - $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
  Tenant: $($ctx.TenantId) | Cuenta: $($ctx.Account)
  Ruta:   $((Resolve-Path $ExportRoot).Path)
====================================================================

"@
$txt += ($Summary | Format-Table -AutoSize | Out-String)
$txt += "`nTotal: $($Summary | Measure-Object -Property Elementos -Sum | Select-Object -ExpandProperty Sum) elementos`n"
$txt | Out-File (Join-Path $ExportRoot "EXPORT_SUMMARY.txt") -Encoding UTF8
$txt | Write-Host -ForegroundColor Cyan
Write-Host "Exportacion completada!`n" -ForegroundColor Green
Disconnect-MgGraph | Out-Null
