import uuid
from datetime import datetime, timezone
from typing import List, TYPE_CHECKING
from sqlalchemy import String, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.deployment_job import DeploymentJob


class ConfigurationTemplate(Base):
    """
    SQLAlchemy Model for the configuration_templates table.
    Stores reusable Microsoft 365 configuration policy baselines as JSON payloads
    along with their target Microsoft Graph API endpoints.
    """
    __tablename__ = "configuration_templates"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
        index=True
    )
    
    # Name of the configuration baseline (e.g. "Windows Firewall Policy")
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    
    # Optional description of the configuration template
    description: Mapped[str] = mapped_column(String(1000), default="")
    
    # Category (e.g. "intune", "exchange", "purview", "defender", "sharepoint", etc.)
    category: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    
    # The Microsoft Graph API endpoint for the policy (e.g. "deviceManagement/configurationPolicies")
    endpoint: Mapped[str] = mapped_column(String(255), nullable=False)
    
    # The actual JSON configuration payload to be POSTed to Microsoft Graph
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc)
    )
    
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc)
    )

    # Many-to-many relationship with DeploymentJob
    deployment_jobs: Mapped[List["DeploymentJob"]] = relationship(
        "DeploymentJob",
        secondary="deployment_job_templates",
        back_populates="templates"
    )

    def __repr__(self) -> str:
        return f"<ConfigurationTemplate name={self.name} category={self.category} endpoint={self.endpoint}>"
