"""Run Phase 3 Backend 3 tasks (weather.json, POV stills, data/demo/ export).

Usage:
    python -m pipeline.data.run_phase3
"""

from __future__ import annotations

from typing import Callable

from .build_pov import build_pov
from .build_weather import build_weather
from .export_demo_fixtures import export_demo_fixtures

STEPS: dict[str, Callable[[], object]] = {
    "weather": build_weather,
    "pov": build_pov,
    "demo_export": export_demo_fixtures,
}


def main() -> int:
    errors: list[str] = []
    for name, fn in STEPS.items():
        print(f"=== Running {name} ===")
        try:
            fn()
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

    print("\nAll Phase 3 Backend 3 outputs completed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
