"""Explicit operator-only bootstrap. No default credentials or public admin signup."""
from getpass import getpass

from sqlalchemy import select

from app.core.security import hash_password
from app.database.session import SessionLocal
from app.models import User
from app.schemas.auth import UserRegister
from app.services.audit import record_event


def main():
    data = UserRegister(full_name=input("Full name: "), email=input("Email: "),
                        password=getpass("Password (12-128 characters): "))
    with SessionLocal() as db:
        email = str(data.email).lower()
        if db.scalar(select(User).where(User.email == email)):
            raise SystemExit("Account already exists; use an administrator to change access")
        user = User(full_name=data.full_name, email=email, password_hash=hash_password(data.password),
                    role="Admin", is_active=True)
        db.add(user)
        db.flush()
        record_event(db, "admin.bootstrap", user.id)
        db.commit()
    print("Administrator created")


if __name__ == "__main__":
    main()
