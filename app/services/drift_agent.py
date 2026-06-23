import logging
from typing import List, Dict, Any
from app.services.graph_agent import GraphAPIClient
from app.models import ConfigurationTemplate

logger = logging.getLogger("app.services.drift_agent")

async def compare_template_with_remote(client: GraphAPIClient, template: ConfigurationTemplate) -> Dict[str, Any]:
    """
    Compares a local ConfigurationTemplate payload with the remote Graph API to determine drift or simulation impact.
    """
    endpoint = template.endpoint
    local_payload = template.payload
    template_name = template.name or local_payload.get("displayName") or local_payload.get("name")

    result = {
        "template_id": str(template.id),
        "template_name": template_name,
        "endpoint": endpoint,
        "status": "unknown", # create, update, skip, drift_detected
        "remote_id": None,
        "diff": {}
    }

    if not template_name:
        result["status"] = "error"
        result["diff"] = {"error": "Template is missing a recognizable name for matching."}
        return result

    # Try to find the policy remotely by name
    # We query the collection endpoint
    try:
        remote_data = await client.get_resource(endpoint)
        items = []
        if isinstance(remote_data, dict):
            items = remote_data.get("value", [])
        elif isinstance(remote_data, list):
            items = remote_data

        # Find match by name
        match = None
        for item in items:
            item_name = item.get("displayName") or item.get("name")
            if item_name == template_name:
                match = item
                break

        if not match:
            result["status"] = "create"
            result["diff"] = {"info": "Resource does not exist remotely. Will be created."}
            return result

        result["remote_id"] = match.get("id")
        
        # Compare keys
        # We ignore read-only and metadata keys
        ignore_keys = {"id", "version", "createdDateTime", "lastModifiedDateTime", "@odata.context", "@odata.nextLink", "_assignments", "_metadata", "roleScopeTagIds"}
        drift_keys = []
        
        for k, local_val in local_payload.items():
            if k in ignore_keys:
                continue
            remote_val = match.get(k)
            # Simple equality check
            if local_val != remote_val:
                drift_keys.append({
                    "property": k,
                    "local": local_val,
                    "remote": remote_val
                })

        if drift_keys:
            result["status"] = "update" # Or 'drift_detected' if running drift scan
            result["diff"] = {"mismatches": drift_keys}
        else:
            result["status"] = "skip"
            result["diff"] = {"info": "Remote resource perfectly matches local template."}

    except Exception as e:
        logger.warning(f"Failed to compare template {template_name} at {endpoint}: {e}")
        result["status"] = "error"
        result["diff"] = {"error": str(e)}

    return result

async def run_simulation(client: GraphAPIClient, templates: List[ConfigurationTemplate]) -> Dict[str, Any]:
    """
    Runs a simulation against the remote tenant for a list of templates.
    """
    results = []
    summary = {"create": 0, "update": 0, "skip": 0, "error": 0}

    for template in templates:
        comp = await compare_template_with_remote(client, template)
        results.append(comp)
        
        status = comp["status"]
        if status in summary:
            summary[status] += 1
        elif status == "drift_detected":
            summary["update"] += 1

    return {
        "summary": summary,
        "details": results
    }

async def run_drift_scan(client: GraphAPIClient, templates: List[ConfigurationTemplate]) -> Dict[str, Any]:
    """
    Runs a drift scan. It's essentially the same as simulation but formatted differently.
    """
    sim_result = await run_simulation(client, templates)
    
    # Re-map 'update' to 'drift_detected'
    drift_items = []
    for item in sim_result["details"]:
        if item["status"] == "update":
            item["status"] = "drift_detected"
            drift_items.append(item)
        elif item["status"] == "create":
            item["status"] = "missing_remotely"
            drift_items.append(item)

    return {
        "drifts_found": len(drift_items),
        "details": drift_items
    }
