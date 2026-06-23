import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class OrganizationBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="Human-readable name of the M365 organization tenant")
    tenant_id: str = Field(..., min_length=1, max_length=100, description="Microsoft Entra ID Tenant / Directory ID (UUID)")


class OrganizationCreate(OrganizationBase):
    pass


class OrganizationUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    tenant_id: Optional[str] = Field(None, min_length=1, max_length=100)

class OrganizationSettingsUpdate(BaseModel):
    auto_drift_enabled: bool
    drift_scan_schedule: Optional[str] = None

class OrganizationRead(OrganizationBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    auto_drift_enabled: bool = False
    drift_scan_schedule: Optional[str] = None

    # Pydantic v2 configuration to load from SQLAlchemy models
    model_config = ConfigDict(from_attributes=True)


class OrganizationListRead(OrganizationRead):
    """
    Extended read schema for list endpoints.
    Includes has_credentials flag derived from the eagerly loaded credentials relationship.
    """
    has_credentials: bool = False

    model_config = ConfigDict(from_attributes=True)

class DriftReportRead(BaseModel):
    id: uuid.UUID
    organization_id: uuid.UUID
    created_at: datetime
    drifts_found: int
    details: dict
    source: str

    model_config = ConfigDict(from_attributes=True)
