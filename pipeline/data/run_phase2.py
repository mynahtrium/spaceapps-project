"""Run Phase 2 Backend 3 outputs (alerts.json, dose.json, layers-themis.json, layers-crism.json).

Usage:
    python -m pipeline.data.run_phase2
"""

from __future__ import annotations

from typing import Callable

from .build_alerts import build_alerts
from .build_crism_index import build_crism_index
from .build_dose import build_dose
from .build_layers_themis import build_layers_themis

STEPS: dict[str, Callable[[], object]] = {
    "alerts": build_alerts,
    "dose": build_dose,
    "themis": build_layers_themis,
    "crism": build_crism_index,
}


def main() -> int:
    errors: list[str] = []
    for name, fn in STEPS.items():
        print(f"=== Building {name} ===")
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

    print("\nAll Phase 2 science outputs completed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
