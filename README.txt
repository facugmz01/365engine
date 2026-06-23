# ============================================================
# INTUNE FULL MIGRATION TOOLKIT - FINAL
# EXPORT v4 + IMPORT v6
# ============================================================

## Archivos
# EXPORT-AllIntune.ps1  -> Exporta TODO de Intune (tenant origen)
# IMPORT-AllIntune.ps1  -> Importa al tenant destino (interactivo + licencias)
# README.txt            -> Este archivo

## 14 Categorias
# 01. Settings Catalog (ASR, AV, Firewall, etc.)
# 02. Device Configuration Profiles
# 03. Compliance Policies
# 04. Endpoint Security (Intents/Templates)
# 05. Conditional Access *
# 06. Autopilot Deployment Profiles
# 07. Enrollment Configurations (ESP, Restricciones)
# 08. PowerShell Scripts (con .ps1 decodificado)
# 09. Proactive Remediations
# 10. App Protection Policies
# 11. App Configuration Policies
# 12. Assignment Filters
# 13. Administrative Templates (GPO)
# 14. Windows Update Rings

## Funcionalidades del EXPORT
# - 14 categorias con paginacion completa
# - Scopes ReadWrite (fix para Scripts/Remediations)
# - Verificacion de permisos con reintento automatico
# - Exporta assignments de cada politica
# - Scripts decodificados como .ps1

## Funcionalidades del IMPORT
# - Validacion de licencias del tenant destino:
#   * Intune (standalone, M365, EMS)
#   * Defender for Endpoint (P1/P2)
#   * Azure AD Premium P1/P2
#   * Tabla con Total/Usadas/Disponibles
#   * Alertas contextuales por categoria
# - Modo interactivo secuencial:
#   * Pregunta por cada CATEGORIA: S=Si, N=No, T=Todas
#   * Pregunta por cada POLITICA: S=Si, N=No, T=Todas en categoria
#   * $InteractiveMode = $false para modo automatico
# - Auto-creacion de grupos de Autopilot:
#   * 4 grupos dinamicos de dispositivos
#   * Detecta si ya existen
#   * Espacio para colocar MembershipRule
# - Error handling detallado (code + message + details)
# - Resumen con IMPORT_SUMMARY.txt

## Flujo completo

### PASO 1: Tenant ORIGEN
#   .\EXPORT-AllIntune.ps1
#   -> Genera IntuneExport_YYYYMMDD_HHMMSS/

### PASO 2: Revisar
#   - Eliminar exclusiones del cliente origen
#   - Ajustar horarios / rutas
#   - Eliminar referencias a grupos del tenant origen

### PASO 3: Tenant DESTINO
#   1. Editar IMPORT-AllIntune.ps1:
#      - $ImportPath = ruta a la carpeta exportada
#      - $AutopilotGroupsConfig = completar MembershipRule
#      - $InteractiveMode = $true (recomendado)
#      - $SkipAssignments = $true (recomendado)
#   2. Ejecutar: .\IMPORT-AllIntune.ps1
#   3. Seguir las indicaciones interactivas

### PASO 4: Verificar
#   - https://intune.microsoft.com
#   - https://entra.microsoft.com > Groups

## Permisos Graph API
# EXPORT:
#   DeviceManagementConfiguration.ReadWrite.All
#   DeviceManagementManagedDevices.ReadWrite.All
#   DeviceManagementApps.ReadWrite.All
#   DeviceManagementServiceConfig.ReadWrite.All
#   DeviceManagementRBAC.ReadWrite.All
#   Policy.Read.All
#   Policy.Read.ConditionalAccess
#
# IMPORT:
#   DeviceManagementConfiguration.ReadWrite.All
#   DeviceManagementManagedDevices.ReadWrite.All
#   DeviceManagementApps.ReadWrite.All
#   DeviceManagementServiceConfig.ReadWrite.All
#   DeviceManagementRBAC.ReadWrite.All
#   Policy.ReadWrite.ConditionalAccess
#   Group.ReadWrite.All
#   Organization.Read.All

## Advertencias
# - Conditional Access se importa DESHABILITADA
# - Asignaciones deshabilitadas por defecto
# - Grupos dinamicos tardan ~5 min en poblar miembros
# - Si MembershipRule no se edita, el grupo se crea sin regla funcional
# - Scripts: si Forbidden persiste, la cuenta necesita Intune Admin
