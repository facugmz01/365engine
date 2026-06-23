<#
.SYNOPSIS
    IMPORT-AllPolicies.ps1 - Importa 5 politicas de seguridad en Intune via Graph API

.NOTES
    Requisitos: PowerShell 7+, Microsoft.Graph module
    Permisos:   DeviceManagementConfiguration.ReadWrite.All, Group.Read.All
#>

#=============================================================
# CONFIGURACION - EDITAR ANTES DE EJECUTAR
#=============================================================

$JsonPath = "."

# Nombres de grupos del CLIENTE DESTINO
$AutopilotGroups = @(
    "GS-Autopilot-Hybrid-Join-NB",
    "GS-Autopilot-Hybrid-Join-PC",
    "GS-Autopilot-NB",
    "GS-Autopilot-PC"
)

$PolicyConfig = @(
    @{ File = "01_ASR_Rules.json";           AssignTo = "AllDevices";      Desc = "Reglas ASR" },
    @{ File = "02_Defender_AV_Config.json";  AssignTo = "AutopilotGroups"; Desc = "Defender Antivirus" },
    @{ File = "03_Security_Experience.json"; AssignTo = "AllDevices";      Desc = "Security Experience" },
    @{ File = "04_Update_Controls.json";     AssignTo = "AutopilotGroups"; Desc = "Update Controls Ring 3" },
    @{ File = "05_Firewall.json";            AssignTo = "AutopilotGroups"; Desc = "Windows Firewall" }
)

#=============================================================
# FUNCIONES
#=============================================================

$GraphUri = "https://graph.microsoft.com/beta/deviceManagement/configurationPolicies"
$ErrorActionPreference = "Stop"

function Connect-ToGraph {
    Write-Host "`n[1/4] Conectando a Microsoft Graph..." -ForegroundColor Yellow
    if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) {
        Install-Module Microsoft.Graph -Scope CurrentUser -Force -AllowClobber
    }
    Import-Module Microsoft.Graph.Authentication -Force
    Connect-MgGraph -Scopes @("DeviceManagementConfiguration.ReadWrite.All","Group.Read.All") -NoWelcome
    $ctx = Get-MgContext
    Write-Host "  OK Conectado: $($ctx.Account) | Tenant: $($ctx.TenantId)" -ForegroundColor Green
}

function Import-Policy {
    param([string]$FilePath)
    if (-not (Test-Path $FilePath)) { Write-Host "  ERROR: $FilePath no existe" -ForegroundColor Red; return $null }
    $json = Get-Content $FilePath -Raw | ConvertFrom-Json
    $body = @{
        name = $json.name; description = $json.description
        platforms = $json.platforms; technologies = $json.technologies; settings = $json.settings
    } | ConvertTo-Json -Depth 30 -Compress
    try {
        $r = Invoke-MgGraphRequest -Method POST -Uri $GraphUri -Body $body -ContentType "application/json"
        Write-Host "  OK Creada: $($json.name) (ID: $($r.id))" -ForegroundColor Green
        return $r.id
    } catch {
        Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red; return $null
    }
}

function Assign-Policy {
    param([string]$PolicyId, [string]$AssignTo, [string[]]$Groups)
    $assignments = @()
    if ($AssignTo -eq "AllDevices") {
        $assignments += @{ target = @{ "@odata.type" = "#microsoft.graph.allDevicesAssignmentTarget" } }
        $label = "Todos los dispositivos"
    } else {
        foreach ($g in $Groups) {
            try {
                $found = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/v1.0/groups?`$filter=displayName eq '$g'&`$select=id"
                if ($found.value.Count -gt 0) {
                    $assignments += @{ target = @{ "@odata.type" = "#microsoft.graph.groupAssignmentTarget"; groupId = $found.value[0].id } }
                    Write-Host "     Grupo: $g" -ForegroundColor Gray
                } else { Write-Host "     AVISO: Grupo '$g' no encontrado" -ForegroundColor Yellow }
            } catch { Write-Host "     AVISO: Error buscando '$g'" -ForegroundColor Yellow }
        }
        $label = "$($assignments.Count) grupo(s)"
    }
    if ($assignments.Count -eq 0) { Write-Host "     Sin asignaciones validas" -ForegroundColor Yellow; return }
    $body = @{ assignments = $assignments } | ConvertTo-Json -Depth 10 -Compress
    try {
        Invoke-MgGraphRequest -Method POST -Uri "$GraphUri/$PolicyId/assign" -Body $body -ContentType "application/json" | Out-Null
        Write-Host "     OK Asignada a: $label" -ForegroundColor Cyan
    } catch { Write-Host "     ERROR asignacion: $($_.Exception.Message)" -ForegroundColor Red }
}

#=============================================================
# EJECUCION
#=============================================================

Write-Host "`n====================================================================" -ForegroundColor Cyan
Write-Host "  IMPORTACION DE POLITICAS DE SEGURIDAD - MICROSOFT INTUNE" -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan

Connect-ToGraph

Write-Host "`n[2/4] Verificando archivos..." -ForegroundColor Yellow
$ok = $true
foreach ($p in $PolicyConfig) {
    $fp = Join-Path $JsonPath $p.File
    if (Test-Path $fp) { Write-Host "  OK $($p.File)" -ForegroundColor Green }
    else { Write-Host "  FALTA $($p.File)" -ForegroundColor Red; $ok = $false }
}
if (-not $ok) { Write-Host "`nERROR: Faltan archivos. Ruta: $JsonPath" -ForegroundColor Red; exit 1 }

Write-Host "`n[3/4] Importando politicas..." -ForegroundColor Yellow
$created = 0; $failed = 0
foreach ($p in $PolicyConfig) {
    Write-Host "`n  >> $($p.Desc)" -ForegroundColor White
    $id = Import-Policy -FilePath (Join-Path $JsonPath $p.File)
    if ($id) { Assign-Policy -PolicyId $id -AssignTo $p.AssignTo -Groups $AutopilotGroups; $created++ }
    else { $failed++ }
}

Write-Host "`n[4/4] Resumen" -ForegroundColor Yellow
Write-Host "  Creadas: $created/$($PolicyConfig.Count)" -ForegroundColor Green
if ($failed -gt 0) { Write-Host "  Fallidas: $failed" -ForegroundColor Red }

Write-Host "`n  Verificar en: https://intune.microsoft.com" -ForegroundColor White
Write-Host "  PowerShell en dispositivo:" -ForegroundColor Yellow
Write-Host "    Get-MpPreference | Select DisableRealtimeMonitoring, EnableNetworkProtection" -ForegroundColor Gray
Write-Host "    Get-MpComputerStatus | Select IsTamperProtected, AntivirusEnabled" -ForegroundColor Gray
Write-Host "    Get-NetFirewallProfile | Select Name, Enabled, DefaultInboundAction`n" -ForegroundColor Gray

Disconnect-MgGraph | Out-Null
Write-Host "Proceso completado!`n" -ForegroundColor Green
