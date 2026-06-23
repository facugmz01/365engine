import uuid
from pydantic import BaseModel
from typing import Optional, Dict, Any

class AssessmentRunRequest(BaseModel):
    organization_id: uuid.UUID
    # Optional parameters if not using the organization's stored credentials
    client_id: Optional[str] = None
    tenant_id: Optional[str] = None
    certificate_data: Optional[str] = None # Base64 encoded PFX or PEM
