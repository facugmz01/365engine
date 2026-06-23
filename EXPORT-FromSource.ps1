<#
.SYNOPSIS
    EXPORT-FromSource.ps1
    Exporta las 5 politicas de seguridad del tenant ORIGEN con la estructura
    JSON exacta que requiere la Graph API para reimportarlas.

.NOTES
    Ejecutar en el TENANT ORIGEN (donde ya existen las politicas)
    Requisitos: PowerShell 7+, Microsoft.Graph module
    Permisos:   DeviceManagementConfiguration.Read.All
#>

#=============================================================
# CONFIGURACION
#=============================================================

$ExportPath = ".\intune_export"

# Nombres exactos de las politicas a exportar
$PoliciesToExport = @(
    @{ Name = "ASR_WIN_PRO_GP_ASR-Rules_D";                                    File = "01_ASR_Rules.json";           Desc = "Reglas ASR" },
    @{ Name = "SCR_WIN_PRO_GP_Defender-Antivirus-Configuration_D";              File = "02_Defender_AV_Config.json";  Desc = "Defender Antivirus" },
    @{ Name = "SCR_WIN_PRO_GP_Defender-Antivirus-Security-Experience_D";        File = "03_Security_Experience.json"; Desc = "Security Experience" },
    @{ Name = "SEC_WIN_PRO_GP_Defender-Antivirus-Updates-Ring-3-Production_D";  File = "04_Update_Controls.json";     Desc = "Update Controls Ring 3" },
    @{ Name = "FW_WIN_PRO_GP_CFG_D";                                            File = "05_Firewall.json";            Desc = "Windows Firewall" }
)

# Asignacion deseada para cada politica en el tenant destino
$AssignmentMap = @{
    "01_ASR_Rules.json"           = "AllDevices"
    "02_Defender_AV_Config.json"  = "AutopilotGroups"
    "03_Security_Experience.json" = "AllDevices"
    "04_Update_Controls.json"     = "AutopilotGroups"
    "05_Firewall.json"            = "AutopilotGroups"
}

#=============================================================
# EJECUCION
#=============================================================

$ErrorActionPreference = "Stop"
$BaseUri = "https://graph.microsoft.com/beta/deviceManagement/configurationPolicies"

Write-Host "`n====================================================================" -ForegroundColor Cyan
Write-Host "  EXPORTACION DE POLITICAS - TENANT ORIGEN" -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan

# Conectar
Write-Host "`n[1/3] Conectando a Microsoft Graph..." -ForegroundColor Yellow
if (-not (Get-Module -ListAvailable -Name Microsoft.Graph.Authentication)) {
    Install-Module Microsoft.Graph -Scope CurrentUser -Force -AllowClobber
}
Import-Module Microsoft.Graph.Authentication -Force
Connect-MgGraph -Scopes "DeviceManagementConfiguration.Read.All" -NoWelcome
$ctx = Get-MgContext
Write-Host "  OK Conectado: $($ctx.Account) | Tenant: $($ctx.TenantId)" -ForegroundColor Green

# Crear carpeta de exportacion
New-Item -ItemType Directory -Path $ExportPath -Force | Out-Null

# Exportar
Write-Host "`n[2/3] Exportando politicas..." -ForegroundColor Yellow
$exported = 0

foreach ($pol in $PoliciesToExport) {
    Write-Host "`n  >> $($pol.Desc) ($($pol.Name))" -ForegroundColor White

    # Buscar la politica por nombre
    $encodedName = [System.Uri]::EscapeDataString($pol.Name)
    $searchUri = "$BaseUri`?`$filter=name eq '$encodedName'"

    try {
        $result = Invoke-MgGraphRequest -Method GET -Uri $searchUri
    }
    catch {
        # Intentar sin filtro y buscar manualmente
        Write-Host "     Filtro no soportado, buscando manualmente..." -ForegroundColor Gray
        $all = Invoke-MgGraphRequest -Method GET -Uri $BaseUri
        $allPolicies = $all.value
        while ($all.'@odata.nextLink') {
            $all = Invoke-MgGraphRequest -Method GET -Uri $all.'@odata.nextLink'
            $allPolicies += $all.value
        }
        $result = @{ value = @($allPolicies | Where-Object { $_.name -eq $pol.Name }) }
    }

    if ($result.value.Count -eq 0) {
        Write-Host "     AVISO: Politica '$($pol.Name)' NO encontrada. Omitida." -ForegroundColor Yellow
        continue
    }

    $policy = $result.value[0]
    $policyId = $policy.id
    Write-Host "     ID: $policyId" -ForegroundColor Gray

    # Obtener settings con paginacion
    $settingsUri = "$BaseUri/$policyId/settings"
    $allSettings = @()

    do {
        $settingsResult = Invoke-MgGraphRequest -Method GET -Uri $settingsUri
        $allSettings += $settingsResult.value
        $settingsUri = $settingsResult.'@odata.nextLink'
    } while ($settingsUri)

    Write-Host "     Settings: $($allSettings.Count) encontrados" -ForegroundColor Gray

    # Construir objeto de exportacion (formato exacto para reimportar)
    $exportObj = @{
        name              = $policy.name
        description       = if ($policy.description) { $policy.description } else { "" }
        platforms         = $policy.platforms
        technologies      = $policy.technologies
        templateReference = $policy.templateReference
        settings          = $allSettings
        _metadata         = @{
            exportedFrom = $ctx.TenantId
            exportedDate = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
            exportedBy   = $ctx.Account
            assignTo     = $AssignmentMap[$pol.File]
            policyId     = $policyId
        }
    }

    # Guardar JSON
    $filePath = Join-Path $ExportPath $pol.File
    $exportObj | ConvertTo-Json -Depth 50 | Out-File $filePath -Encoding UTF8
    Write-Host "     OK Exportada: $filePath" -ForegroundColor Green
    $exported++
}

# Resumen
Write-Host "`n[3/3] Resumen" -ForegroundColor Yellow
Write-Host "  Exportadas: $exported / $($PoliciesToExport.Count)" -ForegroundColor Green
Write-Host "  Carpeta: $((Resolve-Path $ExportPath).Path)" -ForegroundColor Cyan
Write-Host "`n  Siguiente paso:" -ForegroundColor White
Write-Host "  1. Copiar la carpeta '$ExportPath' al equipo del tenant destino" -ForegroundColor White
Write-Host "  2. Ejecutar IMPORT-ToDestination.ps1 en el tenant destino`n" -ForegroundColor White

Disconnect-MgGraph | Out-Null
Write-Host "Exportacion completada!`n" -ForegroundColor Green
