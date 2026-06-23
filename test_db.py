import asyncio
from sqlalchemy import select
from app.main import get_db_session
from app.models import Organization, AppCredential

async def test_db():
    async for db in get_db_session():
        stmt = select(Organization)
        orgs = await db.execute(stmt)
        for org in orgs.scalars().all():
            print(f"Org: {org.name}")
            stmt2 = select(AppCredential).where(AppCredential.organization_id == org.id)
            creds = await db.execute(stmt2)
            for cred in creds.scalars().all():
                print(f"  Cred: {cred.client_id}")

if __name__ == "__main__":
    asyncio.run(test_db())
