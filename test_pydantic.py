import asyncio
from app.main import list_organizations
from app.database.connection import get_db_session
from app.schemas import OrganizationListRead
from pydantic import TypeAdapter
from typing import List

async def test_pydantic():
    async for db in get_db_session():
        try:
            result = await list_organizations(db)
            adapter = TypeAdapter(List[OrganizationListRead])
            validated = adapter.validate_python(result)
            print("Pydantic validation SUCCESS!")
            print(validated)
        except Exception as e:
            print("Pydantic validation FAILED!")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_pydantic())
