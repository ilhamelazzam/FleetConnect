from __future__ import annotations

import argparse
import sys
from pathlib import Path


CURRENT_FILE = Path(__file__).resolve()
BACKEND_DIR = CURRENT_FILE.parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.services.auth_service import (  # noqa: E402
    DEFAULT_SUPER_ADMIN_EMAIL,
    DEFAULT_SUPER_ADMIN_NAME,
    DEFAULT_SUPER_ADMIN_PASSWORD,
    ensure_super_admin_account,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Create or repair the FleetConnect IA Super Admin account.",
    )
    parser.add_argument("--name", default=DEFAULT_SUPER_ADMIN_NAME)
    parser.add_argument("--email", default=DEFAULT_SUPER_ADMIN_EMAIL)
    parser.add_argument("--password", default=DEFAULT_SUPER_ADMIN_PASSWORD)
    args = parser.parse_args()

    user = ensure_super_admin_account(
        full_name=args.name,
        email=args.email,
        password=args.password,
    )

    print("SUPER_ADMIN_READY")
    print(f"id={user.id}")
    print(f"email={user.email}")
    print(f"role={user.role}")
    print(f"is_active={user.is_active}")
    print(f"account_status={user.account_status}")


if __name__ == "__main__":
    main()
