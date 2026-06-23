# Centralized configuration template seeds (Default Baselines)
# These represent pre-generated configurations ready to be deployed to target M365 tenants.

baseline_seeds = [
    {
        "name": "[Baseline] Windows Firewall - Habilitado en Todos los Perfiles",
        "description": "Línea base para asegurar que el Firewall de Windows esté activo en perfiles Dominio, Privado y Público.",
        "category": "intune",
        "endpoint": "deviceManagement/configurationPolicies",
        "payload": {
            "displayName": "[Baseline] Windows Firewall - Habilitado en Todos los Perfiles",
            "description": "Línea base estándar para habilitar el firewall.",
            "platforms": "windows10AndLater",
            "technologies": "mdm",
            "templateReference": {
                "templateId": "device_firewall_configuration",
                "templateDisplayName": "Firewall configuration"
            },
            "settings": [
                {
                    "@odata.type": "#microsoft.graph.deviceManagementConfigurationSettingInstance",
                    "settingDefinitionId": "device_firewall_domain_profile_enabled",
                    "simpleSettingValue": {
                        "@odata.type": "#microsoft.graph.deviceManagementConfigurationIntegerSettingValue",
                        "value": 1
                    }
                },
                {
                    "@odata.type": "#microsoft.graph.deviceManagementConfigurationSettingInstance",
                    "settingDefinitionId": "device_firewall_private_profile_enabled",
                    "simpleSettingValue": {
                        "@odata.type": "#microsoft.graph.deviceManagementConfigurationIntegerSettingValue",
                        "value": 1
                    }
                },
                {
                    "@odata.type": "#microsoft.graph.deviceManagementConfigurationSettingInstance",
                    "settingDefinitionId": "device_firewall_public_profile_enabled",
                    "simpleSettingValue": {
                        "@odata.type": "#microsoft.graph.deviceManagementConfigurationIntegerSettingValue",
                        "value": 1
                    }
                }
            ]
        }
    },
    {
        "name": "[Baseline] Windows Defender - Protección en Tiempo Real y Antivirus",
        "description": "Línea base recomendada de seguridad antivirus de Defender, activando protección en la nube y escaneo en tiempo real.",
        "category": "defender",
        "endpoint": "deviceManagement/configurationPolicies",
        "payload": {
            "displayName": "[Baseline] Windows Defender - Protección en Tiempo Real y Antivirus",
            "description": "Protección básica antivirus para endpoints corporativos.",
            "platforms": "windows10AndLater",
            "technologies": "mdm",
            "templateReference": {
                "templateId": "device_antivirus_configuration",
                "templateDisplayName": "Antivirus configuration"
            },
            "settings": [
                {
                    "@odata.type": "#microsoft.graph.deviceManagementConfigurationSettingInstance",
                    "settingDefinitionId": "device_antivirus_realtime_protection_enabled",
                    "simpleSettingValue": {
                        "@odata.type": "#microsoft.graph.deviceManagementConfigurationIntegerSettingValue",
                        "value": 1
                    }
                },
                {
                    "@odata.type": "#microsoft.graph.deviceManagementConfigurationSettingInstance",
                    "settingDefinitionId": "device_antivirus_cloud_delivered_protection_enabled",
                    "simpleSettingValue": {
                        "@odata.type": "#microsoft.graph.deviceManagementConfigurationIntegerSettingValue",
                        "value": 1
                    }
                }
            ]
        }
    },
    {
        "name": "[Baseline] SharePoint - Compartido Externo Restringido",
        "description": "Asegura que SharePoint restrinja el compartido externo únicamente a invitados existentes o lo desactive según sea necesario.",
        "category": "sharepoint",
        "endpoint": "shares",
        "payload": {
            "displayName": "[Baseline] SharePoint - Compartido Externo Restringido",
            "externalSharingMode": "existingGuestsOnly"
        }
    },
    {
        "name": "[Baseline] Acceso Condicional - Bloqueo de Autenticación Heredada",
        "description": "Política de Entra ID que deniega el acceso a aplicaciones cuando se utilicen clientes de correo o protocolos antiguos sin soporte MFA.",
        "category": "entra_id",
        "endpoint": "identity/conditionalAccess/policies",
        "payload": {
            "displayName": "[Baseline] Acceso Condicional - Bloqueo de Autenticación Heredada",
            "state": "enabledForReportingButNotEnforced",
            "conditions": {
                "clientAppTypes": [
                    "exchangeActiveSync",
                    "other"
                ],
                "applications": {
                    "includeApplications": [
                        "All"
                    ]
                },
                "users": {
                    "includeUsers": [
                        "All"
                    ]
                }
            },
            "grantControls": {
                "operator": "OR",
                "builtInControls": [
                    "block"
                ]
            }
        }
    }
]
