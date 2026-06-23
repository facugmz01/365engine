import enum
import uuid
from datetime import datetime, timezone
from typing import List, Optional, TYPE_CHECKING
from sqlalchemy import ForeignKey, DateTime, Enum, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.organization import Organization
    from app.models.configuration_template import ConfigurationTemplate
    from app.models.user import User


class DeploymentStatus(str, enum.Enum):
    SIMULATED = "simulated"
    PENDING_APPROVAL = "pending_approval"
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    REJECTED = "rejected"


class DeploymentJob(Base):
    """
    SQLAlchemy Model for the deployment_jobs table.
    Registers the history and progress of deploying configuration templates to a target tenant.
    Allows custom arguments like group creation and policy assignments.
    """
    __tablename__ = "deployment_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
        index=True
    )
    
    # Status of the deployment job
    status: Mapped[DeploymentStatus] = mapped_column(
        Enum(DeploymentStatus),
        default=DeploymentStatus.PENDING,
        nullable=False,
        index=True
    )
    
    # Target organization/tenant receiving the configuration
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    
    # RBAC Audit fields
    requested_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    approved_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True
    )
    
    # Stores JSON parameters like:
    # {
    #   "create_groups": [{"display_name": "x", "group_type": "static" | "dynamic", "membership_rule": "..."}],
    #   "assignment_target": "all_devices" | "all_users" | "custom_groups" | "unassigned",
    #   "assign_to_groups": ["group_name_1", "group_name_2"]
    # }
    parameters: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    
    # Stores real-time log entries produced during deployment execution.
    # Each entry: {"ts": "ISO8601", "level": "INFO|SUCCESS|ERROR|WARNING", "msg": "..."}
    logs: Mapped[Optional[list]] = mapped_column(JSON, nullable=True, default=list)
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False
    )
    
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        back_populates="deployment_jobs"
    )

    requested_by: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[requested_by_id]
    )
    approved_by: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[approved_by_id]
    )

    # Many-to-many relationship with ConfigurationTemplate
    templates: Mapped[List["ConfigurationTemplate"]] = relationship(
        "ConfigurationTemplate",
        secondary="deployment_job_templates",
        back_populates="deployment_jobs"
    )

    def __repr__(self) -> str:
        return f"<DeploymentJob id={self.id} status={self.status} organization_id={self.organization_id}>"
