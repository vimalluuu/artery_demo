from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.core.roles import Role


class ProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    full_name: str = Field(min_length=2, max_length=120)
    institution: str = Field(default="", max_length=200)
    department: str = Field(default="", max_length=200)

    @field_validator("full_name", "institution", "department", mode="before")
    @classmethod
    def strip_text(cls, value):
        return value.strip() if isinstance(value, str) else value


class UserRegister(ProfileUpdate):
    email: EmailStr = Field(max_length=255)
    password: str = Field(min_length=12, max_length=128)
    role: Literal["Clinician", "Researcher", "DataScientist"] = "Clinician"


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    full_name: str
    email: EmailStr
    role: Role
    is_active: bool
    institution: str
    department: str


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: EmailStr = Field(max_length=255)
    password: str = Field(min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    user: UserResponse


class PasswordChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


class UserAccessUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Role
    is_active: bool
