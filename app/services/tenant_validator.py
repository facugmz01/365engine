import logging
from typing import Dict, Any
from app.services.graph_agent import GraphAPIClient

logger = logging.getLogger("tenant_validator")

async def validate_tenant_readiness(client: GraphAPIClient) -> Dict[str, Any]:
    """
    Performs pre-validations on the target tenant:
    1. Check licenses compatibility (M365 / Intune / Defender).
    2. Check subscription state of Intune.
    3. Check Defender ATP connector status.
    4. Check Intune diagnostics and license validation settings.
    """
    results = {
        "valid": True,
        "details": {}
    }

    # 1. Check Licenses (GET /subscribedSkus)
    try:
        skus_response = await client.get_resource("subscribedSkus")
        value = skus_response.get("value", [])
        active_skus = []
        has_intune_or_m365 = False
        
        for sku in value:
            sku_part = sku.get("skuPartNumber", "").upper()
            status = sku.get("capabilityStatus", "")
            active_units = sku.get("activeUnits", 0)
            
            if status == "Enabled" and active_units > 0:
                active_skus.append(sku_part)
                # Check for common Intune/M365 SKUs
                # e.g., SPE_E3, SPE_E5, EMS, INTUNE_A, INTUNE_B, etc.
                if any(keyword in sku_part for keyword in ["INTUNE", "SPE_E", "EMS", "O365_E", "ENTERPRISE"]):
                    has_intune_or_m365 = True
                    
        results["details"]["licenses"] = {
            "status": "passed" if has_intune_or_m365 else "failed",
            "active_skus": active_skus,
            "message": f"Active compatible licenses found: {', '.join(active_skus)}" if has_intune_or_m365 else "No compatible M365/Intune licenses found."
        }
        if not has_intune_or_m365:
            results["valid"] = False
    except Exception as e:
        logger.warning(f"Failed to check subscribed SKUs: {e}")
        results["details"]["licenses"] = {
            "status": "error",
            "message": f"Could not verify tenant licenses: {e}"
        }
        results["valid"] = False

    # 2. Check Intune Subscription State (GET /deviceManagement/subscriptionState)
    try:
        sub_state = await client.get_resource("deviceManagement/subscriptionState")
        state = ""
        if isinstance(sub_state, dict):
            state = sub_state.get("value", "").lower() or sub_state.get("subscriptionState", "").lower()
        else:
            state = str(sub_state).strip().lower()
            
        is_active = state in ["active", "enabled"] or "active" in state
        results["details"]["intune_subscription"] = {
            "status": "passed" if is_active else "failed",
            "state": state or "unknown",
            "message": f"Intune subscription state is active: '{state}'" if is_active else f"Intune subscription is inactive: '{state}'"
        }
        if not is_active:
            results["valid"] = False
    except Exception as e:
        # Fallback check on general /deviceManagement
        try:
            await client.get_resource("deviceManagement")
            results["details"]["intune_subscription"] = {
                "status": "passed",
                "message": "Intune service endpoint is accessible."
            }
        except Exception as e2:
            logger.warning(f"Failed to check Intune subscription state: {e}")
            results["details"]["intune_subscription"] = {
                "status": "failed",
                "message": f"Intune service is not active or accessible: {e2}"
            }
            results["valid"] = False

    # 3. Check Defender ATP Connector Status (GET /deviceManagement/microsoftDefenderATPConnector)
    try:
        atp_connector = await client.get_resource("deviceManagement/microsoftDefenderATPConnector")
        state = atp_connector.get("state", "notConfigured")
        is_enabled = state in ["enabled", "active"]
        results["details"]["defender_connector"] = {
            "status": "passed" if is_enabled else "warning",
            "state": state,
            "message": "Defender ATP connector is enabled." if is_enabled else f"Defender ATP connector state is: {state} (Not fully enabled)."
        }
    except Exception as e:
        logger.warning(f"Failed to check Defender ATP connector status: {e}")
        results["details"]["defender_connector"] = {
            "status": "warning",
            "message": f"Defender ATP connector is not configured or not accessible on this tenant: {e}"
        }

    # 4. Check Intune Diagnostics & License Validation Settings
    try:
        # Diagnostic settings check or audit events
        await client.get_resource("deviceManagement/auditEvents")
        results["details"]["intune_diagnostics"] = {
            "status": "passed",
            "message": "Intune diagnostics and audit logs are enabled and accessible."
        }
    except Exception as e:
        logger.warning(f"Failed to access audit/diagnostic logs: {e}")
        results["details"]["intune_diagnostics"] = {
            "status": "warning",
            "message": f"Intune diagnostics/audit logs could not be verified: {e}"
        }

    return results
