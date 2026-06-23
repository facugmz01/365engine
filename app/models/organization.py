import uuid
from datetime import datetime, timezone
from typing import List, TYPE_CHECKING
from sqlalchemy import String, DateTime
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.app_credential import AppCredential
    from app.models.deployment_job import DeploymentJob


class Organization(Base):
    """
    SQLAlchemy Model for the organizations table.
    Stores metadata about Microsoft 365 tenants (target implementation environments).
    """
    __tablename__ = "organizations"

    # UUID Primary Key
    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
        index=True
    )
    
    # Human-readable name for the tenant (e.g., "Contoso Tenant")
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    
    # Microsoft Entra ID / Office 365 Tenant ID (UUID format as string)
    tenant_id: Mapped[str] = mapped_column(
        String(100),
        unique=True,
        nullable=False,
        index=True
    )
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc)
    )
    
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc)
    )

    # Drift Scanning Config
    auto_drift_enabled: Mapped[bool] = mapped_column(default=False)
    drift_scan_schedule: Mapped[str] = mapped_column(String(50), nullable=True)

    # Relationships
    credentials: Mapped[List["AppCredential"]] = relationship(
        "AppCredential",
        back_populates="organization",
        cascade="all, delete-orphan"
    )

    # Deployment jobs run on this target tenant
    deployment_jobs: Mapped[List["DeploymentJob"]] = relationship(
        "DeploymentJob",
        back_populates="organization",
        cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Organization name={self.name} tenant_id={self.tenant_id}>"
