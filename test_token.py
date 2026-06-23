import asyncio
import jwt
from sqlalchemy import select
from app.main import get_db_session
from app.models import Organization, AppCredential
from app.services.auth_agent import GraphAuthAgent

async def test_token():
    async for db in get_db_session():
        # Get the first organization with credentials
        stmt = select(Organization).where(Organization.has_credentials == True)
        org = (await db.execute(stmt)).scalars().first()
        if not org:
            print("Org not found")
            return
            
        stmt2 = select(AppCredential).where(AppCredential.organization_id == org.id)
        cred = (await db.execute(stmt2)).scalar_one_or_none()
        if not cred:
            print("Cred not found")
            return
            
        auth_agent = GraphAuthAgent()
        # Force a cache eviction by not using it or just fetch
        token = await auth_agent.get_access_token(
            tenant_id=org.tenant_id,
            client_id=cred.client_id,
            client_secret=cred.client_secret
        )
        
        # Decode the JWT token (header and payload) without verifying signature
        decoded = jwt.decode(token, options={"verify_signature": False})
        print("\n=== TOKEN ROLES (Application Permissions) ===")
        roles = decoded.get("roles", [])
        for r in roles:
            print(f" - {r}")
        
        print("\nIf 'DeviceManagementServiceConfig.ReadWrite.All' is not in the list, the token doesn't have it.")

if __name__ == "__main__":
    asyncio.run(test_token())
