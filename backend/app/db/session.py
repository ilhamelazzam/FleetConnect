from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings
from app.db.base import Base

settings = get_settings()

connect_args = {"check_same_thread": False} if settings.is_sqlite else {}

engine = create_engine(
    settings.sqlalchemy_database_uri,
    pool_pre_ping=True,
    connect_args=connect_args,
)
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    expire_on_commit=False,
)


def get_db_session() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        yield session


def init_db() -> None:
    import app.models  # noqa: F401

    Base.metadata.create_all(bind=engine)


def ensure_plan_activation_schema_compatibility() -> None:
    with engine.begin() as connection:
        inspector = inspect(connection)
        table_names = set(inspector.get_table_names())

        if "plans" not in table_names:
            return

        plan_columns = {column["name"] for column in inspector.get_columns("plans")}
        activation_status_added = False
        activated_at_added = False

        if "activation_status" not in plan_columns:
            activation_status_added = True
            connection.execute(
                text(
                    """
                    ALTER TABLE plans
                    ADD COLUMN activation_status VARCHAR(30) NOT NULL DEFAULT 'inactive'
                    """
                )
            )

        if "activated_at" not in plan_columns:
            activated_at_added = True
            connection.execute(
                text(
                    """
                    ALTER TABLE plans
                    ADD COLUMN activated_at TIMESTAMP WITH TIME ZONE
                    """
                )
            )

        if "activated_by_user_id" not in plan_columns:
            connection.execute(
                text(
                    """
                    ALTER TABLE plans
                    ADD COLUMN activated_by_user_id INTEGER
                    """
                )
            )

        inspector = inspect(connection)
        plan_columns = {column["name"] for column in inspector.get_columns("plans")}

        if activation_status_added:
            connection.execute(
                text(
                    """
                    UPDATE plans
                    SET activation_status = CASE
                        WHEN active_lines > 0 THEN 'active'
                        ELSE 'inactive'
                    END
                    """
                )
            )
            connection.execute(
                text(
                    """
                    ALTER TABLE plans
                    ALTER COLUMN activation_status DROP DEFAULT
                    """
                )
            )

        if activation_status_added or activated_at_added:
            connection.execute(
                text(
                    """
                    UPDATE plans
                    SET activated_at = COALESCE(updated_at, created_at)
                    WHERE activation_status = 'active'
                      AND activated_at IS NULL
                    """
                )
            )

        plan_indexes = {index["name"] for index in inspector.get_indexes("plans")}
        if (
            "activated_by_user_id" in plan_columns
            and "ix_plans_activated_by_user_id" not in plan_indexes
        ):
            connection.execute(
                text(
                    """
                    CREATE INDEX ix_plans_activated_by_user_id
                    ON plans (activated_by_user_id)
                    """
                )
            )

        plan_foreign_keys = {
            foreign_key["name"]
            for foreign_key in inspector.get_foreign_keys("plans")
            if foreign_key.get("name")
        }
        if (
            "activated_by_user_id" in plan_columns
            and "users" in table_names
            and "fk_plans_activated_by_user_id_users" not in plan_foreign_keys
        ):
            connection.execute(
                text(
                    """
                    ALTER TABLE plans
                    ADD CONSTRAINT fk_plans_activated_by_user_id_users
                    FOREIGN KEY (activated_by_user_id)
                    REFERENCES users (id)
                    ON DELETE SET NULL
                    """
                )
            )
