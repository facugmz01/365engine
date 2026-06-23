import uuid
import secrets
from typing import Dict, Any, List
from fastapi import FastAPI, Depends, HTTPException, status, Response
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.database.connection import get_db_session
from app.models import Organization, AppCredential, ConfigurationTemplate, DeploymentJob, DeploymentStatus, BaselinePackage
from app.schemas import (
    OrganizationCreate, OrganizationRead, OrganizationListRead,
    AppCredentialCreate, AppCredentialRead,
    ConfigurationTemplateCreate, ConfigurationTemplateRead,
    DeploymentJobCreate, DeploymentJobRead,
    TemplateImportRequest, TemplatePreviewRequest, TCMImportRequest,
    BaselinePackageCreate, BaselinePackageRead
)
from app.tasks import run_deployment_job, run_import_templates, run_rollback_job, run_tcm_snapshot_import

# Initialize security scheme
security_scheme = HTTPBearer()

from app.models.user import User, UserRole

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security_scheme),
    db: AsyncSession = Depends(get_db_session)
) -> User:
    """
    Dependency to extract and validate the JWT from the Authorization header,
    and return the active User object.
    """
    token = credentials.credentials
    from app.core.security import decode_access_token
    payload = decode_access_token(token)
    user_id_str = payload.get("sub")
    if not user_id_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        user_id = uuid.UUID(user_id_str)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject")

    stmt = select(User).where(User.id == user_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return user

def require_role(allowed_roles: List[UserRole]):
    """
    Dependency generator for Role-Based Access Control.
    """
    def role_checker(current_user: User = Depends(get_current_user)):
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Operation not permitted. Required role: {', '.join([r.value for r in allowed_roles])}"
            )
        return current_user
    return role_checker

class LoginRequest(BaseModel):
    username: str
    password: str

# 1. Initialize FastAPI Application
app = FastAPI(
    title="Microsoft 365 Tenant Configuration Engine",
    description="SaaS Backend to manage and deploy configuration baselines to M365 tenants.",
    version="1.2.0"
)

# Mount static files folder (React Build)
import os
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dist_path = os.path.join(base_dir, "frontend", "dist")
assets_path = os.path.join(dist_path, "assets")

# We mount /assets specifically so it matches Vite's default build output
if os.path.exists(assets_path):
    app.mount("/assets", StaticFiles(directory=assets_path), name="assets")


@app.post("/api/v1/auth/login", tags=["Authentication"])
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db_session)) -> Dict[str, str]:
    """
    Validates user credentials against the database and returns a JWT access token.
    """
    from app.core.security import verify_password, create_access_token
    from app.models.audit_log import AuditLog

    stmt = select(User).where(User.username == payload.username)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    if not user or not verify_password(payload.password, user.password_hash) or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password"
        )

    # Log successful login
    audit = AuditLog(
        user_id=user.id,
        action="login",
        details={"ip": "unknown"} # Could be enhanced with Request IP
    )
    db.add(audit)
    await db.commit()

    access_token = create_access_token(data={"sub": str(user.id), "role": user.role.value, "username": user.username})
    return {"access_token": access_token, "token_type": "bearer", "role": user.role.value, "username": user.username}


@app.get("/api/v1/auth/me", tags=["Authentication"])
async def get_current_user_info(current_user: User = Depends(get_current_user)) -> Dict[str, Any]:
    """
    Returns the profile of the currently authenticated user based on their JWT.
    Used by the frontend to restore session state on page reload.
    """
    return {
        "id": str(current_user.id),
        "username": current_user.username,
        "role": current_user.role.value,
        "is_active": current_user.is_active,
    }


@app.get("/api/v1/auth/sso/config", tags=["Authentication"])
async def get_sso_config() -> Dict[str, Any]:
    from app.core.config import settings
    return {"enabled": settings.ENABLE_SSO}

@app.get("/api/v1/auth/sso/login", tags=["Authentication"])
async def sso_login() -> Dict[str, str]:
    from app.core.config import settings
    from app.services.auth_agent import get_sso_auth_url
    if not settings.ENABLE_SSO:
        raise HTTPException(status_code=400, detail="SSO is not enabled")
    
    state = secrets.token_urlsafe(16)
    auth_url = get_sso_auth_url(
        client_id=settings.SSO_CLIENT_ID,
        client_secret=settings.SSO_CLIENT_SECRET,
        tenant_id=settings.SSO_TENANT_ID,
        redirect_uri=settings.SSO_REDIRECT_URI,
        state=state
    )
    return {"auth_url": auth_url, "state": state}

@app.get("/api/v1/auth/sso/callback", tags=["Authentication"])
async def sso_callback(code: str, state: str = None, db: AsyncSession = Depends(get_db_session)):
    from app.core.config import settings
    from app.services.auth_agent import acquire_sso_token
    from app.core.security import create_access_token
    from app.models.audit_log import AuditLog
    
    if not settings.ENABLE_SSO:
        raise HTTPException(status_code=400, detail="SSO is not enabled")
    
    if not code:
        raise HTTPException(status_code=400, detail="Missing authorization code")
        
    try:
        # Acquire token
        token_response = await acquire_sso_token(
            client_id=settings.SSO_CLIENT_ID,
            client_secret=settings.SSO_CLIENT_SECRET,
            tenant_id=settings.SSO_TENANT_ID,
            redirect_uri=settings.SSO_REDIRECT_URI,
            code=code
        )
        
        # We need the user's email/username. For Entra ID, id_token contains it.
        # Alternatively we can extract it from the id_token claims parsed by MSAL.
        id_token_claims = token_response.get("id_token_claims", {})
        email = id_token_claims.get("preferred_username") or id_token_claims.get("email") or id_token_claims.get("upn")
        
        if not email:
            raise HTTPException(status_code=400, detail="Could not retrieve email from SSO provider")
            
        # Match user in local DB
        stmt = select(User).where(User.username == email)
        result = await db.execute(stmt)
        user = result.scalar_one_or_none()
        
        if not user or not user.is_active:
            raise HTTPException(status_code=403, detail="SSO successful but user is not registered or is inactive in local database")
            
        # Log successful SSO login
        audit = AuditLog(
            user_id=user.id,
            action="sso_login",
            details={"ip": "unknown"}
        )
        db.add(audit)
        await db.commit()
        
        # Generate local JWT
        access_token = create_access_token(data={"sub": str(user.id), "role": user.role.value, "username": user.username})
        
        # Usually SSO redirects back to the SPA with the token in URL or via cookie.
        # Since we use Bearer token in localStorage, we can return HTML that posts message to opener or sets localStorage and redirects.
        # For simplicity of integration without changing too much frontend routing, we return an HTML redirect page.
        from fastapi.responses import HTMLResponse
        html_content = f"""
        <html>
            <script>
                localStorage.setItem('token', '{access_token}');
                localStorage.setItem('role', '{user.role.value}');
                localStorage.setItem('username', '{user.username}');
                window.location.href = '/dashboard';
            </script>
        </html>
        """
        return HTMLResponse(content=html_content)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Removed legacy UI routes (handled by catch-all at the end)


@app.get("/api/v1/health", tags=["Health"])
async def health_check() -> Dict[str, str]:
    """
    Health check endpoint to verify backend api is live.
    """
    return {"status": "ok", "message": "M365 Configuration Engine is running."}


# ==========================================
# ORGANIZATIONS ENDPOINTS
# ==========================================

@app.post(
    "/api/v1/organizations",
    response_model=OrganizationRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(get_current_user)],
    tags=["Organizations"]
)
async def create_organization(
    payload: OrganizationCreate,
    db: AsyncSession = Depends(get_db_session)
) -> Organization:
    """
    Creates and registers a Microsoft 365 organization (tenant) metadata.
    """
    stmt = select(Organization).where(Organization.tenant_id == payload.tenant_id)
    result = await db.execute(stmt)
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Organization with tenant_id '{payload.tenant_id}' is already registered."
        )

    db_org = Organization(name=payload.name, tenant_id=payload.tenant_id)
    db.add(db_org)
    await db.commit()
    await db.refresh(db_org)
    return db_org


@app.get(
    "/api/v1/organizations",
    response_model=List[OrganizationListRead],
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(get_current_user)],
    tags=["Organizations"]
)
async def list_organizations(
    db: AsyncSession = Depends(get_db_session)
) -> List:
    """
    Retrieves all registered organizations from the database.
    Includes has_credentials flag to indicate if App Credentials are configured.
    """
    stmt = select(Organization).order_by(Organization.name).options(selectinload(Organization.credentials))
    result = await db.execute(stmt)
    orgs = list(result.scalars().all())
    # Build response dicts with has_credentials derived from the loaded relationship
    return [
        {
            "id": org.id,
            "name": org.name,
            "tenant_id": org.tenant_id,
            "created_at": org.created_at,
            "updated_at": org.updated_at,
            "auto_drift_enabled": org.auto_drift_enabled,
            "drift_scan_schedule": org.drift_scan_schedule,
            "has_credentials": len(org.credentials) > 0,
        }
        for org in orgs
    ]


# ==========================================
# CREDENTIALS ENDPOINTS
# ==========================================

@app.post(
    "/api/v1/organizations/{org_id}/credentials",
    response_model=AppCredentialRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(get_current_user)],
    tags=["Credentials"]
)
async def create_credentials(
    org_id: uuid.UUID,
    payload: AppCredentialCreate,
    db: AsyncSession = Depends(get_db_session)
) -> AppCredential:
    """
    Adds Entra ID App Credentials (client_id and client_secret) to an Organization.
    Encrypts the client_secret automatically prior to saving in the database.
    """
    org_stmt = select(Organization).where(Organization.id == org_id)
    org_result = await db.execute(org_stmt)
    org = org_result.scalar_one_or_none()
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Organization with ID '{org_id}' not found."
        )

    db_cred = AppCredential(
        organization_id=org_id,
        auth_type=payload.auth_type,
        client_id=payload.client_id,
        client_secret=payload.client_secret  # Property setter handles encryption
    )
    
    db.add(db_cred)
    await db.commit()
    await db.refresh(db_cred)
    return db_cred

@app.get(
    "/api/v1/organizations/{org_id}/auth/url",
    tags=["Credentials"]
)
async def get_delegated_auth_url(
    org_id: uuid.UUID,
    redirect_uri: str,
    db: AsyncSession = Depends(get_db_session)
) -> Dict[str, str]:
    """
    Returns the Microsoft authorization URL for Delegated authentication.
    """
    org_stmt = select(Organization).where(Organization.id == org_id).options(selectinload(Organization.credentials))
    org_result = await db.execute(org_stmt)
    org = org_result.scalar_one_or_none()
    
    if not org or not org.credentials:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization or credentials not found")
        
    cred = org.credentials[0]
    from app.services.auth_agent import get_delegated_auth_url as build_auth_url
    url = build_auth_url(cred.client_id, cred.client_secret, org.tenant_id, redirect_uri)
    return {"url": url}

class AuthCallbackRequest(BaseModel):
    code: str
    redirect_uri: str

@app.post(
    "/api/v1/organizations/{org_id}/auth/callback",
    tags=["Credentials"]
)
async def delegated_auth_callback(
    org_id: uuid.UUID,
    payload: AuthCallbackRequest,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Exchanges the authorization code for tokens and saves the refresh_token.
    """
    org_stmt = select(Organization).where(Organization.id == org_id).options(selectinload(Organization.credentials))
    org_result = await db.execute(org_stmt)
    org = org_result.scalar_one_or_none()
    
    if not org or not org.credentials:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization or credentials not found")
        
    cred = org.credentials[0]
    from app.services.auth_agent import acquire_delegated_token
    
    try:
        result = await acquire_delegated_token(cred.client_id, cred.client_secret, org.tenant_id, payload.redirect_uri, payload.code)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
        
    if "refresh_token" in result:
        cred.refresh_token = result["refresh_token"]
        cred.auth_type = "delegated"
        await db.commit()
        return {"status": "success", "message": "Tokens acquired and saved."}
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No refresh token returned by Microsoft.")


# ==========================================
# CONFIGURATION TEMPLATES ENDPOINTS
# ==========================================

@app.post(
    "/api/v1/templates",
    response_model=ConfigurationTemplateRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(get_current_user)],
    tags=["Configuration Templates"]
)
async def create_template(
    payload: ConfigurationTemplateCreate,
    db: AsyncSession = Depends(get_db_session)
) -> ConfigurationTemplate:
    """
    Registers a new configuration baseline template in the centralized database.
    """
    db_template = ConfigurationTemplate(
        name=payload.name,
        description=payload.description or "",
        category=payload.category,
        endpoint=payload.endpoint,
        payload=payload.payload
    )
    db.add(db_template)
    await db.commit()
    await db.refresh(db_template)
    return db_template


@app.get(
    "/api/v1/templates",
    response_model=List[ConfigurationTemplateRead],
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(get_current_user)],
    tags=["Configuration Templates"]
)
async def list_templates(
    db: AsyncSession = Depends(get_db_session)
) -> List[ConfigurationTemplate]:
    """
    Retrieves all available configuration templates from the library database.
    """
    stmt = select(ConfigurationTemplate).order_by(ConfigurationTemplate.name)
    result = await db.execute(stmt)
    return list(result.scalars().all())


@app.get(
    "/api/v1/templates/{template_id}",
    response_model=ConfigurationTemplateRead,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(get_current_user)],
    tags=["Configuration Templates"]
)
async def get_template(
    template_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session)
) -> ConfigurationTemplate:
    """
    Retrieves the details and payload JSON of a specific configuration template.
    """
    stmt = select(ConfigurationTemplate).where(ConfigurationTemplate.id == template_id)
    result = await db.execute(stmt)
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Configuration template with ID '{template_id}' not found."
        )
    return template


@app.delete(
    "/api/v1/templates/{template_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(get_current_user)],
    tags=["Configuration Templates"]
)
async def delete_template(
    template_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session)
):
    """
    Deletes a configuration template from the database.
    """
    stmt = select(ConfigurationTemplate).where(ConfigurationTemplate.id == template_id)
    result = await db.execute(stmt)
    template = result.scalar_one_or_none()
    if not template:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Configuration template with ID '{template_id}' not found."
        )
    
    await db.delete(template)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post(
    "/api/v1/templates/import",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(get_current_user)],
    tags=["Configuration Templates"]
)
async def import_templates(
    payload: TemplateImportRequest,
    db: AsyncSession = Depends(get_db_session)
) -> JSONResponse:
    """
    Initiates a background task to query policies from a source tenant,
    sanitize their payloads, and import them into the centralized template database.
    Returns HTTP 202 Accepted.
    """
    stmt = (
        select(Organization)
        .where(Organization.id == payload.organization_id)
        .options(selectinload(Organization.credentials))
    )
    result = await db.execute(stmt)
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Source organization ID '{payload.organization_id}' not found."
        )

    if not org.credentials:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Organization '{org.name}' has no registered credentials for authentication."
        )

    try:
        run_import_templates.delay(
            str(payload.organization_id),
            payload.endpoint,
            payload.category
        )
    except Exception as e:
        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content={
                "message": "Celery import task failed to dispatch to queue.",
                "error": str(e)
            }
        )

    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content={
            "message": "Background template import initiated successfully.",
            "organization_name": org.name,
            "endpoint": payload.endpoint,
            "category": payload.category
        }
    )

@app.post(
    "/api/v1/templates/preview",
    response_model=dict,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(get_current_user)],
    tags=["Configuration Templates"]
)
async def preview_templates(
    payload: TemplatePreviewRequest,
    db: AsyncSession = Depends(get_db_session)
) -> dict:
    """
    Synchronously fetches configuration policies from target endpoints, enriches them with
    sub-resources, and returns the payload data without saving to the database.
    """
    from app.services import auth_agent, GraphAPIClient
    
    stmt = select(Organization).where(Organization.id == payload.organization_id).options(selectinload(Organization.credentials))
    result = await db.execute(stmt)
    org = result.scalar_one_or_none()
    
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found.")
    if not org.credentials:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Organization has no credentials.")
        
    try:
        cred = org.credentials[0]
        access_token = await auth_agent.get_access_token(
            tenant_id=org.tenant_id,
            client_id=cred.client_id,
            client_secret=cred.client_secret
        )
        client = GraphAPIClient(access_token=access_token)
        
        all_preview_items = []
        
        for ep in payload.endpoints:
            if not ep.strip():
                continue
            try:
                response_data = await client.get_resource(endpoint=ep)
                if isinstance(response_data, dict) and "value" in response_data and isinstance(response_data["value"], list):
                    raw_policies = response_data["value"]
                else:
                    raw_policies = [response_data] if response_data else []
                
                for idx, raw_policy in enumerate(raw_policies):
                    sanitized_payload = dict(raw_policy)
                    await client.enrich_policy_payload(ep, sanitized_payload)
                    
                    read_only_keys = ["id", "version", "createdDateTime", "lastModifiedDateTime", "@odata.context", "@odata.nextLink", "_assignments", "_metadata"]
                    for k in read_only_keys:
                        sanitized_payload.pop(k, None)
                        
                    all_preview_items.append({
                        "name": raw_policy.get("name") or raw_policy.get("displayName") or f"Policy from {ep} ({idx})",
                        "description": raw_policy.get("description") or "",
                        "endpoint": ep,
                        "payload": sanitized_payload
                    })
            except Exception as ep_err:
                # Log and ignore specific endpoint errors so we can preview the rest
                print(f"Error fetching preview for endpoint {ep}: {ep_err}")
                
        return {"data": all_preview_items}
        
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Preview failed: {str(e)}")

@app.post(
    "/api/v1/snapshots/fetch",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(get_current_user)],
    tags=["Configuration Templates"]
)
async def fetch_snapshot_info(
    payload: TCMImportRequest,
    db: AsyncSession = Depends(get_db_session)
) -> JSONResponse:
    """
    Synchronously fetches the TCM snapshot data from Microsoft Graph API.
    Returns the raw JSON data without importing it into the local database.
    """
    stmt = (
        select(Organization)
        .where(Organization.id == payload.organization_id)
        .options(selectinload(Organization.credentials))
    )
    result = await db.execute(stmt)
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Source organization ID '{payload.organization_id}' not found."
        )

    if not org.credentials:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Organization '{org.name}' has no registered credentials for authentication."
        )

    try:
        from app.services.auth_agent import auth_agent
        from app.services.graph_agent import GraphAPIClient
        from app.services.snapshot_agent import fetch_tcm_snapshot
        
        cred = org.credentials[0]
        access_token = await auth_agent.get_access_token(
            tenant_id=org.tenant_id,
            client_id=cred.client_id,
            client_secret=cred.client_secret
        )

        client = GraphAPIClient(access_token=access_token)
        raw_resources = await fetch_tcm_snapshot(client, payload.workloads)
        
        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "message": "Snapshot fetched successfully",
                "organization_id": str(org.id),
                "workloads": payload.workloads,
                "data": raw_resources
            }
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch TCM snapshot: {str(e)}"
        )


@app.post(
    "/api/v1/templates/import-tcm",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(get_current_user)],
    tags=["Configuration Templates"]
)
async def import_templates_tcm(
    payload: TCMImportRequest,
    db: AsyncSession = Depends(get_db_session)
) -> JSONResponse:
    """
    Initiates a background task to query configurations using Microsoft Graph's
    Tenant Configuration Management (TCM) Snapshot API, sanitize, and import them.
    Returns HTTP 202 Accepted.
    """
    stmt = (
        select(Organization)
        .where(Organization.id == payload.organization_id)
        .options(selectinload(Organization.credentials))
    )
    result = await db.execute(stmt)
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Source organization ID '{payload.organization_id}' not found."
        )

    if not org.credentials:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Organization '{org.name}' has no registered credentials for authentication."
        )

    try:
        run_tcm_snapshot_import.delay(
            str(payload.organization_id),
            payload.workloads
        )
    except Exception as e:
        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content={
                "message": "TCM import task failed to dispatch to queue.",
                "error": str(e)
            }
        )

    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content={
            "message": "Background TCM template snapshot import initiated successfully.",
            "organization_name": org.name,
            "workloads": payload.workloads
        }
    )

# ==========================================
# PACKAGES ENDPOINTS
# ==========================================

@app.post(
    "/api/v1/packages",
    response_model=BaselinePackageRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(get_current_user)],
    tags=["Packages"]
)
async def create_package(
    payload: BaselinePackageCreate,
    db: AsyncSession = Depends(get_db_session)
) -> BaselinePackage:
    """
    Creates a new grouped deployment package (Plantilla) containing multiple configuration templates.
    """
    # Fetch templates to ensure they exist
    templates_stmt = select(ConfigurationTemplate).where(ConfigurationTemplate.id.in_(payload.template_ids))
    templates_result = await db.execute(templates_stmt)
    templates = list(templates_result.scalars().all())
    
    if len(templates) != len(payload.template_ids):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="One or more selected configuration templates were not found."
        )

    db_package = BaselinePackage(
        name=payload.name,
        description=payload.description or ""
    )
    db_package.templates.extend(templates)
    
    db.add(db_package)
    await db.commit()
    await db.refresh(db_package)
    return db_package


@app.get(
    "/api/v1/packages",
    response_model=List[BaselinePackageRead],
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(get_current_user)],
    tags=["Packages"]
)
async def list_packages(
    db: AsyncSession = Depends(get_db_session)
) -> List[BaselinePackage]:
    """
    Retrieves all grouped packages with their associated templates.
    """
    stmt = select(BaselinePackage).order_by(BaselinePackage.name)
    result = await db.execute(stmt)
    return list(result.scalars().all())


# ==========================================
# DEPLOYMENTS ENDPOINTS
# ==========================================

@app.post(
    "/api/v1/deployments/start",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_role([UserRole.DEPLOYER, UserRole.SUPER_ADMIN]))],
    tags=["Deployments"]
)
async def start_deployment(
    payload: DeploymentJobCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session)
) -> JSONResponse:
    """
    Starts a deployment job and queues it in Celery.
    """
    templates_stmt = select(ConfigurationTemplate).where(ConfigurationTemplate.id.in_(payload.template_ids))
    templates_result = await db.execute(templates_stmt)
    templates = list(templates_result.scalars().all())

    run_parameters = {
        "create_groups": [g.model_dump() for g in payload.create_groups] if payload.create_groups else None,
        "assignment_target": payload.assignment_target or "unassigned",
        "assign_to_groups": payload.assign_to_groups,
        "template_assignments": [ta.model_dump(mode="json") for ta in payload.template_assignments] if payload.template_assignments else None,
        "bypass_validation": bool(payload.bypass_validation)
    }

    job = DeploymentJob(
        organization_id=payload.organization_id,
        status=DeploymentStatus.PENDING,
        parameters=run_parameters,
        requested_by_id=current_user.id
    )
    job.templates.extend(templates)
    db.add(job)
    await db.commit()
    await db.refresh(job)

    try:
        run_deployment_job.delay(str(job.id))
    except Exception as e:
        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content={
                "message": "Deployment job created but Celery task failed to dispatch.",
                "error": str(e)
            }
        )

    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content={
            "job_id": str(job.id),
            "status": job.status,
            "message": "Deployment job created and started."
        }
    )

@app.post(
    "/api/v1/deployments/simulate",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(require_role([UserRole.DEPLOYER, UserRole.SUPER_ADMIN]))],
    tags=["Deployments"]
)
async def simulate_deployment(
    payload: DeploymentJobCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session)
) -> JSONResponse:
    """
    Performs a Dry-Run simulation against the remote tenant.
    Returns the simulation report and saves the job as SIMULATED.
    """
    from app.services.auth_agent import auth_agent
    from app.services.graph_agent import GraphAPIClient
    from app.services.drift_agent import run_simulation
    
    # 1. Validate Target Organization exists
    org_stmt = select(Organization).where(Organization.id == payload.organization_id).options(selectinload(Organization.credentials))
    org_result = await db.execute(org_stmt)
    org = org_result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail=f"Target organization ID '{payload.organization_id}' not found.")
    if not org.credentials:
        raise HTTPException(status_code=400, detail="Organization has no credentials.")

    # 2. Validate Templates
    templates_stmt = select(ConfigurationTemplate).where(ConfigurationTemplate.id.in_(payload.template_ids))
    templates_result = await db.execute(templates_stmt)
    templates = list(templates_result.scalars().all())
    if len(templates) != len(payload.template_ids):
        raise HTTPException(status_code=404, detail="One or more templates not found.")

    # 3. Connect to Graph
    cred = org.credentials[0]
    try:
        access_token = await auth_agent.get_access_token(org.tenant_id, cred.client_id, cred.client_secret)
        client = GraphAPIClient(access_token=access_token)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to authenticate with tenant: {e}")

    # 4. Run Simulation
    sim_report = await run_simulation(client, templates)

    # 5. Create Job as SIMULATED
    run_parameters = {
        "create_groups": [g.model_dump() for g in payload.create_groups] if payload.create_groups else None,
        "assignment_target": payload.assignment_target or "unassigned",
        "assign_to_groups": payload.assign_to_groups,
        "template_assignments": [ta.model_dump(mode="json") for ta in payload.template_assignments] if payload.template_assignments else None,
        "bypass_validation": bool(payload.bypass_validation),
        "simulation_report": sim_report
    }

    job = DeploymentJob(
        organization_id=payload.organization_id,
        status="simulated", # Use string if DeploymentStatus enum doesn't have SIMULATED yet
        parameters=run_parameters,
        requested_by_id=current_user.id
    )
    job.templates.extend(templates)
    db.add(job)
    await db.commit()
    await db.refresh(job)

    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={
            "job_id": str(job.id),
            "status": job.status,
            "simulation_report": sim_report,
            "message": "Simulation completed successfully. Awaiting commit."
        }
    )

@app.post(
    "/api/v1/deployments/{job_id}/commit",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_role([UserRole.DEPLOYER, UserRole.SUPER_ADMIN]))],
    tags=["Deployments"]
)
async def commit_deployment(
    job_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session)
) -> JSONResponse:
    """
    Commits a SIMULATED job to PENDING_APPROVAL.
    """
    from app.services.alerting import notify_deployment_event
    from app.models.audit_log import AuditLog
    
    stmt = select(DeploymentJob).where(DeploymentJob.id == job_id).options(selectinload(DeploymentJob.organization))
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()
    
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != "simulated":
        raise HTTPException(status_code=400, detail="Job is not in simulated state")

    job.status = DeploymentStatus.PENDING_APPROVAL
    
    # Log Audit
    audit = AuditLog(
        user_id=current_user.id,
        action="request_deploy",
        resource_type="deployment_job",
        resource_id=str(job.id),
        details={"org_id": str(job.organization_id)}
    )
    db.add(audit)
    await db.commit()
    
    # Notify
    await notify_deployment_event("requested", job.organization.name, str(job.id), current_user.username)

    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content={
            "job_id": str(job.id),
            "status": job.status,
            "message": "Deployment requested and pending approval."
        }
    )

@app.post(
    "/api/v1/deployments/{job_id}/approve",
    tags=["Deployments"],
    dependencies=[Depends(require_role([UserRole.APPROVER, UserRole.SUPER_ADMIN]))]
)
async def approve_deployment(
    job_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session)
) -> dict:
    stmt = select(DeploymentJob).where(DeploymentJob.id == job_id)
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Deployment job not found")
    if job.status != DeploymentStatus.PENDING_APPROVAL:
        raise HTTPException(status_code=400, detail="Job is not pending approval")

    job.status = DeploymentStatus.RUNNING
    job.approved_by_id = current_user.id
    
    from app.models.audit_log import AuditLog
    audit = AuditLog(
        user_id=current_user.id,
        action="approve_deploy",
        resource_type="deployment_job",
        resource_id=str(job.id),
        details={}
    )
    db.add(audit)
    await db.commit()

    from app.services.alerting import notify_deployment_event
    org_name = job.organization.name if job.organization else "Tenant"

    # Dispatch to Celery
    try:
        run_deployment_job.delay(str(job.id))
        await notify_deployment_event("approved", org_name, str(job.id), current_user.username)
    except Exception as e:
        return {"job_id": str(job.id), "status": job.status, "warning": f"Celery task dispatch failed: {e}"}

    return {"job_id": str(job.id), "status": job.status, "message": "Deployment approved and started."}

@app.post(
    "/api/v1/deployments/{job_id}/reject",
    tags=["Deployments"],
    dependencies=[Depends(require_role([UserRole.APPROVER, UserRole.SUPER_ADMIN]))]
)
async def reject_deployment(
    job_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session)
) -> dict:
    stmt = select(DeploymentJob).where(DeploymentJob.id == job_id).options(selectinload(DeploymentJob.organization))
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Deployment job not found")
    if job.status != DeploymentStatus.PENDING_APPROVAL:
        raise HTTPException(status_code=400, detail="Job is not pending approval")

    job.status = DeploymentStatus.REJECTED
    job.approved_by_id = current_user.id # Used to track who decided
    
    from app.models.audit_log import AuditLog
    audit = AuditLog(
        user_id=current_user.id,
        action="reject_deploy",
        resource_type="deployment_job",
        resource_id=str(job.id),
        details={}
    )
    db.add(audit)
    await db.commit()

    from app.services.alerting import notify_deployment_event
    org_name = job.organization.name if job.organization else "Tenant"
    await notify_deployment_event("rejected", org_name, str(job.id), current_user.username)

    return {"job_id": str(job.id), "status": job.status, "message": "Deployment rejected."}


@app.get(
    "/api/v1/organizations/{org_id}/groups",
    tags=["Organizations"],
    dependencies=[Depends(require_role([UserRole.DEPLOYER, UserRole.SUPER_ADMIN, UserRole.APPROVER]))]
)
async def list_tenant_groups(
    org_id: uuid.UUID,
    search: str = "",
    db: AsyncSession = Depends(get_db_session)
) -> dict:
    """
    Lists Entra ID security groups from the target tenant via Microsoft Graph API.
    Supports optional search by displayName.
    """
    from app.services.auth_agent import auth_agent
    from app.services.graph_agent import GraphAPIClient

    stmt = select(Organization).where(Organization.id == org_id).options(selectinload(Organization.credentials))
    result = await db.execute(stmt)
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    if not org.credentials:
        raise HTTPException(status_code=400, detail="Organization has no credentials configured")

    cred = org.credentials[0]
    try:
        if cred.auth_type == "delegated":
            if not cred.refresh_token:
                raise HTTPException(status_code=400, detail="No refresh token for delegated auth")
            from app.services.auth_agent import auth_agent as _aa
            access_token = await _aa.get_delegated_access_token(cred.refresh_token, cred.client_id, cred.client_secret, org.tenant_id)
        else:
            access_token = await auth_agent.get_access_token(org.tenant_id, cred.client_id, cred.client_secret)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Authentication failed: {e}")

    client = GraphAPIClient(access_token=access_token)

    try:
        filter_query = ""
        if search:
            filter_query = f"?$filter=startswith(displayName,'{search}')&$top=50"
        else:
            filter_query = "?$top=100&$select=id,displayName,groupTypes,membershipRule,securityEnabled,mailEnabled"

        response = await client._request_with_retry("GET", f"groups{filter_query}")
        response.raise_for_status()
        data = response.json()
        groups = data.get("value", [])
        return {"groups": groups, "total": len(groups)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch groups: {e}")

@app.post(
    "/api/v1/organizations/{org_id}/drift-scan",
    tags=["Organizations"],
    dependencies=[Depends(require_role([UserRole.SUPER_ADMIN, UserRole.APPROVER]))]
)
async def scan_drift(
    org_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session)
) -> dict:
    from app.core.config import settings
    if not settings.ENABLE_DRIFT_DETECTION:
        raise HTTPException(status_code=400, detail="Drift Detection is disabled.")
        
    from app.services.auth_agent import auth_agent
    from app.services.graph_agent import GraphAPIClient
    from app.services.drift_agent import run_drift_scan
    from app.models.drift_report import DriftReport
    
    org_stmt = select(Organization).where(Organization.id == org_id).options(selectinload(Organization.credentials))
    org_result = await db.execute(org_stmt)
    org = org_result.scalar_one_or_none()
    
    if not org or not org.credentials:
        raise HTTPException(status_code=404, detail="Organization or credentials not found.")
        
    templates_stmt = select(ConfigurationTemplate)
    templates_result = await db.execute(templates_stmt)
    templates = list(templates_result.scalars().all())
    
    cred = org.credentials[0]
    try:
        access_token = await auth_agent.get_access_token(org.tenant_id, cred.client_id, cred.client_secret)
        client = GraphAPIClient(access_token=access_token)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Auth error: {e}")
        
    drift_report_data = await run_drift_scan(client, templates)
    
    # Save the report to DB
    new_report = DriftReport(
        organization_id=org_id,
        drifts_found=drift_report_data.get("drifts_found", 0),
        details=drift_report_data,
        source="manual"
    )
    db.add(new_report)
    await db.commit()
    
    return drift_report_data

from app.schemas.organization_schemas import OrganizationSettingsUpdate

@app.get(
    "/api/v1/organizations/{org_id}/details",
    tags=["Organizations"],
    dependencies=[Depends(require_role([UserRole.SUPER_ADMIN, UserRole.APPROVER, UserRole.DEPLOYER]))]
)
async def get_org_details(
    org_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session)
) -> dict:
    # Get org with credentials
    stmt = select(Organization).where(Organization.id == org_id).options(selectinload(Organization.credentials))
    result = await db.execute(stmt)
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
        
    # Get Deployment Jobs
    jobs_stmt = select(DeploymentJob).where(DeploymentJob.organization_id == org_id).order_by(DeploymentJob.created_at.desc())
    jobs_result = await db.execute(jobs_stmt)
    jobs = list(jobs_result.scalars().all())
    
    # Get Drift Reports
    from app.models.drift_report import DriftReport
    drift_stmt = select(DriftReport).where(DriftReport.organization_id == org_id).order_by(DriftReport.created_at.desc()).limit(10)
    drift_result = await db.execute(drift_stmt)
    drift_reports = list(drift_result.scalars().all())
    
    return {
        "id": str(org.id),
        "name": org.name,
        "tenant_id": org.tenant_id,
        "has_credentials": len(org.credentials) > 0,
        "auto_drift_enabled": org.auto_drift_enabled,
        "drift_scan_schedule": org.drift_scan_schedule,
        "created_at": org.created_at,
        "updated_at": org.updated_at,
        "deployments": [{"id": str(j.id), "status": j.status, "created_at": j.created_at.isoformat()} for j in jobs],
        "drift_reports": [{"id": str(r.id), "created_at": r.created_at.isoformat(), "drifts_found": r.drifts_found, "source": r.source, "details": r.details} for r in drift_reports]
    }

@app.put(
    "/api/v1/organizations/{org_id}/settings",
    tags=["Organizations"],
    dependencies=[Depends(require_role([UserRole.SUPER_ADMIN]))]
)
async def update_org_settings(
    org_id: uuid.UUID,
    settings: OrganizationSettingsUpdate,
    db: AsyncSession = Depends(get_db_session)
) -> dict:
    stmt = select(Organization).where(Organization.id == org_id)
    result = await db.execute(stmt)
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
        
    org.auto_drift_enabled = settings.auto_drift_enabled
    org.drift_scan_schedule = settings.drift_scan_schedule
    await db.commit()
    
    return {"message": "Settings updated successfully"}



@app.get(
    "/api/v1/deployments",
    response_model=List[DeploymentJobRead],
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(get_current_user)],
    tags=["Deployments"]
)
async def list_deployments(
    db: AsyncSession = Depends(get_db_session)
) -> List[DeploymentJob]:
    """
    Retrieves all configuration deployment jobs from history.
    """
    stmt = select(DeploymentJob).order_by(DeploymentJob.created_at.desc()).options(selectinload(DeploymentJob.templates))
    result = await db.execute(stmt)
    return list(result.scalars().all())


@app.get(
    "/api/v1/deployments/{job_id}",
    response_model=DeploymentJobRead,
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(get_current_user)],
    tags=["Deployments"]
)
async def get_deployment_status(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session)
) -> DeploymentJob:
    """
    Retrieves the status, timestamps and template list of a baseline deployment job.
    """
    stmt = (
        select(DeploymentJob)
        .where(DeploymentJob.id == job_id)
        .options(selectinload(DeploymentJob.templates))
    )
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()
    
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Deployment job with ID '{job_id}' not found."
        )
    return job


@app.get(
    "/api/v1/deployments/{job_id}/logs",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(get_current_user)],
    tags=["Deployments"]
)
async def get_deployment_logs(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session)
) -> Dict[str, Any]:
    """
    Returns the real-time log entries for a specific deployment job.
    Intended for polling from the frontend console every 2 seconds.
    """
    stmt = select(DeploymentJob).where(DeploymentJob.id == job_id)
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Deployment job with ID '{job_id}' not found."
        )

    return {
        "job_id": str(job.id),
        "status": job.status,
        "logs": job.logs or [],
        "completed_at": job.completed_at.isoformat() if job.completed_at else None
    }


@app.get(
    "/api/v1/organizations/{org_id}/validate",
    status_code=status.HTTP_200_OK,
    dependencies=[Depends(get_current_user)],
    tags=["Organizations"]
)
async def validate_organization_readiness(
    org_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session)
) -> Dict[str, Any]:
    """
    Runs pre-validation checks on a target organization (tenant) using Microsoft Graph:
    Checks license compatibility, Intune state, Defender connector status, diagnostics.
    """
    from app.services.tenant_validator import validate_tenant_readiness
    from app.services import auth_agent, GraphAPIClient

    stmt = (
        select(Organization)
        .where(Organization.id == org_id)
        .options(selectinload(Organization.credentials))
    )
    result = await db.execute(stmt)
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Organization with ID '{org_id}' not found."
        )

    if not org.credentials:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Organization '{org.name}' has no registered credentials."
        )

    cred = org.credentials[0]
    try:
        from app.services.auth_agent import auth_agent
        if cred.auth_type == "delegated":
            if not cred.refresh_token:
                raise HTTPException(status_code=400, detail="Delegated Auth is selected but no user has authorized it. Please sign in to Microsoft first.")
            from app.services.auth_agent import refresh_delegated_token
            token_res = await refresh_delegated_token(cred.client_id, cred.client_secret, org.tenant_id, cred.refresh_token)
            if "refresh_token" in token_res:
                cred.refresh_token = token_res["refresh_token"]
                await db.commit()
            access_token = token_res["access_token"]
        else:
            access_token = await auth_agent.get_access_token(
                tenant_id=org.tenant_id,
                client_id=cred.client_id,
                client_secret=cred.client_secret
            )
            
        client = GraphAPIClient(access_token=access_token)
        report = await validate_tenant_readiness(client, use_delegated=(cred.auth_type == "delegated"))
        return report
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to perform pre-validation on tenant: {e}"
        )


@app.post(
    "/api/v1/deployments/{job_id}/rollback",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(get_current_user)],
    tags=["Deployments"]
)
async def start_rollback(
    job_id: uuid.UUID,
    db: AsyncSession = Depends(get_db_session)
) -> JSONResponse:
    """
    Enqueues a task to roll back (delete) all deployed groups and policies for a specific job.
    """
    stmt = select(DeploymentJob).where(DeploymentJob.id == job_id)
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Deployment job with ID '{job_id}' not found."
        )

    # Dispatch to Celery worker
    try:
        run_rollback_job.delay(str(job.id))
    except Exception as e:
        return JSONResponse(
            status_code=status.HTTP_202_ACCEPTED,
            content={
                "job_id": str(job.id),
                "message": "Failed to dispatch rollback task to Celery queue.",
                "error": str(e)
            }
        )

    return JSONResponse(
        status_code=status.HTTP_202_ACCEPTED,
        content={
            "job_id": str(job.id),
            "message": "Rollback task enqueued successfully."
        }
    )

# ==========================================
# USER & AUDIT MANAGEMENT
# ==========================================
from pydantic import BaseModel

class UserCreate(BaseModel):
    username: str
    password: str
    role: UserRole

class UserUpdate(BaseModel):
    role: UserRole | None = None
    is_active: bool | None = None
    password: str | None = None

class UserRead(BaseModel):
    id: uuid.UUID
    username: str
    role: UserRole
    is_active: bool

@app.get(
    "/api/v1/users",
    response_model=List[UserRead],
    tags=["RBAC"],
    dependencies=[Depends(require_role([UserRole.SUPER_ADMIN]))]
)
async def get_users(db: AsyncSession = Depends(get_db_session)):
    result = await db.execute(select(User))
    return list(result.scalars().all())

@app.post(
    "/api/v1/users",
    response_model=UserRead,
    tags=["RBAC"],
    dependencies=[Depends(require_role([UserRole.SUPER_ADMIN]))]
)
async def create_user(
    payload: UserCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session)
):
    from app.core.security import get_password_hash
    from app.models.audit_log import AuditLog
    
    # Check if username exists
    existing = await db.execute(select(User).where(User.username == payload.username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Username already registered")
        
    new_user = User(
        username=payload.username,
        password_hash=get_password_hash(payload.password),
        role=payload.role
    )
    db.add(new_user)
    
    audit = AuditLog(
        user_id=current_user.id,
        action="create_user",
        details={"created_username": payload.username, "role": payload.role.value}
    )
    db.add(audit)
    
    await db.commit()
    await db.refresh(new_user)
    return new_user

@app.put(
    "/api/v1/users/{user_id}",
    response_model=UserRead,
    tags=["RBAC"],
    dependencies=[Depends(require_role([UserRole.SUPER_ADMIN]))]
)
async def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session)
):
    from app.core.security import get_password_hash
    from app.models.audit_log import AuditLog
    
    result = await db.execute(select(User).where(User.id == user_id))
    user_to_update = result.scalar_one_or_none()
    if not user_to_update:
        raise HTTPException(status_code=404, detail="User not found")
        
    if payload.role is not None:
        user_to_update.role = payload.role
    if payload.is_active is not None:
        user_to_update.is_active = payload.is_active
    if payload.password is not None and len(payload.password) > 0:
        user_to_update.password_hash = get_password_hash(payload.password)
        
    audit = AuditLog(
        user_id=current_user.id,
        action="update_user",
        details={"target_user_id": str(user_id), "target_username": user_to_update.username}
    )
    db.add(audit)
    
    await db.commit()
    await db.refresh(user_to_update)
    return user_to_update

@app.delete(
    "/api/v1/users/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["RBAC"],
    dependencies=[Depends(require_role([UserRole.SUPER_ADMIN]))]
)
async def delete_user(
    user_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session)
):
    from app.models.audit_log import AuditLog
    
    result = await db.execute(select(User).where(User.id == user_id))
    user_to_delete = result.scalar_one_or_none()
    if not user_to_delete:
        raise HTTPException(status_code=404, detail="User not found")
        
    if user_to_delete.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own user")
        
    audit = AuditLog(
        user_id=current_user.id,
        action="delete_user",
        details={"target_user_id": str(user_id), "target_username": user_to_delete.username}
    )
    db.add(audit)
    
    await db.delete(user_to_delete)
    await db.commit()

@app.get(
    "/api/v1/audit-logs",
    tags=["RBAC"],
    dependencies=[Depends(require_role([UserRole.SUPER_ADMIN]))]
)
async def get_audit_logs(db: AsyncSession = Depends(get_db_session)):
    from app.models.audit_log import AuditLog
    stmt = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(100).options(selectinload(AuditLog.user))
    result = await db.execute(stmt)
    logs = list(result.scalars().all())
    return [
        {
            "id": str(log.id),
            "timestamp": log.created_at.isoformat(),
            "username": log.user.username if log.user else "System",
            "action": log.action,
            "resource_type": log.resource_type,
            "resource_id": log.resource_id,
            "details": log.details
        }
        for log in logs
    ]

# ==========================================
# BASELINE PACKAGES ENDPOINTS
# ==========================================

from app.schemas.template_schemas import BaselinePackageCreate, BaselinePackageRead
from app.models.baseline_package import BaselinePackage
from app.models.configuration_template import ConfigurationTemplate

@app.post(
    "/api/v1/packages",
    response_model=BaselinePackageRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(get_current_user)],
    tags=["Baseline Packages"]
)
async def create_package(
    payload: BaselinePackageCreate,
    db: AsyncSession = Depends(get_db_session)
):
    stmt = select(ConfigurationTemplate).where(ConfigurationTemplate.id.in_(payload.template_ids))
    result = await db.execute(stmt)
    templates = list(result.scalars().all())
    
    if len(templates) != len(payload.template_ids):
        raise HTTPException(status_code=400, detail="One or more template IDs are invalid")
        
    db_package = BaselinePackage(
        name=payload.name,
        description=payload.description or "",
        templates=templates
    )
    db.add(db_package)
    await db.commit()
    await db.refresh(db_package)
    return db_package

@app.get(
    "/api/v1/packages",
    response_model=List[BaselinePackageRead],
    tags=["Baseline Packages"],
    dependencies=[Depends(get_current_user)]
)
async def list_packages(db: AsyncSession = Depends(get_db_session)):
    stmt = select(BaselinePackage).options(selectinload(BaselinePackage.templates))
    result = await db.execute(stmt)
    return list(result.scalars().all())

# ==========================================
# CATCH-ALL ROUTE FOR REACT SPA
# ==========================================
from fastapi import Request
import os

from app.schemas.assessment import AssessmentRunRequest
from app.tasks import run_zero_trust_assessment

@app.post(
    "/api/v1/assessment/run",
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(get_current_user)],
    tags=["Assessment"]
)
async def start_assessment(
    payload: AssessmentRunRequest,
    db: AsyncSession = Depends(get_db_session)
) -> JSONResponse:
    stmt = select(Organization).where(Organization.id == payload.organization_id).options(selectinload(Organization.credentials))
    result = await db.execute(stmt)
    org = result.scalar_one_or_none()
    
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
        
    client_id = payload.client_id
    tenant_id = payload.tenant_id
    certificate_base64 = payload.certificate_data
    
    if not client_id and org.credentials:
        # Fallback to org credentials if not explicitly provided (though standard creds don't have certs, we try to grab what we can)
        client_id = org.credentials[0].client_id
        tenant_id = org.tenant_id
        
    if not client_id or not tenant_id:
        raise HTTPException(status_code=400, detail="Missing Client ID or Tenant ID")
        
    try:
        run_zero_trust_assessment.delay(str(org.id), client_id, tenant_id, certificate_base64 or "")
        return JSONResponse(status_code=202, content={"message": "Assessment task queued."})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get(
    "/api/v1/assessment/report/{org_id}",
    dependencies=[Depends(get_current_user)],
    tags=["Assessment"]
)
async def get_assessment_report(org_id: uuid.UUID):
    report_path = f"/app/static/reports/{org_id}/ZeroTrustAssessmentReport.html"
    # Actually in our local filesystem it's c:/intune_export/app/static/reports/...
    # But wait, this is running inside docker, so /app/static/reports...
    # So we should just use relative path from the app dir or os.path.join
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    report_file = os.path.join(base_dir, "app", "static", "reports", str(org_id), "ZeroTrustAssessmentReport.html")
    if os.path.exists(report_file):
        return FileResponse(report_file)
    raise HTTPException(status_code=404, detail="Report not found or not generated yet")

from fastapi import Request

@app.get("/{full_path:path}", tags=["UI"])
async def serve_react_app(request: Request, full_path: str):
    """
    Catch-all route to serve the React SPA and let React Router handle client-side routing.
    This must be at the very bottom so it doesn't intercept specific /api endpoints.
    """
    # Prevent catching API calls that were not matched (send 404 instead of HTML)
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="API route not found")
    
    # Try to serve a specific static file if it exists at the root level (e.g. favicon.ico)
    file_path = os.path.join(dist_path, full_path)
    if os.path.isfile(file_path):
        return FileResponse(file_path)
        
    # Fallback to index.html for React Router
    index_path = os.path.join(dist_path, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
        
    raise HTTPException(status_code=404, detail="React build not found. Please run 'npm run build' inside frontend directory.")
