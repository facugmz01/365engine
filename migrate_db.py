import asyncio
import os
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from app.core.config import settings

async def migrate():
    # Use the connection string from the environment variable inside Docker
    db_url = os.getenv("DATABASE_URL", settings.DATABASE_URL)
    engine = create_async_engine(db_url, echo=True)
    async with engine.begin() as conn:
        try:
            print("Running ALTER TABLE queries...")
            await conn.execute(text("ALTER TABLE app_credentials ADD COLUMN auth_type VARCHAR(50) NOT NULL DEFAULT 'application';"))
            await conn.execute(text("ALTER TABLE app_credentials ADD COLUMN refresh_token_encrypted VARCHAR(2000) NULL;"))
            print("Migration successful! Column 'auth_type' and 'refresh_token_encrypted' were added.")
        except Exception as e:
            if "Duplicate column name" in str(e):
                print("Columns already exist, migration skipped.")
            else:
                print(f"Migration error: {e}")

if __name__ == "__main__":
    asyncio.run(migrate())
