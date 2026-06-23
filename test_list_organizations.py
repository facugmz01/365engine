import asyncio
from app.main import list_organizations
from app.database.connection import get_db_session

async def test_it():
    async for db in get_db_session():
        try:
            result = await list_organizations(db)
            print("Success!")
            print(result)
        except Exception as e:
            print("Failed!")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_it())
