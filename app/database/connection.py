from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker

from app.core.config import settings
from app.models.base import Base

# 1. Create the asynchronous database engine
# We use settings.DATABASE_URL which defaults to a postgresql+asyncpg URL.
# Future pool configuration (pool_size, max_overflow) can be added here.
engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,  # Set to True if database query logging is needed in development
    future=True,
)

# 2. Create the asynchronous session maker
# expire_on_commit=False prevents SQLAlchemy from expiring attributes after commit,
# which is crucial for async workflows where lazy loading is disabled by default.
async_session_maker = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency generator function that yields an asynchronous database session.
    Automatically closes the session after use. Used as a FastAPI Depends dependency.
    """
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    """
    Asynchronously creates all tables defined by SQLAlchemy models inheriting from Base.
    Useful for development setup and testing.
    """
    # Import all models to ensure they are registered with the Base metadata before calling create_all
    import app.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def drop_db() -> None:
    """
    Asynchronously drops all tables defined in Base metadata.
    Use with caution! Typically used in testing environments.
    """
    import app.models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
