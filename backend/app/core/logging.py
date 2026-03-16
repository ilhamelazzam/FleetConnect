import logging


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )


def get_security_logger() -> logging.Logger:
    return logging.getLogger("app.security")


def mask_email(value: str) -> str:
    if "@" not in value:
        return "***"

    local_part, domain = value.split("@", maxsplit=1)
    if len(local_part) <= 1:
        return f"*@{domain}"

    return f"{local_part[0]}***@{domain}"
