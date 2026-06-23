import uuid
from pydantic import BaseModel, ConfigDict, Field


class AppCredentialBase(BaseModel):
    client_id: str = Field(..., min_length=1, max_length=100, description="Microsoft Entra ID Application (Client) ID")
    auth_type: str = Field("application", description="Authentication type: 'application' or 'delegated'")


class AppCredentialCreate(AppCredentialBase):
    client_secret: str = Field(..., min_length=1, max_length=255, description="Microsoft Entra ID Client Secret (Plaintext)")


class AppCredentialRead(AppCredentialBase):
    id: uuid.UUID
    organization_id: uuid.UUID
    
    # We do NOT return the client_secret or client_secret_encrypted for security.
    # Instead, we return a masked representation if requested.
    client_secret_masked: str = Field("••••••••••••••••", description="Masked representation of client secret")

    model_config = ConfigDict(from_attributes=True)
