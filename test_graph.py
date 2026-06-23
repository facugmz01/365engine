import asyncio
import json
from sqlalchemy import select
from app.main import get_db_session
from app.models import Organization, AppCredential
from app.services.auth_agent import GraphAuthAgent
from app.services.graph_agent import GraphAPIClient

async def test_graph():
    async for db in get_db_session():
        stmt = select(Organization).where(Organization.name == "TGA")
        org = (await db.execute(stmt)).scalar_one_or_none()
        if not org:
            print("Org not found")
            return
            
        stmt2 = select(AppCredential).where(AppCredential.organization_id == org.id)
        cred = (await db.execute(stmt2)).scalar_one_or_none()
        if not cred:
            print("Cred not found")
            return
            
        auth_agent = GraphAuthAgent()
        token = await auth_agent.get_access_token(
            tenant_id=org.tenant_id,
            client_id=cred.client_id,
            client_secret=cred.client_secret
        )
        client = GraphAPIClient(access_token=token)
        
        # Get deviceManagement settings
        try:
            res = await client.get_resource("deviceManagement/settings")
            print("Settings:", json.dumps(res, indent=2))
        except Exception as e:
            print(f"Error settings: {e}")

if __name__ == "__main__":
    asyncio.run(test_graph())
