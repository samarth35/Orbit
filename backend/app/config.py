from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse


PROJECT_ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = PROJECT_ROOT / ".env"


def load_dotenv(path: Path = ENV_PATH) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        os.environ[key] = value.strip().strip('"').strip("'")


def oauth_env(provider: str) -> dict[str, str]:
    normalized = provider.strip().upper().replace("-", "_")
    prefix = f"ORBIT_{normalized}"
    return {
        "client_id": os.getenv(f"{prefix}_CLIENT_ID", ""),
        "client_secret": os.getenv(f"{prefix}_CLIENT_SECRET", ""),
        "redirect_uri": os.getenv(f"{prefix}_REDIRECT_URI", ""),
        "auth_url": os.getenv(f"{prefix}_AUTH_URL", ""),
        "token_url": os.getenv(f"{prefix}_TOKEN_URL", ""),
    }


def public_base_url() -> str:
    return os.getenv("ORBIT_PUBLIC_BASE_URL", "http://127.0.0.1:4174").rstrip("/")


def database_url() -> str:
    return os.getenv("DATABASE_URL", "").strip()


def session_secret() -> str:
    return os.getenv("ORBIT_SESSION_SECRET", "orbit-dev-session-secret-change-me")


def cookie_secure() -> bool:
    return urlparse(public_base_url()).scheme == "https"
