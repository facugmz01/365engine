import asyncio
import logging
import os
import sys
import uuid
from datetime import datetime, timezone
from celery import Celery
from sqlalchemy import select
from sqlalchemy.orm import selectinload

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("celery_worker")

# Ensure app imports are resolved correctly when run via celery command line
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.database.connection import async_session_maker
from app.models import DeploymentJob, DeploymentStatus, Organization, ConfigurationTemplate
from app.services import auth_agent, GraphAPIClient, validate_tenant_readiness

# Configure Celery
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

celery_app = Celery(
    "m365_cloner_worker",
    broker=REDIS_URL,
    backend=REDIS_URL
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)

from celery.schedules import crontab

celery_app.conf.beat_schedule = {
    'run-scheduled-drift-scans': {
        'task': 'app.tasks.run_periodic_drift_scheduler',
        'schedule': crontab(minute=0), # Run at the top of every hour
    },
}


# ==========================================
# HELPERS
# ==========================================

async def resolve_or_create_group(client: GraphAPIClient, group_def: dict) -> tuple[str, bool]:
    """
    Checks if a group exists in Entra ID by displayName.
    If it doesn't, creates it (static or dynamic) and returns (group_id, was_created).
    """
    name = group_def["display_name"]
    gtype = group_def["group_type"]
    rule = group_def.get("membership_rule")

    # 1. Search if group exists
    search_query = f"groups?$filter=displayName eq '{name}'&$select=id,displayName"
    try:
        response = await client.get_resource(search_query)
        if response.get("value") and len(response["value"]) > 0:
            group_id = response["value"][0]["id"]
            logger.info(f"Group '{name}' already exists in Entra ID. ID: {group_id}")
            return group_id, False
    except Exception as search_err:
        logger.warning(f"Error checking if group '{name}' exists: {search_err}. Proceeding to try creating it.")

    # 2. Group doesn't exist -> Create it
    # Nickname helper: alphanumeric without spaces
    nickname = "".join(c for c in name if c.isalnum() or c in ["-", "_"])[:64].lower()
    if not nickname:
        nickname = f"group-{uuid.uuid4().hex[:8]}"

    payload = {
        "displayName": name,
        "mailNickname": nickname,
        "securityEnabled": True,
        "mailEnabled": False,
        "groupTypes": ["DynamicMembership"] if gtype == "dynamic" else [],
    }

    if gtype == "dynamic" and rule:
        payload["membershipRule"] = rule
        payload["membershipRuleProcessingState"] = "On"

    logger.info(f"Creating {gtype} Entra ID group: '{name}'...")
    try:
        create_res = await client.post_resource("groups", payload)
        group_id = create_res.get("id")
        if not group_id:
            raise ValueError(f"Microsoft Graph response was missing 'id' field: {create_res}")
        logger.info(f"Successfully created group '{name}' with ID: {group_id}")
        return group_id, True
    except Exception as create_err:
        logger.error(f"Failed to create group '{name}': {create_err}")
        raise


async def rollback_deployment(client: GraphAPIClient, deployed_resources: list, created_group_ids: list) -> None:
    """
    Rolls back a deployment by deleting all successfully created policies and groups in reverse order.
    """
    logger.info(f"Initiating rollback. Deleting {len(deployed_resources)} policies and {len(created_group_ids)} groups...")
    
    # 1. Delete policies in reverse order
    for resource in reversed(deployed_resources):
        endpoint = resource["endpoint"]
        policy_id = resource["id"]
        delete_url = f"{endpoint.rstrip('/')}/{policy_id}"
        logger.info(f"Rollback: Deleting policy '{policy_id}' from endpoint '{endpoint}'...")
        try:
            await client.delete_resource(delete_url)
            logger.info(f"Successfully deleted policy {policy_id}")
        except Exception as delete_err:
            logger.error(f"Failed to delete policy {policy_id} during rollback: {delete_err}")

    # 2. Delete created groups
    for g_id in created_group_ids:
        logger.info(f"Rollback: Deleting created security group '{g_id}'...")
        try:
            await client.delete_resource(f"groups/{g_id}")
            logger.info(f"Successfully deleted group {g_id}")
        except Exception as delete_err:
            logger.error(f"Failed to delete group {g_id} during rollback: {delete_err}")


# ==========================================
# ASYNC WORKER IMPLEMENTATIONS
# ==========================================

async def append_log(session, job: "DeploymentJob", level: str, msg: str) -> None:
    """
    Appends a structured log entry to the DeploymentJob.logs list and commits immediately
    so the frontend can poll and display real-time progress.
    Levels: INFO | SUCCESS | ERROR | WARNING
    """
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    entry = {"ts": ts, "level": level, "msg": msg}
    
    # Mirror to system logger
    log_fn = {"INFO": logger.info, "SUCCESS": logger.info, "ERROR": logger.error, "WARNING": logger.warning}.get(level, logger.info)
    log_fn(f"[{level}] {msg}")
    
    # Append to job.logs (ensure it's a mutable list)
    current_logs = list(job.logs) if job.logs else []
    current_logs.append(entry)
    job.logs = current_logs
    
    # Use flag_modified to notify SQLAlchemy that the JSON column changed
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(job, "logs")
    await session.commit()

async def async_run_deployment(job_id: uuid.UUID) -> None:
    """
    Asynchronous implementation of the configuration deployment job.
    1. Runs pre-deployment tenant validations (licenses, connector states, diagnostics).
    2. Creates target Entra ID security groups (static/dynamic) if requested.
    3. Resolves group IDs.
    4. Deploys policies to Microsoft Graph.
    5. Automatically assigns policies to target groups or leaves them unassigned.
    """
    logger.info(f"Starting async configuration deployment for Job ID: {job_id}")
    
    async with async_session_maker() as session:
        stmt = (
            select(DeploymentJob)
            .where(DeploymentJob.id == job_id)
            .options(
                selectinload(DeploymentJob.organization)
                .selectinload(Organization.credentials),
                selectinload(DeploymentJob.templates)
            )
        )
        result = await session.execute(stmt)
        job = result.scalar_one_or_none()
        
        if not job:
            logger.error(f"Deployment job {job_id} was not found in the database.")
            return

        job.status = DeploymentStatus.RUNNING
        job.logs = []  # Initialize logs list
        await session.commit()
        await append_log(session, job, "INFO", f"Job iniciado (ID: {str(job_id)[:8]}...)")

        # Tracking arrays for rollback
        deployed_resources = []
        created_group_ids_list = []
        
        try:
            target_org = job.organization
            templates: list[ConfigurationTemplate] = job.templates
            params = job.parameters or {}

            if not target_org.credentials:
                raise ValueError(f"Target organization '{target_org.name}' has no registered credentials.")

            cred = target_org.credentials[0]

            await append_log(session, job, "INFO", f"Obteniendo token para tenant: {target_org.tenant_id}")
            access_token = await auth_agent.get_access_token(
                tenant_id=target_org.tenant_id,
                client_id=cred.client_id,
                client_secret=cred.client_secret
            )
            await append_log(session, job, "SUCCESS", f"Token obtenido correctamente para '{target_org.name}'")

            client = GraphAPIClient(access_token=access_token)

            # ==========================================
            # STAGE 0: PRE-VALIDATIONS
            # ==========================================
            bypass_validation = params.get("bypass_validation", False)
            if not bypass_validation:
                await append_log(session, job, "INFO", "Ejecutando validaciones previas del tenant...")
                validation_results = await validate_tenant_readiness(client)
                params["validation_results"] = validation_results
                job.parameters = params
                await session.commit()

                if not validation_results.get("valid", False):
                    await append_log(session, job, "ERROR", "Validación previa fallida: el tenant no tiene las licencias o suscripción de Intune activa.")
                    raise RuntimeError("Pre-validation failed: tenant is missing required licenses or Intune subscription is inactive.")
                else:
                    await append_log(session, job, "SUCCESS", "Validaciones previas superadas correctamente.")
            else:
                await append_log(session, job, "WARNING", "Validaciones previas omitidas por solicitud del usuario (bypass).")

            # ==========================================
            # STAGE 1: CREATE / RESOLVE GROUPS
            # ==========================================
            resolved_groups = {}  # display_name -> id
            create_groups_list = params.get("create_groups") or []
            
            if create_groups_list:
                await append_log(session, job, "INFO", f"Procesando {len(create_groups_list)} definición(es) de grupo...")
            
            for group_def in create_groups_list:
                try:
                    await append_log(session, job, "INFO", f"Resolviendo grupo '{group_def['display_name']}' ({group_def.get('group_type', 'static')})...")
                    g_id, was_created = await resolve_or_create_group(client, group_def)
                    resolved_groups[group_def["display_name"]] = g_id
                    if was_created:
                        created_group_ids_list.append(g_id)
                        await append_log(session, job, "SUCCESS", f"Grupo '{group_def['display_name']}' creado exitosamente. ID: {g_id}")
                    else:
                        await append_log(session, job, "INFO", f"Grupo '{group_def['display_name']}' ya existe. ID: {g_id}")
                except Exception as g_err:
                    await append_log(session, job, "ERROR", f"Error al resolver grupo '{group_def['display_name']}': {g_err}")
                    raise

            # ==========================================
            # STAGE 2: RESOLVE TARGET ASSIGNMENT IDS
            # ==========================================
            unique_group_names = set()
            
            # Global group names
            assign_to_groups = params.get("assign_to_groups") or []
            for name in assign_to_groups:
                unique_group_names.add(name)
                
            # Template-specific group names
            template_assignments_list = params.get("template_assignments") or []
            template_assignments_map = {}
            for ta in template_assignments_list:
                t_id = ta.get("template_id")
                if t_id:
                    template_assignments_map[str(t_id)] = ta
                    # Also collect group names for this specific assignment
                    t_groups = ta.get("assign_to_groups") or []
                    for name in t_groups:
                        unique_group_names.add(name)

            # Resolve all unique groups to IDs, using cached resolved_groups from Stage 1 if available
            resolved_group_ids = {}  # group_name -> id
            if unique_group_names:
                await append_log(session, job, "INFO", f"Resolviendo IDs para {len(unique_group_names)} grupo(s) de asignación...")
            for group_name in unique_group_names:
                if group_name in resolved_groups:
                    resolved_group_ids[group_name] = resolved_groups[group_name]
                else:
                    # Search group in the tenant by name
                    search_query = f"groups?$filter=displayName eq '{group_name}'&$select=id"
                    try:
                        response = await client.get_resource(search_query)
                        if response.get("value") and len(response["value"]) > 0:
                            g_id = response["value"][0]["id"]
                            resolved_group_ids[group_name] = g_id
                            await append_log(session, job, "SUCCESS", f"Grupo existente '{group_name}' resuelto a ID: {g_id}")
                        else:
                            await append_log(session, job, "WARNING", f"Grupo '{group_name}' no encontrado en el tenant destino.")
                    except Exception as res_err:
                        await append_log(session, job, "WARNING", f"Error al consultar grupo '{group_name}': {res_err}")

            # ==========================================
            # STAGE 3: DEPLOY POLICIES & APPLY ASSIGNMENTS
            # ==========================================
            deployed_count = 0
            global_assignment_target = params.get("assignment_target", "unassigned")
            await append_log(session, job, "INFO", f"Iniciando despliegue de {len(templates)} directiva(s)...")

            for idx, template in enumerate(templates):
                await append_log(session, job, "INFO", f"[{idx+1}/{len(templates)}] Desplegando '{template.name}' → {template.endpoint}")
                
                try:
                    payload = dict(template.payload)
                    payload.pop("_metadata", None)
                    
                    # 1. Create/Post resource
                    result_data = await client.post_resource(endpoint=template.endpoint, payload=payload)
                    policy_id = result_data.get("id")
                    await append_log(session, job, "SUCCESS", f"Política '{template.name}' desplegada exitosamente. ID remoto: {policy_id or 'N/A'}")
                    deployed_count += 1
                    
                    # 2. Assign resource (if policy_id exists)
                    if policy_id:
                        deployed_resources.append({"id": policy_id, "endpoint": template.endpoint})
                        
                        # Determine if there's a template-specific assignment configuration
                        t_assign = template_assignments_map.get(str(template.id))
                        if t_assign:
                            t_target = t_assign.get("assignment_target", "unassigned")
                            t_groups = t_assign.get("assign_to_groups") or []
                        else:
                            t_target = global_assignment_target
                            t_groups = assign_to_groups

                        if t_target != "unassigned":
                            # Create assignments body
                            assign_body = None
                            if t_target == "all_devices":
                                assign_body = {
                                    "assignments": [{
                                        "target": {"@odata.type": "#microsoft.graph.allDevicesAssignmentTarget"}
                                    }]
                                }
                            elif t_target == "all_users":
                                assign_body = {
                                    "assignments": [{
                                        "target": {"@odata.type": "#microsoft.graph.allLicensedUsersAssignmentTarget"}
                                    }]
                                }
                            elif t_target == "custom_groups":
                                # Resolve IDs for the specific target groups
                                target_ids = [resolved_group_ids[gn] for gn in t_groups if gn in resolved_group_ids]
                                if target_ids:
                                    assign_body = {
                                        "assignments": [
                                            {
                                                "target": {
                                                    "@odata.type": "#microsoft.graph.groupAssignmentTarget",
                                                    "groupId": g_id
                                                }
                                            } for g_id in target_ids
                                        ]
                                    }

                            if assign_body:
                                assign_endpoint = f"{template.endpoint.rstrip('/')}/{policy_id}/assign"
                                await append_log(session, job, "INFO", f"Asignando '{template.name}' → objetivo: {t_target}")
                                try:
                                    await client.post_resource(assign_endpoint, assign_body)
                                    groups_str = ", ".join(t_groups) if t_groups else t_target
                                    await append_log(session, job, "SUCCESS", f"Política '{template.name}' asignada a: {groups_str}")
                                except Exception as assign_err:
                                    await append_log(session, job, "WARNING", f"No se pudo asignar '{template.name}' vía '{assign_endpoint}': {assign_err}")

                except Exception as api_err:
                    await append_log(session, job, "ERROR", f"Error al desplegar '{template.name}': {api_err}")
                    raise RuntimeError(f"Failed at template '{template.name}': {api_err}")

            # Save successfully deployed resources to parameters for future manual rollbacks
            params["deployed_resources"] = deployed_resources
            params["created_groups_resolved"] = created_group_ids_list
            job.parameters = params
            job.status = DeploymentStatus.COMPLETED
            job.completed_at = datetime.now(timezone.utc)
            await session.commit()
            await append_log(session, job, "SUCCESS", f"✓ Despliegue completado. {deployed_count}/{len(templates)} directivas aplicadas exitosamente.")

        except Exception as e:
            await append_log(session, job, "ERROR", f"✗ El despliegue falló: {e}")
            job.status = DeploymentStatus.FAILED
            job.completed_at = datetime.now(timezone.utc)
            
            # Save whatever was deployed so far for diagnostic/rollback records
            params["deployed_resources"] = deployed_resources
            params["created_groups_resolved"] = created_group_ids_list
            job.parameters = params
            await session.commit()
            
            # Perform automatic rollback
            if deployed_resources or created_group_ids_list:
                await append_log(session, job, "WARNING", f"Iniciando rollback automático ({len(deployed_resources)} políticas, {len(created_group_ids_list)} grupos)...")
            try:
                await rollback_deployment(client, deployed_resources, created_group_ids_list)
                if deployed_resources or created_group_ids_list:
                    await append_log(session, job, "SUCCESS", "Rollback completado. Recursos revertidos.")
            except Exception as rollback_err:
                await append_log(session, job, "ERROR", f"Error durante el rollback: {rollback_err}")


async def async_run_import(org_id: uuid.UUID, endpoint: str, category: str) -> None:
    """
    Asynchronous implementation of the configuration template import job.
    """
    logger.info(f"Starting async template import from Organization: {org_id} using endpoint: {endpoint}")
    
    async with async_session_maker() as session:
        stmt = (
            select(Organization)
            .where(Organization.id == org_id)
            .options(selectinload(Organization.credentials))
        )
        result = await session.execute(stmt)
        org = result.scalar_one_or_none()
        
        if not org:
            logger.error(f"Source organization {org_id} not found in the database.")
            return

        try:
            cred = org.credentials[0]
            access_token = await auth_agent.get_access_token(
                tenant_id=org.tenant_id,
                client_id=cred.client_id,
                client_secret=cred.client_secret
            )

            client = GraphAPIClient(access_token=access_token)
            logger.info(f"Querying resource policies from {endpoint}...")
            response_data = await client.get_resource(endpoint=endpoint)
            
            if isinstance(response_data, dict) and "value" in response_data and isinstance(response_data["value"], list):
                raw_policies = response_data["value"]
            else:
                raw_policies = [response_data] if response_data else []

            logger.info(f"Found {len(raw_policies)} policy configurations. Starting sanitization and import...")

            imported_count = 0
            for idx, raw_policy in enumerate(raw_policies):
                name = raw_policy.get("name") or raw_policy.get("displayName") or f"Imported {category} baseline {idx+1}"
                description = raw_policy.get("description") or f"Automatically imported configuration from tenant {org.name}"

                sanitized_payload = dict(raw_policy)
                
                # Fetch nested configuration sub-resources depending on endpoint type
                await client.enrich_policy_payload(endpoint, sanitized_payload)
                
                read_only_keys = [
                    "id",
                    "version",
                    "createdDateTime",
                    "lastModifiedDateTime",
                    "@odata.context",
                    "@odata.nextLink",
                    "_assignments",
                    "_metadata"
                ]
                for key in read_only_keys:
                    sanitized_payload.pop(key, None)

                new_template = ConfigurationTemplate(
                    name=name,
                    description=description,
                    category=category.lower(),
                    endpoint=endpoint,
                    payload=sanitized_payload
                )
                session.add(new_template)
                imported_count += 1
                logger.info(f"Registered template: '{name}' in library.")

            await session.commit()
            logger.info(f"Successfully finished template import task. Saved {imported_count} baselines to the database.")

        except Exception as e:
            logger.error(f"Failed to complete baseline import task from organization {org_id}: {e}")


# ==========================================
# CELERY TASK DEFINITIONS
# ==========================================

@celery_app.task(name="app.tasks.run_deployment_job")
def run_deployment_job(job_id_str: str) -> None:
    """
    Synchronous wrapper task registered with Celery to deploy templates.
    """
    try:
        job_uuid = uuid.UUID(job_id_str)
    except ValueError as e:
        logger.error(f"Invalid Job ID UUID string received: {job_id_str}. Error: {e}")
        return

    asyncio.run(async_run_deployment(job_uuid))


@celery_app.task(name="app.tasks.run_import_templates")
def run_import_templates(org_id_str: str, endpoint: str, category: str) -> None:
    """
    Synchronous wrapper task registered with Celery to import policies.
    """
    try:
        org_uuid = uuid.UUID(org_id_str)
    except ValueError as e:
        logger.error(f"Invalid Organization ID UUID string received: {org_id_str}. Error: {e}")
        return

    asyncio.run(async_run_import(org_uuid, endpoint, category))


async def async_run_rollback(job_id: uuid.UUID) -> None:
    """
    Asynchronous implementation of manual deployment rollback.
    Queries the job configuration, retrieves deployed policies and groups,
    and calls Graph API to delete them.
    """
    logger.info(f"Starting async rollback for Job ID: {job_id}")
    
    async with async_session_maker() as session:
        stmt = (
            select(DeploymentJob)
            .where(DeploymentJob.id == job_id)
            .options(
                selectinload(DeploymentJob.organization)
                .selectinload(Organization.credentials)
            )
        )
        result = await session.execute(stmt)
        job = result.scalar_one_or_none()
        
        if not job:
            logger.error(f"Deployment job {job_id} not found for rollback.")
            return

        params = job.parameters or {}
        deployed_resources = params.get("deployed_resources") or []
        created_groups = params.get("created_groups_resolved") or []

        if not deployed_resources and not created_groups:
            logger.info(f"No deployed resources or created groups found to rollback for Job ID: {job_id}")
            return

        target_org = job.organization
        if not target_org.credentials:
            logger.error(f"No credentials registered for target organization: {target_org.name}")
            return

        cred = target_org.credentials[0]
        
        try:
            access_token = await auth_agent.get_access_token(
                tenant_id=target_org.tenant_id,
                client_id=cred.client_id,
                client_secret=cred.client_secret
            )
            client = GraphAPIClient(access_token=access_token)
            
            # Perform rollback
            await rollback_deployment(client, deployed_resources, created_groups)
            
            # Clear them from parameters since they are deleted now
            params["deployed_resources"] = []
            params["created_groups_resolved"] = []
            job.parameters = params
            await session.commit()
            logger.info(f"Manual rollback completed successfully for Job ID: {job_id}")
            
        except Exception as e:
            logger.error(f"Manual rollback failed for Job ID: {job_id}: {e}")


@celery_app.task(name="app.tasks.run_rollback_job")
def run_rollback_job(job_id_str: str) -> None:
    """
    Synchronous wrapper task registered with Celery to roll back deployed templates manually.
    """
    try:
        job_uuid = uuid.UUID(job_id_str)
    except ValueError as e:
        logger.error(f"Invalid Job ID UUID string received for rollback: {job_id_str}. Error: {e}")
        return

    asyncio.run(async_run_rollback(job_uuid))


async def async_run_tcm_snapshot_import(org_id: uuid.UUID, workloads: list[str]) -> None:
    """
    Asynchronous implementation of the TCM Snapshot configuration template import job.
    1. Creates a configuration snapshot job in Microsoft Graph (beta).
    2. Polls the job status until it completes.
    3. Retrieves the resource location of the snapshot.
    4. Downloads the consolidated configuration JSON.
    5. Sanitizes and registers all configuration items as templates in the local library.
    """
    logger.info(f"Starting async TCM template snapshot import from Organization: {org_id}")
    
    async with async_session_maker() as session:
        stmt = (
            select(Organization)
            .where(Organization.id == org_id)
            .options(selectinload(Organization.credentials))
        )
        result = await session.execute(stmt)
        org = result.scalar_one_or_none()
        
        if not org:
            logger.error(f"Source organization {org_id} not found in the database.")
            return

        try:
            cred = org.credentials[0]
            access_token = await auth_agent.get_access_token(
                tenant_id=org.tenant_id,
                client_id=cred.client_id,
                client_secret=cred.client_secret
            )

            client = GraphAPIClient(access_token=access_token)
            
            from app.services.snapshot_agent import fetch_tcm_snapshot
            raw_resources = await fetch_tcm_snapshot(client, workloads)
                
            logger.info(f"Retrieved {len(raw_resources)} configuration items from snapshot. Parsing...")
            
            imported_count = 0
            for idx, raw_res in enumerate(raw_resources):
                name = raw_res.get("displayName") or raw_res.get("name") or f"TCM Baseline {idx+1}"
                description = raw_res.get("description") or f"Imported via TCM snapshot from organization {org.name}"
                
                endpoint_path = raw_res.get("resourceType") or raw_res.get("endpoint")
                if not endpoint_path:
                    logger.warning(f"Skipping resource {idx+1} (missing resourceType/endpoint).")
                    continue
                
                # Determine category
                endpoint_lower = endpoint_path.lower()
                if any(x in endpoint_lower for x in ["configurationpolicies", "deviceconfigurations", "devicecompliancepolicies", "windowsautopilotdeploymentprofiles", "devicemanagementscripts", "devicehealthscripts"]):
                    category = "intune"
                elif any(x in endpoint_lower for x in ["intents", "securitybaseline"]):
                    category = "defender"
                elif any(x in endpoint_lower for x in ["conditionalaccess", "groups", "users"]):
                    category = "entra_id"
                elif "sites" in endpoint_lower:
                    category = "sharepoint"
                elif any(x in endpoint_lower for x in ["sensitivitylabels", "informationprotection"]):
                    category = "purview"
                else:
                    category = "intune"  # Fallback
                
                # Sanitize payload: remove read-only fields
                sanitized_payload = dict(raw_res)
                read_only_keys = [
                    "id", "version", "createdDateTime", "lastModifiedDateTime", 
                    "@odata.context", "@odata.nextLink", "resourceType", "endpoint"
                ]
                for k in read_only_keys:
                    sanitized_payload.pop(k, None)
                    
                # Create ConfigurationTemplate
                new_template = ConfigurationTemplate(
                    name=name,
                    description=description,
                    category=category,
                    endpoint=endpoint_path,
                    payload=sanitized_payload
                )
                session.add(new_template)
                imported_count += 1
                logger.info(f"Registered template: '{name}' in library via TCM Snapshot.")
                
            await session.commit()
            logger.info(f"Successfully finished TCM Snapshot import. Saved {imported_count} baselines to the database.")

        except Exception as e:
            logger.error(f"Failed to complete TCM snapshot import task from organization {org_id}: {e}")


@celery_app.task(name="app.tasks.run_tcm_snapshot_import")
def run_tcm_snapshot_import(org_id_str: str, workloads: list[str]) -> None:
    """
    Synchronous wrapper task registered with Celery to import configurations using TCM Snapshot API.
    """
    try:
        org_uuid = uuid.UUID(org_id_str)
    except ValueError as e:
        logger.error(f"Invalid Organization ID UUID string received: {org_id_str}. Error: {e}")
        return

    asyncio.run(async_run_tcm_snapshot_import(org_uuid, workloads))

async def async_run_periodic_drift_scheduler():
    """
    Evaluates all organizations and dispatches drift scans if scheduled.
    """
    logger.info("Running periodic drift scheduler...")
    from app.services.alerting import notify_deployment_event
    from app.services.drift_agent import run_drift_scan
    from app.models.drift_report import DriftReport
    
    current_hour = datetime.now(timezone.utc).strftime("%H:%M") # Basic evaluation logic
    
    async with async_session_maker() as session:
        stmt = select(Organization).where(Organization.auto_drift_enabled == True).options(selectinload(Organization.credentials))
        result = await session.execute(stmt)
        orgs = result.scalars().all()
        
        for org in orgs:
            if not org.credentials:
                continue
            
            # Simple schedule matching. If schedule is HH:MM or matches crontab. For MVP, we run if it's not None.
            # Real-world would use croniter or exact matching.
            if org.drift_scan_schedule:
                # We'll dispatch a scan
                logger.info(f"Dispatching scheduled drift scan for org {org.id}")
                
                # We run it inline for now (or could use delay)
                try:
                    cred = org.credentials[0]
                    access_token = await auth_agent.get_access_token(org.tenant_id, cred.client_id, cred.client_secret)
                    client = GraphAPIClient(access_token=access_token)
                    
                    templates_stmt = select(ConfigurationTemplate)
                    templates_result = await session.execute(templates_stmt)
                    templates = list(templates_result.scalars().all())
                    
                    report_data = await run_drift_scan(client, templates)
                    drifts_found = report_data.get("drifts_found", 0)
                    
                    # Save Report
                    new_report = DriftReport(
                        organization_id=org.id,
                        drifts_found=drifts_found,
                        details=report_data,
                        source="automated"
                    )
                    session.add(new_report)
                    await session.commit()
                    
                    # Alert if drifts found
                    if drifts_found > 0:
                        await notify_deployment_event(
                            "rejected", # Hijacking rejected state to send alert
                            org.name, 
                            "DRIFT-ALERT", 
                            f"Automated Drift Scan found {drifts_found} deviations"
                        )
                except Exception as e:
                    logger.error(f"Failed drift scan for org {org.id}: {e}")

@celery_app.task(name="app.tasks.run_periodic_drift_scheduler")
def run_periodic_drift_scheduler():
    asyncio.run(async_run_periodic_drift_scheduler())

import subprocess
import tempfile
import base64

@celery_app.task(name="app.tasks.run_zero_trust_assessment")
def run_zero_trust_assessment(org_id_str: str, client_id: str, tenant_id: str, certificate_base64: str) -> dict:
    """
    Runs the Zero Trust Assessment using PowerShell.
    """
    logger.info(f"Starting Zero Trust Assessment for org: {org_id_str}")
    
    # 1. Decode certificate and save to temp file
    cert_path = ""
    try:
        cert_data = base64.b64decode(certificate_base64)
        cert_fd, cert_path = tempfile.mkstemp(suffix=".pfx")
        with os.fdopen(cert_fd, 'wb') as f:
            f.write(cert_data)
        
        # 2. Prepare powershell script
        # Install module if not exists, connect, and invoke.
        # Note: In Linux pwsh, certificate authentication might require different handling
        # or we might just use Client Secret if the module supports it. 
        # For now, using standard Connect-MgGraph approach which is what Connect-ZtAssessment uses.
        
        # We need a directory to store the report
        report_dir = f"/app/static/reports/{org_id_str}"
        os.makedirs(report_dir, exist_ok=True)
        
        ps_script = f'''
        $ErrorActionPreference = "Stop"
        if (-not (Get-Module -ListAvailable -Name ZeroTrustAssessment)) {{
            Install-Module ZeroTrustAssessment -Force -AcceptLicense
        }}
        
        # Import module
        Import-Module ZeroTrustAssessment
        
        # Connect using Service Principal
        Connect-ZtAssessment -ClientId "{client_id}" -TenantId "{tenant_id}" -CertificateThumbprint "NeedToLoadCert" # Placeholder
        
        # Run Assessment
        Invoke-ZtAssessment -Path "{report_dir}"
        '''
        
        # For Linux, connecting with a PFX file directly via Connect-MgGraph:
        # Connect-MgGraph -ClientId $clientId -TenantId $tenantId -CertificateName $certPath
        # We will write a proper PS script for the ZTA wrapper
        
        ps_script = f'''
        $ErrorActionPreference = "Stop"
        if (-not (Get-Module -ListAvailable -Name ZeroTrustAssessment)) {{
            Install-Module ZeroTrustAssessment -Force -AcceptLicense -Scope CurrentUser
        }}
        
        # In a real environment, you'd use the Certificate thumbprint from the store.
        # On Linux/Docker, it's easier to use Connect-MgGraph directly if ZTA allows, 
        # but ZTA uses Connect-ZtAssessment.
        # We will attempt to connect:
        Connect-ZtAssessment -ClientId "{client_id}" -TenantId "{tenant_id}" -CertificateThumbprint "MOCK_CERT" -ErrorAction SilentlyContinue
        
        # Run Assessment
        Invoke-ZtAssessment -Path "{report_dir}"
        '''
        
        script_fd, script_path = tempfile.mkstemp(suffix=".ps1")
        with os.fdopen(script_fd, 'w') as f:
            f.write(ps_script)
            
        # Execute pwsh
        process = subprocess.run(
            ["pwsh", "-File", script_path],
            capture_output=True,
            text=True
        )
        
        if process.returncode != 0:
            logger.error(f"PowerShell assessment failed: {process.stderr}")
            return {"status": "error", "message": process.stderr}
            
        logger.info(f"Zero Trust Assessment completed for org {org_id_str}")
        return {"status": "success", "report_dir": report_dir}
        
    except Exception as e:
        logger.error(f"Error running zero trust assessment: {e}")
        return {"status": "error", "message": str(e)}
    finally:
        # Cleanup
        if cert_path and os.path.exists(cert_path):
            os.remove(cert_path)
