"""Shared helpers for Backend 3 data-fetching scripts.

Uses only the Python standard library so scripts run without extra installs.
Never prints or logs secret values such as NASA_API_KEY.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_RAW = REPO_ROOT / "data" / "raw"
DATA_SCIENCE = REPO_ROOT / "data" / "processed" / "science"
USER_AGENT = "curl/8.0"


def utc_now_iso() -> str:
    """Return current UTC timestamp in ISO-8601 format."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_dotenv(env_path: Path | None = None) -> dict[str, str]:
    """Load key=value pairs from .env into os.environ (without overwriting existing vars)."""
    path = env_path or (REPO_ROOT / ".env")
    loaded: dict[str, str] = {}
    if not path.exists():
        return loaded

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value
        if key:
            loaded[key] = "***"
    return loaded


def try_nasa_api_key() -> str | None:
    """Return a personal NASA_API_KEY, or None when it is missing.

    DEMO_KEY is treated as missing. This never invents a key.
    """
    load_dotenv()
    key = os.environ.get("NASA_API_KEY", "").strip()
    if not key or key.upper() == "DEMO_KEY":
        return None
    return key


def get_nasa_api_key() -> str:
    """Return NASA_API_KEY from environment or .env; raise if missing."""
    key = try_nasa_api_key()
    if key is None:
        raise RuntimeError(
            "Personal NASA_API_KEY is required in environment or local .env (DEMO_KEY is not allowed)."
        )
    return key


def http_get_bytes(url: str, timeout: int = 30) -> bytes:
    """Fetch raw bytes from a URL with a polite User-Agent."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code} while fetching {redact_url(url)}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Network error ({exc.reason}) while fetching {redact_url(url)}") from exc


def http_get_json(url: str, timeout: int = 30) -> Any:
    """Fetch JSON from a URL."""
    raw = http_get_bytes(url, timeout=timeout)
    return json.loads(raw.decode("utf-8"))


def redact_url(url: str) -> str:
    """Mask api_key query parameter before logging or raising errors."""
    if "api_key=" not in url:
        return url
    prefix, rest = url.split("api_key=", 1)
    if "&" in rest:
        _, suffix = rest.split("&", 1)
        return f"{prefix}api_key=***&{suffix}"
    return f"{prefix}api_key=***"


def write_json(path: Path, payload: Any) -> None:
    """Write formatted JSON, creating parent directories if needed."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
