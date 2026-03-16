from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import hash_password
from app.models.user import User
from app.schemas.user import UserCreate, UserUpdate


def list_users(db: Session, *, offset: int = 0, limit: int = 50) -> list[User]:
    statement = (
        select(User).order_by(User.created_at.desc(), User.id.desc()).offset(offset).limit(limit)
    )
    return list(db.scalars(statement))


def get_user_by_id(db: Session, user_id: int) -> User | None:
    return db.get(User, user_id)


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email.lower().strip()))


def create_user(db: Session, payload: UserCreate) -> User:
    user = User(
        full_name=payload.full_name.strip(),
        email=str(payload.email).lower().strip(),
        hashed_password=hash_password(payload.password),
        photo_url=(payload.photo_url.strip() or None) if payload.photo_url else None,
        role=payload.role,
        is_active=payload.is_active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def update_user(db: Session, user: User, payload: UserUpdate) -> User:
    data = payload.model_dump(exclude_unset=True)

    if "full_name" in data and data["full_name"] is not None:
        user.full_name = data["full_name"].strip()
    if "email" in data and data["email"] is not None:
        user.email = str(data["email"]).lower().strip()
    if "photo_url" in data:
        user.photo_url = (data["photo_url"].strip() or None) if data["photo_url"] else None
    if "role" in data and data["role"] is not None:
        user.role = data["role"]
    if "is_active" in data and data["is_active"] is not None:
        user.is_active = data["is_active"]
    if "password" in data and data["password"]:
        user.hashed_password = hash_password(data["password"])

    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def delete_user(db: Session, user: User) -> None:
    db.delete(user)
    db.commit()


def update_user_password(db: Session, user: User, password: str) -> User:
    user.hashed_password = hash_password(password)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user
