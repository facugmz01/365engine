import uuid
from datetime import datetime, timezone
from typing import List, TYPE_CHECKING
from sqlalchemy import String, DateTime, Table, Column, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.configuration_template import ConfigurationTemplate

# Join table for many-to-many relationship between BaselinePackage and ConfigurationTemplate
package_templates = Table(
    "package_templates",
    Base.metadata,
    Column("package_id", ForeignKey("baseline_packages.id", ondelete="CASCADE"), primary_key=True),
    Column("template_id", ForeignKey("configuration_templates.id", ondelete="CASCADE"), primary_key=True),
)

class BaselinePackage(Base):
    """
    SQLAlchemy Model for the baseline_packages table.
    Represents a logical grouping of multiple ConfigurationTemplates (Directivas)
    created by the user to be deployed as a single unit (Plantilla).
    """
    __tablename__ = "baseline_packages"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
        index=True
    )
    
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(String(1000), default="")
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc)
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc)
    )

    # Many-to-many relationship with ConfigurationTemplate
    templates: Mapped[List["ConfigurationTemplate"]] = relationship(
        "ConfigurationTemplate",
        secondary=package_templates,
        lazy="selectin"
    )

    def __repr__(self) -> str:
        return f"<BaselinePackage name={self.name}>"
