from sqlalchemy import Column, Integer, String, Boolean
from app.database.session import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(String, nullable=False)  # Roles: Radiologist, Medical Researcher, Data Scientist, Administrator
    is_active = Column(Boolean, default=True)