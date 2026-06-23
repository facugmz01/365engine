import uuid
from datetime import datetime
from typing import Optional, Dict, Any
from pydantic import BaseModel, ConfigDict, Field


class ConfigurationTemplateBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="Name of the configuration baseline policy")
    description: Optional[str] = Field("", max_length=1000, description="Description of what this policy configures")
    category: str = Field(..., min_length=1, max_length=100, description="Category (e.g. intune, exchange, purview, defender, sharepoint)")
    endpoint: str = Field(..., min_length=1, max_length=255, description="Microsoft Graph API resource endpoint route path")
    payload: Dict[str, Any] = Field(..., description="The exact Graph API JSON request body payload")


class ConfigurationTemplateCreate(ConfigurationTemplateBase):
    pass


class ConfigurationTemplateUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = Field(None, max_length=1000)
    category: Optional[str] = Field(None, min_length=1, max_length=100)
    endpoint: Optional[str] = Field(None, min_length=1, max_length=255)
    payload: Optional[Dict[str, Any]] = None


class ConfigurationTemplateRead(ConfigurationTemplateBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TemplateImportRequest(BaseModel):
    """
    Request validation schema for importing configurations from a target tenant.
    """
    organization_id: uuid.UUID = Field(
        ...,
        description="ID of the Organization (source tenant) from which to extract policies"
    )
    endpoint: str = Field(
        ...,
        min_length=1,
        max_length=255,
        description="Microsoft Graph API resource endpoint to query (e.g. deviceManagement/configurationPolicies)"
    )
    category: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="Category classification to apply to imported templates (e.g. intune, defender, purview)"
    )


class TCMImportRequest(BaseModel):
    """
    Request validation schema for initiating a bulk import via TCM configurationSnapshotJobs.
    """
    organization_id: uuid.UUID = Field(
        ...,
        description="ID of the Organization (source tenant) from which to extract policies"
    )
    workloads: Optional[list[str]] = Field(
        default=["entra", "intune", "defender", "purview", "teams"],
        description="List of M365 workloads to include in the configuration snapshot"
    )

class BaselinePackageCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="Name of the deployment package")
    description: Optional[str] = Field("", max_length=1000, description="Description of the package")
    template_ids: list[uuid.UUID] = Field(..., description="List of configuration template IDs to include in this package")

class BaselinePackageRead(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    created_at: datetime
    updated_at: datetime
    templates: list[ConfigurationTemplateRead]

    model_config = ConfigDict(from_attributes=True)
