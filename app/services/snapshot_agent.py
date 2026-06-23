import asyncio
import logging

logger = logging.getLogger(__name__)

async def fetch_tcm_snapshot(client, workloads: list[str]) -> list[dict]:
    """
    Creates a TCM Snapshot Job for the specified workloads, polls until it completes,
    and returns the raw snapshot data.
    """
    endpoint = "https://graph.microsoft.com/beta/admin/configurationManagement/configurationSnapshots/createSnapshot"
    payload = {
        "displayName": "NEXUS Automated TCM Snapshot",
        "description": "Triggered by NEXUS engine",
        "resources": workloads
    }
    
    logger.info(f"Creating TCM snapshot job for workloads: {workloads}...")
    job_res = await client.post_resource(endpoint=endpoint, payload=payload)
    job_id = job_res.get("id")
    if not job_id:
        raise ValueError(f"Failed to create TCM snapshot job: {job_res}")
        
    logger.info(f"TCM Snapshot Job created with ID: {job_id}. Polling status...")
    
    poll_url = f"https://graph.microsoft.com/beta/admin/configurationManagement/configurationSnapshotJobs/{job_id}"
    max_attempts = 40  # 40 * 15 seconds = 10 minutes max
    attempt = 0
    job_completed = False
    resource_location = None
    
    while attempt < max_attempts:
        attempt += 1
        logger.info(f"Polling TCM Snapshot Job status (Attempt {attempt}/{max_attempts})...")
        try:
            job_status_res = await client.get_resource(poll_url)
            status = job_status_res.get("status")
            logger.info(f"Job status: {status}")
            
            if status == "completed":
                job_completed = True
                resource_location = job_status_res.get("resourceLocation")
                break
            elif status == "failed":
                error_details = job_status_res.get("errorDetails", "Unknown error")
                raise RuntimeError(f"TCM Snapshot Job failed: {error_details}")
        except Exception as poll_err:
            logger.warning(f"Error polling TCM snapshot job {job_id}: {poll_err}. Retrying...")
        
        await asyncio.sleep(15)
        
    if not job_completed:
        raise TimeoutError(f"TCM Snapshot Job {job_id} timed out without completing.")
        
    if not resource_location:
        raise ValueError(f"TCM Snapshot Job {job_id} completed but is missing resourceLocation.")
        
    logger.info(f"Downloading TCM snapshot report from location: {resource_location}...")
    report_data = await client.get_resource(resource_location)
    
    raw_resources = []
    if isinstance(report_data, dict):
        if "value" in report_data and isinstance(report_data["value"], list):
            raw_resources = report_data["value"]
        else:
            raw_resources = [report_data]
    elif isinstance(report_data, list):
        raw_resources = report_data
        
    return raw_resources
