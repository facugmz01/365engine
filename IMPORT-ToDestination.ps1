<#
.SYNOPSIS
    IMPORT-ToDestination.ps1
    Importa las politicas exportadas del tenant origen al tenant DESTINO.
    Usa los JSON exactos generados por EXPORT-FromSource.ps1.

.NOTES
    Ejecutar en el TENANT DESTINO
    Requisitos: PowerShell 7+, Microsoft.Graph module
    Permisos:   DeviceManagementConfiguration.ReadWrite.All, Group.Read.All
#>

#=============================================================
# CONFIGURACION - EDITAR ANTES DE EJECUTAR
#=============================================================

# Ruta a los JSON exportados (misma carpeta si estan juntos, o ".\intune_export")
$JsonPath = "."

# Grupos del CLIENTE DESTINO para asignacion
# Modificar estos nombres segun los grupos que existan en el tenant destino
$AutopilotGroups = @(
    "GS-Autopilot-Hybrid-Join-NB",
    "GS-Autopilot-Hybrid-Join-PC",
    "GS-Autopilot-NB",
    "GS-Autopilot-PC"
)

# Configuracion por politica
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

function Import-Policy {
    param([string]$FilePath)

    if (-not (Test-Path $FilePath)) {
        Write-Host "  ERROR: $FilePath no encontrado" -ForegroundColor Red
        return $null
    }

    $json = Get-Content $FilePath -Raw | ConvertFrom-Json

    # Construir body SOLO con campos validos de la API (excluir _metadata)
    $bodyHash = @{
        name         = $json.name
        description  = $json.description
        platforms    = $json.platforms
        technologies = $json.technologies
        settings     = $json.settings
    }

    # Incluir templateReference si existe (critico para que la API acepte la politica)
    if ($json.templateReference) {
        $bodyHash.templateReference = $json.templateReference
    }

    $body = $bodyHash | ConvertTo-Json -Depth 50 -Compress

    try {
        $response = Invoke-MgGraphRequest -Method POST -Uri $GraphUri `
                    -Body $body -ContentType "application/json"

        Write-Host "  OK Creada: $($json.name)" -ForegroundColor Green
        Write-Host "     ID: $($response.id)" -ForegroundColor Gray
        return $response.id
    }
    catch {
        Write-Host "  ERROR al crear '$($json.name)':" -ForegroundColor Red

        # Mostrar el detalle COMPLETO del error de la API
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            try {
                $errorBody = $_.ErrorDetails.Message | ConvertFrom-Json
                Write-Host "     Codigo:  $($errorBody.error.code)" -ForegroundColor Red
                Write-Host "     Mensaje: $($errorBody.error.message)" -ForegroundColor Red

                # Mostrar detalles internos si existen
                if ($errorBody.error.innerError) {
                    Write-Host "     Inner:   $($errorBody.error.innerError | ConvertTo-Json -Depth 5 -Compress)" -ForegroundColor DarkRed
                }
                if ($errorBody.error.details) {
                    foreach ($detail in $errorBody.error.details) {
                        Write-Host "     Detalle:  [$($detail.code)] $($detail.message)" -ForegroundColor DarkRed
                    }
                }
            }
            catch {
                Write-Host "     Raw: $($_.ErrorDetails.Message)" -ForegroundColor Red
            }
        }
        else {
            Write-Host "     $($_.Exception.Message)" -ForegroundColor Red
        }
        return $null
    }
}

function Assign-Policy {
    param([string]$PolicyId, [string]$AssignTo, [string[]]$Groups)

    $assignments = @()

    if ($AssignTo -eq "AllDevices") {
        $assignments += @{
            target = @{ "@odata.type" = "#microsoft.graph.allDevicesAssignmentTarget" }
        }
        $label = "Todos los dispositivos"
    }
    else {
        foreach ($g in $Groups) {
            try {
                $found = Invoke-MgGraphRequest -Method GET `
                    -Uri "https://graph.microsoft.com/v1.0/groups?`$filter=displayName eq '$g'&`$select=id,displayName"

                if ($found.value.Count -gt 0) {
                    $assignments += @{
                        target = @{
                            "@odata.type" = "#microsoft.graph.groupAssignmentTarget"
                            groupId       = $found.value[0].id
                        }
                    }
                    Write-Host "     Grupo OK: $g" -ForegroundColor Gray
                }
                else {
                    Write-Host "     AVISO: Grupo '$g' no encontrado" -ForegroundColor Yellow
                }
            }
            catch {
                Write-Host "     AVISO: Error buscando '$g'" -ForegroundColor Yellow
            }
        }
        $label = "$($assignments.Count) grupo(s)"
    }

    if ($assignments.Count -eq 0) {
        Write-Host "     Sin asignaciones validas. Politica creada sin asignar." -ForegroundColor Yellow
        return
    }

    $body = @{ assignments = $assignments } | ConvertTo-Json -Depth 10 -Compress

    try {
        Invoke-MgGraphRequest -Method POST `
            -Uri "$GraphUri/$PolicyId/assign" `
            -Body $body -ContentType "application/json" | Out-Null
        Write-Host "     OK Asignada a: $label" -ForegroundColor Cyan
    }
    catch {
        Write-Host "     ERROR asignacion: $($_.Exception.Message)" -ForegroundColor Red
    }
}

#=============================================================
# EJECUCION
#=============================================================

Write-Host "`n====================================================================" -ForegroundColor Cyan
Write-Host "  IMPORTACION DE POLITICAS - TENANT DESTINO" -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan

# Conectar
Write-Host "`n[1/4] Conectando a Microsoft Graph..." -ForegroundColor Yellow
if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) {
    Install-Module Microsoft.Graph -Scope CurrentUser -Force -AllowClobber
}
Import-Module Microsoft.Graph.Authentication -Force
Connect-MgGraph -Scopes @("DeviceManagementConfiguration.ReadWrite.All","Group.Read.All") -NoWelcome
$ctx = Get-MgContext
Write-Host "  OK Conectado: $($ctx.Account)" -ForegroundColor Green
Write-Host "  OK Tenant:    $($ctx.TenantId)" -ForegroundColor Green

# Verificar archivos
Write-Host "`n[2/4] Verificando archivos..." -ForegroundColor Yellow
$allOk = $true
foreach ($p in $PolicyConfig) {
    $fp = Join-Path $JsonPath $p.File
    if (Test-Path $fp) {
        $size = (Get-Item $fp).Length
        Write-Host "  OK $($p.File) ($size bytes)" -ForegroundColor Green
    }
    else {
        Write-Host "  FALTA $($p.File)" -ForegroundColor Red
        $allOk = $false
    }
}
if (-not $allOk) {
    Write-Host "`nERROR: Faltan archivos JSON en: $JsonPath" -ForegroundColor Red
    Write-Host "Primero ejecutar EXPORT-FromSource.ps1 en el tenant origen.`n" -ForegroundColor Yellow
    exit 1
}

# Importar
Write-Host "`n[3/4] Importando politicas..." -ForegroundColor Yellow
$created = 0; $failed = 0

foreach ($p in $PolicyConfig) {
    Write-Host "`n  >> $($p.Desc)" -ForegroundColor White
    Write-Host "  ----------------------------------------" -ForegroundColor Gray

    $fp = Join-Path $JsonPath $p.File
    $policyId = Import-Policy -FilePath $fp

    if ($policyId) {
        # Usar assignTo del JSON metadata si existe, sino del config
        $assignTo = $p.AssignTo
        try {
            $jsonData = Get-Content $fp -Raw | ConvertFrom-Json
            if ($jsonData._metadata -and $jsonData._metadata.assignTo) {
                $assignTo = $jsonData._metadata.assignTo
            }
        } catch {}

        Assign-Policy -PolicyId $policyId -AssignTo $assignTo -Groups $AutopilotGroups
        $created++
    }
    else {
        $failed++
    }
}

# Resumen
Write-Host "`n[4/4] Resumen" -ForegroundColor Yellow
Write-Host "  ============================================" -ForegroundColor Gray
Write-Host "  Creadas exitosamente: $created / $($PolicyConfig.Count)" -ForegroundColor $(if ($created -eq $PolicyConfig.Count) { "Green" } else { "Yellow" })
if ($failed -gt 0) {
    Write-Host "  Fallidas:             $failed / $($PolicyConfig.Count)" -ForegroundColor Red
}

Write-Host "`n  Verificar en: https://intune.microsoft.com" -ForegroundColor White
Write-Host "    > Endpoint Security > Attack Surface Reduction" -ForegroundColor Gray
Write-Host "    > Endpoint Security > Antivirus" -ForegroundColor Gray
Write-Host "    > Endpoint Security > Firewall" -ForegroundColor Gray

Write-Host "`n  Verificar en dispositivo:" -ForegroundColor Yellow
Write-Host "    Get-MpPreference | Select DisableRealtimeMonitoring, EnableNetworkProtection" -ForegroundColor Gray
Write-Host "    Get-MpComputerStatus | Select IsTamperProtected, AntivirusEnabled" -ForegroundColor Gray
Write-Host "    Get-NetFirewallProfile | Select Name, Enabled, DefaultInboundAction" -ForegroundColor Gray

Disconnect-MgGraph | Out-Null
Write-Host "`nProceso completado!`n" -ForegroundColor Green
