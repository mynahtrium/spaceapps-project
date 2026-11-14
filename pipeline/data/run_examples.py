"""Offline Backend 3 leftover pass. No network and no NASA_API_KEY.

Writes labelled DONKI example fixtures, refreshes dose.json from the on-disk
route, and relabels POV JSON using JPEGs already on disk. Copies the science
fixtures into data/demo/. Does not replace a real DONKI cache.

Usage:
    python -m pipeline.data.run_examples
"""

from __future__ import annotations

from typing import Callable

from .build_dose import build_dose
from .build_pov import build_pov
from .example_fixtures import write_alerts_example, write_donki_example
from .export_demo_fixtures import export_demo_fixtures


def _donki_examples() -> None:
    write_donki_example()
    write_alerts_example()


def _pov_offline() -> None:
    build_pov(allow_download=False)


STEPS: dict[str, Callable[[], object]] = {
    "donki-example": _donki_examples,
    "dose": build_dose,
    "pov": _pov_offline,
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

    print("\nOffline example pass completed. No live NASA call.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
