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


def _get_table_names(connection) -> set[str]:
    return set(inspect(connection).get_table_names())


def _get_columns(connection, table_name: str) -> set[str]:
    return {
        column["name"]
        for column in inspect(connection).get_columns(table_name)
    }


def _get_column_definitions(connection, table_name: str) -> dict[str, dict[str, object]]:
    return {
        column["name"]: column
        for column in inspect(connection).get_columns(table_name)
    }


def _get_indexes(connection, table_name: str) -> set[str]:
    return {
        index["name"]
        for index in inspect(connection).get_indexes(table_name)
    }


def _get_foreign_keys(connection, table_name: str) -> set[str]:
    return {
        foreign_key["name"]
        for foreign_key in inspect(connection).get_foreign_keys(table_name)
        if foreign_key.get("name")
    }


def ensure_company_registration_schema_compatibility() -> None:
    with engine.begin() as connection:
        table_names = _get_table_names(connection)

        if "companies" not in table_names:
            connection.execute(
                text(
                    """
                    CREATE TABLE companies (
                        id SERIAL PRIMARY KEY,
                        name VARCHAR(160) NOT NULL,
                        join_code VARCHAR(32) UNIQUE,
                        sector VARCHAR(120) NOT NULL,
                        city VARCHAR(120) NOT NULL,
                        phone VARCHAR(30) NOT NULL,
                        ice VARCHAR(80) UNIQUE,
                        rc VARCHAR(80) UNIQUE,
                        tax_id VARCHAR(80),
                        cnss VARCHAR(80),
                        patente VARCHAR(80),
                        website VARCHAR(255),
                        estimated_phone_lines INTEGER NOT NULL DEFAULT 0,
                        employees_count INTEGER NOT NULL DEFAULT 0,
                        operators_json TEXT NOT NULL DEFAULT '[]',
                        coverage_zones_json TEXT NOT NULL DEFAULT '[]',
                        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )
            )

        table_names = _get_table_names(connection)
        if "companies" in table_names:
            company_columns = _get_columns(connection, "companies")
            if "join_code" not in company_columns:
                connection.execute(
                    text(
                        """
                        ALTER TABLE companies
                        ADD COLUMN join_code VARCHAR(32)
                        """
                    )
                )
            company_column_statements = {
                "address_line": """
                    ALTER TABLE companies
                    ADD COLUMN address_line VARCHAR(255)
                """,
                "region": """
                    ALTER TABLE companies
                    ADD COLUMN region VARCHAR(120)
                """,
                "postal_code": """
                    ALTER TABLE companies
                    ADD COLUMN postal_code VARCHAR(40)
                """,
                "country": """
                    ALTER TABLE companies
                    ADD COLUMN country VARCHAR(120)
                """,
                "logo_path": """
                    ALTER TABLE companies
                    ADD COLUMN logo_path VARCHAR(500)
                """,
                "status": """
                    ALTER TABLE companies
                    ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'active'
                """,
            }
            for column_name, statement in company_column_statements.items():
                if column_name not in company_columns:
                    connection.execute(text(statement))
            company_indexes = _get_indexes(connection, "companies")
            if "ix_companies_id" not in company_indexes:
                connection.execute(
                    text(
                        """
                        CREATE INDEX ix_companies_id ON companies (id)
                        """
                    )
                )
            if "ix_companies_country" not in company_indexes:
                connection.execute(
                    text(
                        """
                        CREATE INDEX ix_companies_country ON companies (country)
                        """
                    )
                )
            if "ix_companies_status" not in company_indexes:
                connection.execute(
                    text(
                        """
                        CREATE INDEX ix_companies_status ON companies (status)
                        """
                    )
                )
            if "ix_companies_name" not in company_indexes:
                connection.execute(
                    text(
                        """
                        CREATE INDEX ix_companies_name ON companies (name)
                        """
                    )
                )
            if "ix_companies_city" not in company_indexes:
                connection.execute(
                    text(
                        """
                        CREATE INDEX ix_companies_city ON companies (city)
                        """
                    )
                )
            if "ix_companies_join_code" not in company_indexes:
                connection.execute(
                    text(
                        """
                        CREATE INDEX ix_companies_join_code ON companies (join_code)
                        """
                    )
                )

        if "users" in table_names:
            user_columns = _get_columns(connection, "users")
            if "company_id" not in user_columns:
                connection.execute(
                    text(
                        """
                        ALTER TABLE users
                        ADD COLUMN company_id INTEGER
                        """
                    )
                )
            if "phone" not in user_columns:
                connection.execute(
                    text(
                        """
                        ALTER TABLE users
                        ADD COLUMN phone VARCHAR(30)
                        """
                    )
                )
            if "requested_department" not in user_columns:
                connection.execute(
                    text(
                        """
                        ALTER TABLE users
                        ADD COLUMN requested_department VARCHAR(120)
                        """
                    )
                )
            if "account_status" not in user_columns:
                connection.execute(
                    text(
                        """
                        ALTER TABLE users
                        ADD COLUMN account_status VARCHAR(30) NOT NULL DEFAULT 'active'
                        """
                    )
                )
                connection.execute(
                    text(
                        """
                        UPDATE users
                        SET account_status = CASE
                            WHEN is_active = TRUE THEN 'active'
                            ELSE 'suspended'
                        END
                        """
                    )
                )

            user_indexes = _get_indexes(connection, "users")
            if "ix_users_company_id" not in user_indexes:
                connection.execute(
                    text(
                        """
                        CREATE INDEX ix_users_company_id ON users (company_id)
                        """
                    )
                )
            if "ix_users_account_status" not in user_indexes:
                connection.execute(
                    text(
                        """
                        CREATE INDEX ix_users_account_status ON users (account_status)
                        """
                    )
                )

            user_foreign_keys = _get_foreign_keys(connection, "users")
            if "fk_users_company_id_companies" not in user_foreign_keys:
                connection.execute(
                    text(
                        """
                        ALTER TABLE users
                        ADD CONSTRAINT fk_users_company_id_companies
                        FOREIGN KEY (company_id)
                        REFERENCES companies (id)
                        ON DELETE SET NULL
                        """
                    )
                )

        table_names = _get_table_names(connection)
        if "company_registration_requests" not in table_names:
            connection.execute(
                text(
                    """
                    CREATE TABLE company_registration_requests (
                        id SERIAL PRIMARY KEY,
                        responsible_full_name VARCHAR(120) NOT NULL,
                        responsible_phone VARCHAR(30) NOT NULL,
                        job_title VARCHAR(120) NOT NULL DEFAULT 'Responsable Telecom',
                        requested_role VARCHAR(30) NOT NULL DEFAULT 'ADMIN',
                        responsible_email VARCHAR(255) NOT NULL,
                        password_hash VARCHAR(255) NOT NULL,
                        company_name VARCHAR(160) NOT NULL,
                        sector VARCHAR(120) NOT NULL,
                        city VARCHAR(120) NOT NULL,
                        company_phone VARCHAR(30) NOT NULL,
                        ice VARCHAR(80),
                        rc VARCHAR(80),
                        tax_id VARCHAR(80),
                        cnss VARCHAR(80),
                        patente VARCHAR(80),
                        website VARCHAR(255),
                        estimated_phone_lines INTEGER NOT NULL DEFAULT 0,
                        employees_count INTEGER NOT NULL DEFAULT 0,
                        operators_json TEXT NOT NULL DEFAULT '[]',
                        coverage_zones_json TEXT NOT NULL DEFAULT '[]',
                        logo_path VARCHAR(500),
                        legal_representative_cin_path VARCHAR(500) NOT NULL,
                        commercial_register_path VARCHAR(500) NOT NULL,
                        fiscal_document_path VARCHAR(500),
                        company_stamp_path VARCHAR(500),
                        status VARCHAR(30) NOT NULL DEFAULT 'pending',
                        rejection_reason TEXT,
                        reviewed_by INTEGER,
                        reviewed_at TIMESTAMP WITH TIME ZONE,
                        approved_company_id INTEGER,
                        approved_admin_user_id INTEGER,
                        previous_request_id INTEGER,
                        resubmission_number INTEGER NOT NULL DEFAULT 1,
                        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
                        deleted_at TIMESTAMP WITH TIME ZONE,
                        deleted_by INTEGER,
                        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT fk_company_registration_requests_reviewed_by_users
                            FOREIGN KEY (reviewed_by) REFERENCES users (id) ON DELETE SET NULL,
                        CONSTRAINT fk_company_registration_requests_approved_company_id_companies
                            FOREIGN KEY (approved_company_id) REFERENCES companies (id) ON DELETE SET NULL,
                        CONSTRAINT fk_company_registration_requests_approved_admin_user_id_users
                            FOREIGN KEY (approved_admin_user_id) REFERENCES users (id) ON DELETE SET NULL,
                        CONSTRAINT fk_company_registration_requests_previous_request_id
                            FOREIGN KEY (previous_request_id) REFERENCES company_registration_requests (id) ON DELETE SET NULL,
                        CONSTRAINT fk_company_registration_requests_deleted_by_users
                            FOREIGN KEY (deleted_by) REFERENCES users (id) ON DELETE SET NULL
                    )
                    """
                )
            )

        if "company_registration_requests" in _get_table_names(connection):
            request_columns = _get_columns(connection, "company_registration_requests")
            job_title_was_missing = "job_title" not in request_columns
            requested_role_was_missing = "requested_role" not in request_columns
            request_column_statements = {
                "job_title": """
                    ALTER TABLE company_registration_requests
                    ADD COLUMN job_title VARCHAR(120) NOT NULL DEFAULT 'Responsable Telecom'
                """,
                "requested_role": """
                    ALTER TABLE company_registration_requests
                    ADD COLUMN requested_role VARCHAR(30) NOT NULL DEFAULT 'ADMIN'
                """,
                "address_line": """
                    ALTER TABLE company_registration_requests
                    ADD COLUMN address_line VARCHAR(255)
                """,
                "region": """
                    ALTER TABLE company_registration_requests
                    ADD COLUMN region VARCHAR(120)
                """,
                "postal_code": """
                    ALTER TABLE company_registration_requests
                    ADD COLUMN postal_code VARCHAR(40)
                """,
                "country": """
                    ALTER TABLE company_registration_requests
                    ADD COLUMN country VARCHAR(120)
                """,
                "latitude": """
                    ALTER TABLE company_registration_requests
                    ADD COLUMN latitude DOUBLE PRECISION
                """,
                "longitude": """
                    ALTER TABLE company_registration_requests
                    ADD COLUMN longitude DOUBLE PRECISION
                """,
                "previous_request_id": """
                    ALTER TABLE company_registration_requests
                    ADD COLUMN previous_request_id INTEGER
                """,
                "resubmission_number": """
                    ALTER TABLE company_registration_requests
                    ADD COLUMN resubmission_number INTEGER NOT NULL DEFAULT 1
                """,
                "is_deleted": """
                    ALTER TABLE company_registration_requests
                    ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE
                """,
                "deleted_at": """
                    ALTER TABLE company_registration_requests
                    ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE
                """,
                "deleted_by": """
                    ALTER TABLE company_registration_requests
                    ADD COLUMN deleted_by INTEGER
                """,
            }
            for column_name, statement in request_column_statements.items():
                if column_name not in request_columns:
                    connection.execute(text(statement))

            if job_title_was_missing and "responsible_position" in request_columns:
                connection.execute(
                    text(
                        """
                        UPDATE company_registration_requests
                        SET job_title = COALESCE(NULLIF(TRIM(responsible_position), ''), job_title)
                        """
                    )
                )

            if requested_role_was_missing and "responsible_position" in request_columns:
                connection.execute(
                    text(
                        """
                        UPDATE company_registration_requests
                        SET requested_role = CASE
                            WHEN LOWER(COALESCE(responsible_position, '')) LIKE '%manager%' THEN 'MANAGER'
                            WHEN LOWER(COALESCE(responsible_position, '')) LIKE '%analyst%' THEN 'ANALYST'
                            WHEN LOWER(COALESCE(responsible_position, '')) LIKE '%analyste%' THEN 'ANALYST'
                            ELSE 'ADMIN'
                        END
                        """
                    )
                )

            if "responsible_position" in request_columns:
                connection.execute(
                    text(
                        """
                        UPDATE company_registration_requests
                        SET responsible_position = COALESCE(
                            NULLIF(TRIM(responsible_position), ''),
                            NULLIF(TRIM(job_title), ''),
                            'Responsable Telecom'
                        )
                        WHERE responsible_position IS NULL
                           OR TRIM(responsible_position) = ''
                        """
                    )
                )
                request_column_definitions = _get_column_definitions(
                    connection,
                    "company_registration_requests",
                )
                responsible_position_definition = request_column_definitions.get(
                    "responsible_position",
                )
                if responsible_position_definition and responsible_position_definition.get(
                    "nullable",
                ) is False:
                    connection.execute(
                        text(
                            """
                            ALTER TABLE company_registration_requests
                            ALTER COLUMN responsible_position DROP NOT NULL
                            """
                        )
                    )

            connection.execute(
                text(
                    """
                    UPDATE company_registration_requests
                    SET requested_role = 'ANALYST'
                    WHERE requested_role = 'ANALYSTE'
                    """
                )
            )

            request_indexes = _get_indexes(connection, "company_registration_requests")
            index_statements = {
                "ix_company_registration_requests_id": """
                    CREATE INDEX ix_company_registration_requests_id
                    ON company_registration_requests (id)
                """,
                "ix_company_registration_requests_responsible_email": """
                    CREATE INDEX ix_company_registration_requests_responsible_email
                    ON company_registration_requests (responsible_email)
                """,
                "ix_company_registration_requests_company_name": """
                    CREATE INDEX ix_company_registration_requests_company_name
                    ON company_registration_requests (company_name)
                """,
                "ix_company_registration_requests_city": """
                    CREATE INDEX ix_company_registration_requests_city
                    ON company_registration_requests (city)
                """,
                "ix_company_registration_requests_country": """
                    CREATE INDEX ix_company_registration_requests_country
                    ON company_registration_requests (country)
                """,
                "ix_company_registration_requests_ice": """
                    CREATE INDEX ix_company_registration_requests_ice
                    ON company_registration_requests (ice)
                """,
                "ix_company_registration_requests_rc": """
                    CREATE INDEX ix_company_registration_requests_rc
                    ON company_registration_requests (rc)
                """,
                "ix_company_registration_requests_status": """
                    CREATE INDEX ix_company_registration_requests_status
                    ON company_registration_requests (status)
                """,
                "ix_company_registration_requests_reviewed_by": """
                    CREATE INDEX ix_company_registration_requests_reviewed_by
                    ON company_registration_requests (reviewed_by)
                """,
                "ix_company_registration_requests_approved_company_id": """
                    CREATE INDEX ix_company_registration_requests_approved_company_id
                    ON company_registration_requests (approved_company_id)
                """,
                "ix_company_registration_requests_approved_admin_user_id": """
                    CREATE INDEX ix_company_registration_requests_approved_admin_user_id
                    ON company_registration_requests (approved_admin_user_id)
                """,
                "ix_company_registration_requests_previous_request_id": """
                    CREATE INDEX ix_company_registration_requests_previous_request_id
                    ON company_registration_requests (previous_request_id)
                """,
                "ix_company_registration_requests_deleted_by": """
                    CREATE INDEX ix_company_registration_requests_deleted_by
                    ON company_registration_requests (deleted_by)
                """,
                "ix_company_registration_requests_is_deleted": """
                    CREATE INDEX ix_company_registration_requests_is_deleted
                    ON company_registration_requests (is_deleted)
                """,
                "uq_active_company_request_email": """
                    CREATE UNIQUE INDEX uq_active_company_request_email
                    ON company_registration_requests (LOWER(responsible_email))
                    WHERE status IN ('pending', 'under_review', 'approved') AND is_deleted = FALSE
                """,
            }

            for index_name, statement in index_statements.items():
                if index_name not in request_indexes:
                    connection.execute(text(statement))

        table_names = _get_table_names(connection)
        if "company_documents" not in table_names:
            connection.execute(
                text(
                    """
                    CREATE TABLE company_documents (
                        id SERIAL PRIMARY KEY,
                        request_id INTEGER,
                        company_id INTEGER,
                        document_key VARCHAR(80) NOT NULL,
                        label VARCHAR(160) NOT NULL,
                        file_name VARCHAR(255) NOT NULL,
                        relative_path VARCHAR(500) NOT NULL,
                        content_type VARCHAR(120),
                        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT fk_company_documents_request_id_requests
                            FOREIGN KEY (request_id)
                            REFERENCES company_registration_requests (id)
                            ON DELETE CASCADE,
                        CONSTRAINT fk_company_documents_company_id_companies
                            FOREIGN KEY (company_id)
                            REFERENCES companies (id)
                            ON DELETE SET NULL
                    )
                    """
                )
            )

        if "company_documents" in _get_table_names(connection):
            company_document_indexes = _get_indexes(connection, "company_documents")
            company_document_index_statements = {
                "ix_company_documents_id": """
                    CREATE INDEX ix_company_documents_id
                    ON company_documents (id)
                """,
                "ix_company_documents_request_id": """
                    CREATE INDEX ix_company_documents_request_id
                    ON company_documents (request_id)
                """,
                "ix_company_documents_company_id": """
                    CREATE INDEX ix_company_documents_company_id
                    ON company_documents (company_id)
                """,
                "ix_company_documents_document_key": """
                    CREATE INDEX ix_company_documents_document_key
                    ON company_documents (document_key)
                """,
            }
            for index_name, statement in company_document_index_statements.items():
                if index_name not in company_document_indexes:
                    connection.execute(text(statement))

        table_names = _get_table_names(connection)
        if "company_status_history" not in table_names:
            connection.execute(
                text(
                    """
                    CREATE TABLE company_status_history (
                        id SERIAL PRIMARY KEY,
                        request_id INTEGER,
                        company_id INTEGER,
                        actor_user_id INTEGER,
                        action VARCHAR(80) NOT NULL,
                        title VARCHAR(180) NOT NULL,
                        comment TEXT,
                        previous_status VARCHAR(30),
                        next_status VARCHAR(30),
                        metadata_json TEXT,
                        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT fk_company_status_history_request_id_requests
                            FOREIGN KEY (request_id)
                            REFERENCES company_registration_requests (id)
                            ON DELETE CASCADE,
                        CONSTRAINT fk_company_status_history_company_id_companies
                            FOREIGN KEY (company_id)
                            REFERENCES companies (id)
                            ON DELETE SET NULL,
                        CONSTRAINT fk_company_status_history_actor_user_id_users
                            FOREIGN KEY (actor_user_id)
                            REFERENCES users (id)
                            ON DELETE SET NULL
                    )
                    """
                )
            )

        if "company_status_history" in _get_table_names(connection):
            company_history_indexes = _get_indexes(connection, "company_status_history")
            company_history_index_statements = {
                "ix_company_status_history_id": """
                    CREATE INDEX ix_company_status_history_id
                    ON company_status_history (id)
                """,
                "ix_company_status_history_request_id": """
                    CREATE INDEX ix_company_status_history_request_id
                    ON company_status_history (request_id)
                """,
                "ix_company_status_history_company_id": """
                    CREATE INDEX ix_company_status_history_company_id
                    ON company_status_history (company_id)
                """,
                "ix_company_status_history_actor_user_id": """
                    CREATE INDEX ix_company_status_history_actor_user_id
                    ON company_status_history (actor_user_id)
                """,
                "ix_company_status_history_action": """
                    CREATE INDEX ix_company_status_history_action
                    ON company_status_history (action)
                """,
                "ix_company_status_history_previous_status": """
                    CREATE INDEX ix_company_status_history_previous_status
                    ON company_status_history (previous_status)
                """,
                "ix_company_status_history_next_status": """
                    CREATE INDEX ix_company_status_history_next_status
                    ON company_status_history (next_status)
                """,
                "ix_company_status_history_created_at": """
                    CREATE INDEX ix_company_status_history_created_at
                    ON company_status_history (created_at)
                """,
            }
            for index_name, statement in company_history_index_statements.items():
                if index_name not in company_history_indexes:
                    connection.execute(text(statement))


def ensure_user_invitation_schema_compatibility() -> None:
    with engine.begin() as connection:
        table_names = _get_table_names(connection)
        if "user_invitations" not in table_names:
            connection.execute(
                text(
                    """
                    CREATE TABLE user_invitations (
                        id SERIAL PRIMARY KEY,
                        company_id INTEGER NOT NULL,
                        email VARCHAR(255) NOT NULL,
                        full_name VARCHAR(120) NOT NULL,
                        phone VARCHAR(30),
                        department VARCHAR(120) NOT NULL,
                        job_title VARCHAR(120) NOT NULL,
                        role VARCHAR(50) NOT NULL DEFAULT 'user',
                        token VARCHAR(255) NOT NULL UNIQUE,
                        status VARCHAR(30) NOT NULL DEFAULT 'pending',
                        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
                        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        created_by_id INTEGER,
                        accepted_at TIMESTAMP WITH TIME ZONE,
                        CONSTRAINT fk_user_invitations_company_id_companies
                            FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE CASCADE,
                        CONSTRAINT fk_user_invitations_created_by_id_users
                            FOREIGN KEY (created_by_id) REFERENCES users (id) ON DELETE SET NULL
                    )
                    """
                )
            )

        invitation_columns = _get_columns(connection, "user_invitations")
        invitation_column_statements = {
            "email": """
                ALTER TABLE user_invitations
                ADD COLUMN email VARCHAR(255) NOT NULL DEFAULT ''
            """,
            "full_name": """
                ALTER TABLE user_invitations
                ADD COLUMN full_name VARCHAR(120) NOT NULL DEFAULT ''
            """,
            "phone": """
                ALTER TABLE user_invitations
                ADD COLUMN phone VARCHAR(30)
            """,
            "department": """
                ALTER TABLE user_invitations
                ADD COLUMN department VARCHAR(120) NOT NULL DEFAULT ''
            """,
            "job_title": """
                ALTER TABLE user_invitations
                ADD COLUMN job_title VARCHAR(120) NOT NULL DEFAULT ''
            """,
            "role": """
                ALTER TABLE user_invitations
                ADD COLUMN role VARCHAR(50) NOT NULL DEFAULT 'user'
            """,
            "token": """
                ALTER TABLE user_invitations
                ADD COLUMN token VARCHAR(255)
            """,
            "status": """
                ALTER TABLE user_invitations
                ADD COLUMN status VARCHAR(30) NOT NULL DEFAULT 'pending'
            """,
            "expires_at": """
                ALTER TABLE user_invitations
                ADD COLUMN expires_at TIMESTAMP WITH TIME ZONE
            """,
            "created_at": """
                ALTER TABLE user_invitations
                ADD COLUMN created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
            """,
            "created_by_id": """
                ALTER TABLE user_invitations
                ADD COLUMN created_by_id INTEGER
            """,
            "sent_at": """
                ALTER TABLE user_invitations
                ADD COLUMN sent_at TIMESTAMP WITH TIME ZONE
            """,
            "accepted_at": """
                ALTER TABLE user_invitations
                ADD COLUMN accepted_at TIMESTAMP WITH TIME ZONE
            """,
        }
        for column_name, statement in invitation_column_statements.items():
            if column_name not in invitation_columns:
                connection.execute(text(statement))

        invitation_indexes = _get_indexes(connection, "user_invitations")
        invitation_index_statements = {
            "ix_user_invitations_id": """
                CREATE INDEX ix_user_invitations_id
                ON user_invitations (id)
            """,
            "ix_user_invitations_company_id": """
                CREATE INDEX ix_user_invitations_company_id
                ON user_invitations (company_id)
            """,
            "ix_user_invitations_email": """
                CREATE INDEX ix_user_invitations_email
                ON user_invitations (email)
            """,
            "ix_user_invitations_token": """
                CREATE INDEX ix_user_invitations_token
                ON user_invitations (token)
            """,
            "ix_user_invitations_status": """
                CREATE INDEX ix_user_invitations_status
                ON user_invitations (status)
            """,
            "ix_user_invitations_expires_at": """
                CREATE INDEX ix_user_invitations_expires_at
                ON user_invitations (expires_at)
            """,
            "ix_user_invitations_created_by_id": """
                CREATE INDEX ix_user_invitations_created_by_id
                ON user_invitations (created_by_id)
            """,
        }
        for index_name, statement in invitation_index_statements.items():
            if index_name not in invitation_indexes:
                connection.execute(text(statement))

        invitation_foreign_keys = _get_foreign_keys(connection, "user_invitations")
        if (
            "created_by_id" in invitation_columns
            and "fk_user_invitations_created_by_id_users" not in invitation_foreign_keys
        ):
            connection.execute(
                text(
                    """
                    ALTER TABLE user_invitations
                    ADD CONSTRAINT fk_user_invitations_created_by_id_users
                    FOREIGN KEY (created_by_id)
                    REFERENCES users (id)
                    ON DELETE SET NULL
                    """
                )
            )


def ensure_notification_schema_compatibility() -> None:
    with engine.begin() as connection:
        table_names = _get_table_names(connection)
        if "notifications" not in table_names:
            connection.execute(
                text(
                    """
                    CREATE TABLE notifications (
                        id SERIAL PRIMARY KEY,
                        recipient_user_id INTEGER NOT NULL,
                        actor_user_id INTEGER,
                        related_resource_id INTEGER,
                        related_compliance_alert_id INTEGER,
                        notification_type VARCHAR(30) NOT NULL,
                        title VARCHAR(180) NOT NULL,
                        message TEXT NOT NULL,
                        priority VARCHAR(30) NOT NULL DEFAULT 'medium',
                        link_url VARCHAR(255),
                        ai_recommendation TEXT,
                        suggested_action TEXT,
                        source_type VARCHAR(80),
                        source_id VARCHAR(120),
                        source_key VARCHAR(160),
                        metadata_json JSON NOT NULL DEFAULT '{}'::json,
                        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
                        read_at TIMESTAMP WITH TIME ZONE,
                        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT notifications_recipient_user_id_fkey
                            FOREIGN KEY (recipient_user_id) REFERENCES users (id) ON DELETE CASCADE,
                        CONSTRAINT notifications_actor_user_id_fkey
                            FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL,
                        CONSTRAINT notifications_related_resource_id_fkey
                            FOREIGN KEY (related_resource_id) REFERENCES fleet_resources (id) ON DELETE SET NULL,
                        CONSTRAINT notifications_related_compliance_alert_id_fkey
                            FOREIGN KEY (related_compliance_alert_id) REFERENCES compliance_alerts (id) ON DELETE SET NULL
                    )
                    """
                )
            )

        notification_columns = _get_columns(connection, "notifications")
        notification_column_statements = {
            "recipient_user_id": """
                ALTER TABLE notifications
                ADD COLUMN recipient_user_id INTEGER
            """,
            "actor_user_id": """
                ALTER TABLE notifications
                ADD COLUMN actor_user_id INTEGER
            """,
            "related_resource_id": """
                ALTER TABLE notifications
                ADD COLUMN related_resource_id INTEGER
            """,
            "related_compliance_alert_id": """
                ALTER TABLE notifications
                ADD COLUMN related_compliance_alert_id INTEGER
            """,
            "notification_type": """
                ALTER TABLE notifications
                ADD COLUMN notification_type VARCHAR(30) NOT NULL DEFAULT 'info'
            """,
            "title": """
                ALTER TABLE notifications
                ADD COLUMN title VARCHAR(180) NOT NULL DEFAULT ''
            """,
            "message": """
                ALTER TABLE notifications
                ADD COLUMN message TEXT NOT NULL DEFAULT ''
            """,
            "priority": """
                ALTER TABLE notifications
                ADD COLUMN priority VARCHAR(30) NOT NULL DEFAULT 'medium'
            """,
            "link_url": """
                ALTER TABLE notifications
                ADD COLUMN link_url VARCHAR(255)
            """,
            "ai_recommendation": """
                ALTER TABLE notifications
                ADD COLUMN ai_recommendation TEXT
            """,
            "suggested_action": """
                ALTER TABLE notifications
                ADD COLUMN suggested_action TEXT
            """,
            "source_type": """
                ALTER TABLE notifications
                ADD COLUMN source_type VARCHAR(80)
            """,
            "source_id": """
                ALTER TABLE notifications
                ADD COLUMN source_id VARCHAR(120)
            """,
            "source_key": """
                ALTER TABLE notifications
                ADD COLUMN source_key VARCHAR(160)
            """,
            "metadata_json": """
                ALTER TABLE notifications
                ADD COLUMN metadata_json JSON NOT NULL DEFAULT '{}'::json
            """,
            "is_deleted": """
                ALTER TABLE notifications
                ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE
            """,
            "read_at": """
                ALTER TABLE notifications
                ADD COLUMN read_at TIMESTAMP WITH TIME ZONE
            """,
            "created_at": """
                ALTER TABLE notifications
                ADD COLUMN created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
            """,
            "updated_at": """
                ALTER TABLE notifications
                ADD COLUMN updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
            """,
        }
        for column_name, statement in notification_column_statements.items():
            if column_name not in notification_columns:
                connection.execute(text(statement))

        notification_indexes = _get_indexes(connection, "notifications")
        notification_index_statements = {
            "ix_notifications_id": """
                CREATE INDEX ix_notifications_id
                ON notifications (id)
            """,
            "ix_notifications_recipient_user_id": """
                CREATE INDEX ix_notifications_recipient_user_id
                ON notifications (recipient_user_id)
            """,
            "ix_notifications_actor_user_id": """
                CREATE INDEX ix_notifications_actor_user_id
                ON notifications (actor_user_id)
            """,
            "ix_notifications_related_resource_id": """
                CREATE INDEX ix_notifications_related_resource_id
                ON notifications (related_resource_id)
            """,
            "ix_notifications_related_compliance_alert_id": """
                CREATE INDEX ix_notifications_related_compliance_alert_id
                ON notifications (related_compliance_alert_id)
            """,
            "ix_notifications_notification_type": """
                CREATE INDEX ix_notifications_notification_type
                ON notifications (notification_type)
            """,
            "ix_notifications_priority": """
                CREATE INDEX ix_notifications_priority
                ON notifications (priority)
            """,
            "ix_notifications_source_key": """
                CREATE INDEX ix_notifications_source_key
                ON notifications (source_key)
            """,
            "ix_notifications_source_type": """
                CREATE INDEX ix_notifications_source_type
                ON notifications (source_type)
            """,
            "ix_notifications_is_deleted": """
                CREATE INDEX ix_notifications_is_deleted
                ON notifications (is_deleted)
            """,
            "ix_notifications_created_at": """
                CREATE INDEX ix_notifications_created_at
                ON notifications (created_at)
            """,
        }
        for index_name, statement in notification_index_statements.items():
            if index_name not in notification_indexes:
                connection.execute(text(statement))

        notification_foreign_keys = _get_foreign_keys(connection, "notifications")
        notification_foreign_key_statements = {
            "notifications_recipient_user_id_fkey": """
                ALTER TABLE notifications
                ADD CONSTRAINT notifications_recipient_user_id_fkey
                FOREIGN KEY (recipient_user_id) REFERENCES users (id) ON DELETE CASCADE
            """,
            "notifications_actor_user_id_fkey": """
                ALTER TABLE notifications
                ADD CONSTRAINT notifications_actor_user_id_fkey
                FOREIGN KEY (actor_user_id) REFERENCES users (id) ON DELETE SET NULL
            """,
            "notifications_related_resource_id_fkey": """
                ALTER TABLE notifications
                ADD CONSTRAINT notifications_related_resource_id_fkey
                FOREIGN KEY (related_resource_id) REFERENCES fleet_resources (id) ON DELETE SET NULL
            """,
            "notifications_related_compliance_alert_id_fkey": """
                ALTER TABLE notifications
                ADD CONSTRAINT notifications_related_compliance_alert_id_fkey
                FOREIGN KEY (related_compliance_alert_id) REFERENCES compliance_alerts (id) ON DELETE SET NULL
            """,
        }
        for constraint_name, statement in notification_foreign_key_statements.items():
            if constraint_name not in notification_foreign_keys:
                connection.execute(text(statement))

        if "uq_notifications_recipient_source" not in notification_indexes:
            connection.execute(
                text(
                    """
                    CREATE UNIQUE INDEX uq_notifications_recipient_source
                    ON notifications (recipient_user_id, source_key)
                    """
                )
            )
