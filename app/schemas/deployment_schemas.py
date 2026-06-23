import uuid
from datetime import datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from app.models.deployment_job import DeploymentStatus
from app.schemas.template_schemas import ConfigurationTemplateRead


class GroupDefinition(BaseModel):
    """
    Schema representing security group creation parameters in Entra ID.
    """
    display_name: str = Field(..., min_length=1, max_length=255, description="Name of the security group to create in Entra ID")
    group_type: str = Field("static", description="Type of group membership: static or dynamic")
    membership_rule: Optional[str] = Field(None, description="Dynamic membership query rule (required if group_type is dynamic)")

    @field_validator("group_type")
    @classmethod
    def validate_group_type(cls, value: str) -> str:
        if value not in ["static", "dynamic"]:
            raise ValueError("group_type must be either 'static' or 'dynamic'")
        return value

    @model_validator(mode="after")
    def validate_membership_rule(self) -> "GroupDefinition":
        # If group_type is dynamic, membership_rule is required
        if self.group_type == "dynamic" and not self.membership_rule:
            raise ValueError("membership_rule is required when group_type is 'dynamic'")
        return self


class TemplateAssignment(BaseModel):
    """
    Schema representing specific policy assignment configuration for a single template.
    Allows a policy to be assigned to custom groups or left unassigned independently.
    """
    template_id: uuid.UUID = Field(..., description="ID of the Configuration Template to assign")
    assignment_target: str = Field(
        "unassigned",
        description="Policy assignment target for this template: all_devices, all_users, custom_groups, unassigned"
    )
    assign_to_groups: Optional[List[str]] = Field(
        None,
        description="Optional list of group names to assign this specific template to (relevant if target is custom_groups)"
    )

    @field_validator("assignment_target")
    @classmethod
    def validate_assignment_target(cls, value: Optional[str]) -> Optional[str]:
        allowed = ["all_devices", "all_users", "custom_groups", "unassigned"]
        if value and value not in allowed:
            raise ValueError(f"assignment_target must be one of: {', '.join(allowed)}")
        return value


class DeploymentJobBase(BaseModel):
    organization_id: uuid.UUID = Field(..., description="ID of the target Organization tenant to apply the configuration")


class DeploymentJobCreate(DeploymentJobBase):
    template_ids: List[uuid.UUID] = Field(..., min_length=1, description="List of Configuration Template IDs to apply")
    create_groups: Optional[List[GroupDefinition]] = Field(None, description="Optional list of Entra ID security groups to create")
    assignment_target: Optional[str] = Field(
        "unassigned",
        description="Optional policy assignment target: all_devices, all_users, custom_groups, unassigned"
    )
    assign_to_groups: Optional[List[str]] = Field(
        None,
        description="Optional list of group names to assign the deployed policies to"
    )
    template_assignments: Optional[List[TemplateAssignment]] = Field(
        None,
        description="Optional list of template-specific assignments. If specified, overrides the global target and groups."
    )
    bypass_validation: Optional[bool] = Field(
        False,
        description="Optional flag to bypass target tenant capability/license pre-validations"
    )

    @field_validator("assignment_target")
    @classmethod
    def validate_assignment_target(cls, value: Optional[str]) -> Optional[str]:
        allowed = ["all_devices", "all_users", "custom_groups", "unassigned"]
        if value and value not in allowed:
            raise ValueError(f"assignment_target must be one of: {', '.join(allowed)}")
        return value


class DeploymentJobRead(DeploymentJobBase):
    id: uuid.UUID
    status: DeploymentStatus
    parameters: Optional[dict] = Field(None, description="Optional custom run parameters (groups created, targets)")
    logs: Optional[list] = Field(default=[], description="Real-time log entries from deployment execution")
    created_at: datetime
    completed_at: Optional[datetime] = None
    templates: List[ConfigurationTemplateRead] = Field(default=[], description="List of templates applied in this job")

    model_config = ConfigDict(from_attributes=True)
