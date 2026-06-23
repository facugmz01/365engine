import asyncio
import sys
import logging
from sqlalchemy import select

# Configure basic logging to console
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger("db_init")

# Add the parent directory to sys.path to resolve 'app' imports when run as a standalone script
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from app.database.connection import init_db, engine, async_session_maker
from app.models.configuration_template import ConfigurationTemplate
from app.database.seeds import baseline_seeds


async def seed_baseline_templates() -> None:
    """
    Checks if the configuration templates table is empty.
    If so, populates it with the default pre-generated baseline seeds.
    """
    async with async_session_maker() as session:
        try:
            stmt = select(ConfigurationTemplate)
            result = await session.execute(stmt)
            existing_template = result.scalars().first()
            
            if not existing_template:
                logger.info("Central templates library is empty. Seeding default baselines...")
                for seed in baseline_seeds:
                    template = ConfigurationTemplate(
                        name=seed["name"],
                        description=seed["description"],
                        category=seed["category"],
                        endpoint=seed["endpoint"],
                        payload=seed["payload"]
                    )
                    session.add(template)
                await session.commit()
                logger.info(f"Successfully seeded {len(baseline_seeds)} default baselines!")
            else:
                logger.info("Central templates library already contains templates. Skipping seeding.")
        except Exception as e:
            logger.error(f"Error during baseline seeding: {e}")
            await session.rollback()


async def main() -> None:
    """
    Asynchronously initializes the database tables and populates default baselines.
    """
    logger.info("Initializing database tables...")
    try:
        # 1. Create tables
        await init_db()
        logger.info("Successfully initialized all database tables in PostgreSQL!")
        
        # 2. Seed default baselines
        await seed_baseline_templates()
        
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}")
        logger.error("Please ensure your PostgreSQL instance is running and DATABASE_URL is configured correctly.")
        sys.exit(1)
    finally:
        # Dispose of engine connection pool resources
        await engine.dispose()


if __name__ == "__main__":
    # Run the async main function
    asyncio.run(main())
