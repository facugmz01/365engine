import asyncio
from app.database.connection import get_db
from app.database.models import Organization
from app.services.auth_agent import auth_agent
from app.services.graph_agent import GraphAPIClient

async def main():
    db_gen = get_db()
    db = await anext(db_gen)
    
    org = await db.query(Organization).first()
    if not org:
        print("No org found")
        return
        
    print(f"Testing with org: {org.name}")
    token = await auth_agent.get_access_token(org.tenant_id, org.client_id, org.get_client_secret())
    
    client = GraphAPIClient(access_token=token)
    
    endpoint = "https://graph.microsoft.com/beta/admin/configurationManagement/configurationSnapshots/createSnapshot"
    
    # Try different payloads
    tests = [
        ["entra", "intune"],
        ["microsoft.intune", "microsoft.aad"],
        ["microsoft.aad.conditionalaccesspolicy"],
        [], # empty
        ["*"]
    ]
    
    for res in tests:
        payload = {
            "displayName": "Test Snapshot",
            "description": "Testing",
            "resources": res
        }
        print(f"\\nTesting resources: {res}")
        try:
            result = await client.post_resource(endpoint=endpoint, payload=payload)
            print("SUCCESS:", result)
        except Exception as e:
            print("ERROR:", e)

if __name__ == "__main__":
    asyncio.run(main())
