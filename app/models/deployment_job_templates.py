from sqlalchemy import Table, Column, ForeignKey
from app.models.base import Base

# Junction table representing the many-to-many relationship between
# DeploymentJob and ConfigurationTemplate.
deployment_job_templates = Table(
    "deployment_job_templates",
    Base.metadata,
    Column(
        "deployment_job_id",
        ForeignKey("deployment_jobs.id", ondelete="CASCADE"),
        primary_key=True
    ),
    Column(
        "configuration_template_id",
        ForeignKey("configuration_templates.id", ondelete="CASCADE"),
        primary_key=True
    )
)
