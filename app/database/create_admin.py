"""
Script para crear el usuario admin inicial si no existe.
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import select
from app.database.connection import async_session_maker
from app.models.user import User, UserRole
from app.core.security import get_password_hash


ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin_password_123!")


async def create_admin_user() -> None:
    async with async_session_maker() as session:
        existing = await session.execute(select(User).where(User.username == ADMIN_USERNAME))
        user = existing.scalar_one_or_none()

        if user:
            print(f"[OK] Usuario '{ADMIN_USERNAME}' ya existe (role={user.role.value}, active={user.is_active})")
            return

        admin = User(
            username=ADMIN_USERNAME,
            password_hash=get_password_hash(ADMIN_PASSWORD),
            role=UserRole.SUPER_ADMIN,
            is_active=True,
        )
        session.add(admin)
        await session.commit()
        print(f"[OK] Usuario '{ADMIN_USERNAME}' creado con rol SUPER_ADMIN")


if __name__ == "__main__":
    asyncio.run(create_admin_user())
