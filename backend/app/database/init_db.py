
from app.database.session import Base, engine
from app.models import Case, Patient, User


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    print("Database tables created successfully.")


if __name__ == "__main__":
    init_db()
