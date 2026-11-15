"""Shared helpers for Backend 3 data-fetching scripts.

Uses python-dotenv, httpx + tenacity, and Pydantic contract validation.
Never prints or logs secret values such as NASA_API_KEY.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import dotenv_values, load_dotenv as _dotenv_load
import httpx
from tenacity import (
    retry,
    retry_if_exception,
    stop_after_attempt,
    wait_exponential,
)


REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
from pipeline.contracts import CONTRACT_MODELS, validate_contract  # noqa: E402

DATA_RAW = REPO_ROOT / "data" / "raw"
DATA_SCIENCE = REPO_ROOT / "data" / "processed" / "science"
USER_AGENT = "curl/8.0"
_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


def _is_retryable_http_error(exc: BaseException) -> bool:
    if isinstance(exc, httpx.TransportError):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in _RETRYABLE_STATUS_CODES
    return False


def utc_now_iso() -> str:
    """Return current UTC timestamp in ISO-8601 format."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_dotenv(env_path: Path | None = None) -> dict[str, str]:
    """Load key=value pairs from .env into os.environ (without overwriting existing vars)."""
    path = env_path or (REPO_ROOT / ".env")
    if not path.exists():
        return {}
    parsed = dotenv_values(path, encoding="utf-8")
    _dotenv_load(dotenv_path=path, override=False, encoding="utf-8")
    return {key: "***" for key in parsed if key}


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


@retry(
    reraise=True,
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=1, min=1, max=8),
    retry=retry_if_exception(_is_retryable_http_error),
)
def _fetch_bytes_with_retry(url: str, timeout: int) -> bytes:
    with httpx.Client(
        follow_redirects=True,
        timeout=float(timeout),
        headers={"User-Agent": USER_AGENT},
    ) as client:
        resp = client.get(url)
        resp.raise_for_status()
        return resp.content


def http_get_bytes(url: str, timeout: int = 30) -> bytes:
    """Fetch raw bytes from a URL with a polite User-Agent, httpx, and tenacity retries."""
    try:
        return _fetch_bytes_with_retry(url, timeout)
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(f"HTTP {exc.response.status_code} while fetching {redact_url(url)}") from exc
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Network error ({exc}) while fetching {redact_url(url)}") from exc


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
    """Validate contracted payloads via Pydantic and write formatted JSON."""
    if isinstance(payload, dict) and payload.get("contract") in CONTRACT_MODELS:
        validate_contract(payload)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
