import uuid
from typing import TYPE_CHECKING
from sqlalchemy import String, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.core.security import encryptor

if TYPE_CHECKING:
    from app.models.organization import Organization


class AppCredential(Base):
    """
    SQLAlchemy Model for the app_credentials table.
    Stores the client credentials (client_id and encrypted client_secret)
    associated with an Organization for Microsoft Entra ID.
    """
    __tablename__ = "app_credentials"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
        default=uuid.uuid4,
        index=True
    )
    
    # Foreign key referencing the organization this credential belongs to
    organization_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True
    )
    
    # Authentication type: "application" or "delegated"
    auth_type: Mapped[str] = mapped_column(String(50), default="application", server_default="application", nullable=False)

    # Microsoft Entra ID Client ID (Application ID)
    client_id: Mapped[str] = mapped_column(String(100), nullable=False)
    
    # Encrypted client secret value stored in the database
    client_secret_encrypted: Mapped[str] = mapped_column(String(500), nullable=False)

    # Encrypted refresh token for delegated access (OAuth2)
    refresh_token_encrypted: Mapped[str] = mapped_column(String(2000), nullable=True)

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        back_populates="credentials"
    )

    @property
    def client_secret(self) -> str:
        """
        Getter that automatically decrypts the client secret when accessed.
        """
        return encryptor.decrypt(cipher_text=self.client_secret_encrypted)

    @client_secret.setter
    def client_secret(self, plain_secret: str) -> None:
        """
        Setter that automatically encrypts the client secret before storing it.
        """
        self.client_secret_encrypted = encryptor.encrypt(plain_text=plain_secret)

    @property
    def refresh_token(self) -> str | None:
        """
        Getter that automatically decrypts the refresh token when accessed.
        """
        if not self.refresh_token_encrypted:
            return None
        return encryptor.decrypt(cipher_text=self.refresh_token_encrypted)

    @refresh_token.setter
    def refresh_token(self, plain_token: str | None) -> None:
        """
        Setter that automatically encrypts the refresh token before storing it.
        """
        if plain_token is None:
            self.refresh_token_encrypted = None
        else:
            self.refresh_token_encrypted = encryptor.encrypt(plain_text=plain_token)

    def __repr__(self) -> str:
        return f"<AppCredential client_id={self.client_id} auth_type={self.auth_type} organization_id={self.organization_id}>"
