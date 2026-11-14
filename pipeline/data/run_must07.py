"""Run MUST-07 background data caches for Backend 3.

Usage:
    python -m pipeline.data.run_must07
    python -m pipeline.data.run_must07 --only donki waypoints
"""

from __future__ import annotations

import argparse
from typing import Callable

from .fetch_donki import fetch_donki
from .fetch_pds_indexes import fetch_pds_indexes
from .fetch_pov_index import fetch_pov_index
from .fetch_waypoints import fetch_waypoints


STEPS: dict[str, Callable[[], object]] = {
    "donki": fetch_donki,
    "waypoints": fetch_waypoints,
    "pov": fetch_pov_index,
    "pds": fetch_pds_indexes,
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Backend 3 MUST-07 background caches.")
    parser.add_argument(
        "--only",
        nargs="+",
        choices=list(STEPS.keys()),
        default=list(STEPS.keys()),
        help="Subset of steps to run.",
    )
    args = parser.parse_args()

    errors: list[str] = []
    for name in args.only:
        print(f"=== Running {name} ===")
        try:
            STEPS[name]()
            print(f"[OK] {name}")
        except Exception as exc:
            msg = f"[ERR] {name}: {exc}"
            print(msg)
            errors.append(msg)

    if errors:
        print("\nCompleted with errors:")
        for err in errors:
            print(" -", err)
        return 1

    print("\nAll selected MUST-07 caches completed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
