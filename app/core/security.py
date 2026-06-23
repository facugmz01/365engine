from cryptography.fernet import Fernet
from app.core.config import settings


class CredentialEncryptor:
    """
    Utility class to encrypt and decrypt client secrets using symmetric encryption (Fernet).
    """

    def __init__(self, key: str = settings.ENCRYPTION_KEY):
        try:
            self.fernet = Fernet(key.encode() if isinstance(key, str) else key)
        except Exception as e:
            # Fallback or initialization error handling
            raise ValueError(
                f"Invalid ENCRYPTION_KEY format. Must be a 32-byte URL-safe base64-encoded key. Error: {e}"
            )

    def encrypt(self, plain_text: str) -> str:
        """
        Encrypts a plaintext string and returns the ciphertext as a UTF-8 string.
        """
        if not plain_text:
            return ""
        encrypted_bytes = self.fernet.encrypt(plain_text.encode("utf-8"))
        return encrypted_bytes.decode("utf-8")

    def decrypt(self, cipher_text: str) -> str:
        """
        Decrypts a ciphertext string and returns the original plaintext string.
        """
        if not cipher_text:
            return ""
        decrypted_bytes = self.fernet.decrypt(cipher_text.encode("utf-8"))
        return decrypted_bytes.decode("utf-8")


# Singleton instance for global app use
encryptor = CredentialEncryptor()


import hashlib
import jwt
import os
from datetime import datetime, timedelta, timezone

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

def get_password_hash(password: str) -> str:
    """
    Returns the SHA-256 hash of the password with a static salt.
    """
    salt = "m365_baseline_salt_987!"
    return hashlib.sha256((password + salt).encode("utf-8")).hexdigest()

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verifies a plain text password against its stored hash.
    """
    return get_password_hash(plain_password) == hashed_password

def create_access_token(data: dict, expires_delta: timedelta = None) -> str:
    """
    Creates a JWT access token containing the provided data and expiration claim.
    """
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.ENCRYPTION_KEY, algorithm=JWT_ALGORITHM)
    return encoded_jwt

def decode_access_token(token: str) -> dict:
    """
    Decodes and validates a JWT access token, returning the payload if valid, otherwise empty dict.
    """
    try:
        decoded_payload = jwt.decode(token, settings.ENCRYPTION_KEY, algorithms=[JWT_ALGORITHM])
        return decoded_payload
    except jwt.PyJWTError:
        return {}

# The default admin config is now only used for the initial database seed,
# see app.database.connection.init_db().
DEFAULT_ADMIN_PASSWORD_HASH = get_password_hash(os.getenv("ADMIN_PASSWORD", "admin_password_123!"))
