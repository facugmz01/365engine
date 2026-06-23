import asyncio
import logging
import time
from typing import Dict, Tuple, List, Optional
import msal

logger = logging.getLogger("app.services.auth_agent")


class AuthAgentException(Exception):
    """Base exception for Authentication Agent errors."""
    pass


class InvalidCredentialsException(AuthAgentException):
    """Raised when provided credentials or parameters are invalid."""
    pass


class TokenAcquisitionException(AuthAgentException):
    """Raised when Microsoft Entra ID fails to issue an access token."""
    pass


class GraphAuthAgent:
    """
    GraphAuthAgent handles Microsoft Graph API authentication via Entra ID Client Credentials Flow.
    Uses MSAL Python and includes an in-memory caching system to prevent redundant token requests.
    """

    def __init__(self, token_expiry_buffer: int = 300) -> None:
        """
        Initializes the agent.
        :param token_expiry_buffer: Buffer time in seconds. A token is refreshed if it
                                    expires in less than this buffer time (default 5 mins).
        """
        self.token_expiry_buffer = token_expiry_buffer
        # In-memory cache mapping: (tenant_id, client_id) -> (access_token, expires_at)
        self._cache: Dict[Tuple[str, str], Tuple[str, float]] = {}

    def _get_cached_token(self, tenant_id: str, client_id: str) -> Optional[str]:
        """
        Retrieves a valid token from the cache if it exists and is not about to expire.
        """
        cache_key = (tenant_id, client_id)
        if cache_key in self._cache:
            token, expires_at = self._cache[cache_key]
            # Check if the token is still valid (accounting for buffer time)
            if time.time() < (expires_at - self.token_expiry_buffer):
                logger.debug(f"Retrieved active token from cache for tenant={tenant_id}, client_id={client_id}")
                return token
            else:
                logger.debug(f"Cached token for tenant={tenant_id} is expired or about to expire. Evicting.")
                del self._cache[cache_key]
        return None

    def _set_cached_token(self, tenant_id: str, client_id: str, token: str, expires_in: int) -> None:
        """
        Stores a token in the cache with its computed absolute expiry time.
        """
        cache_key = (tenant_id, client_id)
        expires_at = time.time() + expires_in
        self._cache[cache_key] = (token, expires_at)
        logger.debug(f"Cached new token for tenant={tenant_id}, client_id={client_id}. Expires in {expires_in}s.")

    def _acquire_token_sync(self, tenant_id: str, client_id: str, client_secret: str) -> Dict:
        """
        Synchronous call to MSAL ConfidentialClientApplication to fetch the access token.
        Runs in a separate thread via asyncio.to_thread to prevent blocking the event loop.
        """
        authority_url = f"https://login.microsoftonline.com/{tenant_id}"
        
        # 1. Initialize MSAL Confidential Client
        try:
            app = msal.ConfidentialClientApplication(
                client_id=client_id,
                client_credential=client_secret,
                authority=authority_url
            )
        except Exception as e:
            raise InvalidCredentialsException(f"Failed to initialize MSAL Application: {e}")

        # 2. Request token for Client Credentials Flow
        scopes = ["https://graph.microsoft.com/.default"]
        logger.info(f"Requesting new client credential token from Entra ID for tenant={tenant_id}")
        
        # Request access token directly from client credentials cache or remote server
        result = app.acquire_token_for_client(scopes=scopes)
        return result

    async def get_access_token(self, tenant_id: str, client_id: str, client_secret: str) -> str:
        """
        Asynchronously obtains a Microsoft Graph API access token.
        Checks local cache first. If cache is missing or expired, requests a new token asynchronously.
        
        :param tenant_id: Microsoft Entra ID Tenant Directory ID
        :param client_id: Entra ID App registration Client ID
        :param client_secret: Entra ID Client Secret (decrypted)
        :return: Access token string
        :raises InvalidCredentialsException: If input credentials fail client initialization
        :raises TokenAcquisitionException: If MSAL fails to retrieve the token from Entra ID
        """
        if not tenant_id or not client_id or not client_secret:
            raise InvalidCredentialsException("tenant_id, client_id, and client_secret must not be empty.")

        # 1. Check in-memory cache
        cached_token = self._get_cached_token(tenant_id, client_id)
        if cached_token:
            return cached_token

        # 2. Cache miss -> Retrieve token from Entra ID (offloaded to thread pool)
        try:
            # offload blocking I/O calls to thread pool
            result = await asyncio.to_thread(
                self._acquire_token_sync,
                tenant_id,
                client_id,
                client_secret
            )
        except AuthAgentException:
            raise
        except Exception as e:
            raise TokenAcquisitionException(f"Unexpected error during token request: {e}")

        # 3. Process MSAL token response
        if "access_token" in result:
            token = result["access_token"]
            expires_in = result.get("expires_in", 3600)  # default to 1 hour if not specified
            self._set_cached_token(tenant_id, client_id, token, expires_in)
            return token
        else:
            # Authentication failed, extract error reasons
            error = result.get("error")
            error_desc = result.get("error_description")
            correlation_id = result.get("correlation_id")
            error_msg = f"Auth failed: {error}. Description: {error_desc}. Correlation ID: {correlation_id}"
            logger.error(error_msg)
            raise TokenAcquisitionException(error_msg)


# Export a global singleton instance of the AuthAgent
auth_agent = GraphAuthAgent()

# ==========================================
# SSO Helper Functions
# ==========================================
def build_sso_app(client_id: str, client_secret: str, tenant_id: str) -> msal.ConfidentialClientApplication:
    authority_url = f"https://login.microsoftonline.com/{tenant_id}"
    return msal.ConfidentialClientApplication(
        client_id=client_id,
        client_credential=client_secret,
        authority=authority_url
    )

def get_sso_auth_url(client_id: str, client_secret: str, tenant_id: str, redirect_uri: str, state: str = None) -> str:
    app = build_sso_app(client_id, client_secret, tenant_id)
    return app.get_authorization_request_url(
        scopes=["User.Read"],
        state=state,
        redirect_uri=redirect_uri
    )

async def acquire_sso_token(client_id: str, client_secret: str, tenant_id: str, redirect_uri: str, code: str) -> dict:
    app = build_sso_app(client_id, client_secret, tenant_id)
    # offload to thread because MSAL makes synchronous network calls
    result = await asyncio.to_thread(
        app.acquire_token_by_authorization_code,
        code,
        scopes=["User.Read"],
        redirect_uri=redirect_uri
    )
    if "error" in result:
        raise TokenAcquisitionException(f"Failed to acquire SSO token: {result.get('error_description')}")
    return result

# ==========================================
# Delegated Permissions (Intune) Functions
# ==========================================
INTUNE_SCOPES = ["offline_access", "DeviceManagementServiceConfig.ReadWrite.All", "DeviceManagementConfiguration.ReadWrite.All", "DeviceManagementManagedDevices.ReadWrite.All"]

def get_delegated_auth_url(client_id: str, client_secret: str, tenant_id: str, redirect_uri: str, state: str = None) -> str:
    app = build_sso_app(client_id, client_secret, tenant_id)
    return app.get_authorization_request_url(
        scopes=INTUNE_SCOPES,
        state=state,
        redirect_uri=redirect_uri
    )

async def acquire_delegated_token(client_id: str, client_secret: str, tenant_id: str, redirect_uri: str, code: str) -> dict:
    app = build_sso_app(client_id, client_secret, tenant_id)
    result = await asyncio.to_thread(
        app.acquire_token_by_authorization_code,
        code,
        scopes=INTUNE_SCOPES,
        redirect_uri=redirect_uri
    )
    if "error" in result:
        raise TokenAcquisitionException(f"Failed to acquire Delegated token: {result.get('error_description')}")
    return result

async def refresh_delegated_token(client_id: str, client_secret: str, tenant_id: str, refresh_token: str) -> dict:
    app = build_sso_app(client_id, client_secret, tenant_id)
    result = await asyncio.to_thread(
        app.acquire_token_by_refresh_token,
        refresh_token,
        scopes=INTUNE_SCOPES
    )
    if "error" in result:
        raise TokenAcquisitionException(f"Failed to refresh Delegated token: {result.get('error_description')}")
    return result

