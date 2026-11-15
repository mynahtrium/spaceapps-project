"""Pydantic v2 contract schemas and validation helpers for pipeline JSON outputs.

Every JSON written under ``data/processed/`` or ``data/demo/`` conforms to one
of the ``docs/contracts/*.json`` schemas. These models allow additive processed
fields (``extra="allow"``) while enforcing required schema keys, Mars
constants (radii, lunar stand-in slope limit), GeoJSON geometry, and grid
dimensions before files are written.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

MARS_MEAN_RADIUS_KM = 3389.5
MARS_EQUATORIAL_RADIUS_KM = 3396.19
SLOPE_LIMIT_DEG = 20.0

REPO_ROOT = Path(__file__).resolve().parent.parent


class _ContractModel(BaseModel):
    model_config = ConfigDict(extra="allow")


class SourceCitation(_ContractModel):
    name: str
    url: str | None = None
    fetch_date: str | None = None
    product_id: str | None = None
    used_for: str | None = None


class Bounds(_ContractModel):
    west_lon_deg: float
    south_lat_deg: float
    east_lon_deg: float
    north_lat_deg: float

    @model_validator(mode="after")
    def _check_order(self) -> "Bounds":
        if self.west_lon_deg >= self.east_lon_deg:
            raise ValueError(
                f"west_lon_deg ({self.west_lon_deg}) must be < east_lon_deg ({self.east_lon_deg})"
            )
        if self.south_lat_deg >= self.north_lat_deg:
            raise ValueError(
                f"south_lat_deg ({self.south_lat_deg}) must be < north_lat_deg ({self.north_lat_deg})"
            )
        return self


class GridSpec(_ContractModel):
    ncols: int = Field(gt=0)
    nrows: int = Field(gt=0)
    row_major: str = "north_to_south"


class CostMapContract(_ContractModel):
    contract: Literal["martian-mappers.cost-map.v1"]
    status: str
    crs: Literal["mars-geographic-planetocentric"]
    mars_radius_km: float
    mars_radius_equatorial_km: float | None = None
    cell_size_m: float = Field(gt=0)
    grid: GridSpec
    bounds: Bounds
    slope_limit_deg: float
    slope_classes: list[dict[str, Any]]
    cost_formula: str
    blocked_sentinel: float | None = None
    cost_row_major: list[float] | None = None
    example_cost_row_major: list[float] | None = None

    @model_validator(mode="after")
    def _check_constants_and_grid(self) -> "CostMapContract":
        if abs(self.mars_radius_km - MARS_MEAN_RADIUS_KM) > 1e-3:
            raise ValueError(
                f"Expected mars_radius_km == {MARS_MEAN_RADIUS_KM}, got {self.mars_radius_km}"
            )
        if (
            self.mars_radius_equatorial_km is not None
            and abs(self.mars_radius_equatorial_km - MARS_EQUATORIAL_RADIUS_KM) > 1e-2
        ):
            raise ValueError(
                f"Expected mars_radius_equatorial_km == {MARS_EQUATORIAL_RADIUS_KM}, "
                f"got {self.mars_radius_equatorial_km}"
            )
        if abs(self.slope_limit_deg - SLOPE_LIMIT_DEG) > 1e-6:
            raise ValueError(
                f"Expected slope_limit_deg == {SLOPE_LIMIT_DEG}, got {self.slope_limit_deg}"
            )
        values = (
            self.cost_row_major
            if self.cost_row_major is not None
            else self.example_cost_row_major
        )
        if values is None:
            raise ValueError("CostMap requires cost_row_major or example_cost_row_major")
        expected = self.grid.ncols * self.grid.nrows
        if len(values) != expected:
            raise ValueError(
                f"Cost grid length {len(values)} != ncols*nrows ({expected})"
            )
        return self


class LineStringGeometry(_ContractModel):
    type: Literal["LineString"]
    coordinates: list[list[float]] = Field(min_length=2)


class RouteLeg(_ContractModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)
    from_id: str = Field(alias="from")
    to: str
    distance_m: float = Field(ge=0)


class RouteProfilePoint(_ContractModel):
    s_m: float = Field(ge=0)
    elev_m: float | None = None
    slope_deg: float | None = None


class RouteContract(_ContractModel):
    contract: Literal["martian-mappers.route.v1"]
    status: str
    crs: Literal["mars-geographic-planetocentric"]
    mars_radius_km: float
    slope_limit_deg: float
    route_id: str
    stop_order: list[str]
    type: Literal["Feature"]
    properties: dict[str, Any]
    geometry: LineStringGeometry
    legs: list[RouteLeg]
    profile: list[RouteProfilePoint]
    totals: dict[str, Any]

    @model_validator(mode="after")
    def _check_constants(self) -> "RouteContract":
        if abs(self.mars_radius_km - MARS_MEAN_RADIUS_KM) > 1e-3:
            raise ValueError(
                f"Expected mars_radius_km == {MARS_MEAN_RADIUS_KM}, got {self.mars_radius_km}"
            )
        if abs(self.slope_limit_deg - SLOPE_LIMIT_DEG) > 1e-6:
            raise ValueError(
                f"Expected slope_limit_deg == {SLOPE_LIMIT_DEG}, got {self.slope_limit_deg}"
            )
        return self


class HudPosition(_ContractModel):
    lat_deg: float
    lon_deg: float
    elev_m: float | None = None


class HudSample(_ContractModel):
    route_id: str
    along_route_m: float = Field(ge=0)
    position: HudPosition
    heading_deg: float
    distance_travelled_m: float = Field(ge=0)
    distance_to_next_stop_m: float = Field(ge=0)
    distance_remaining_m: float = Field(ge=0)
    slope_deg: float
    slope_class: str
    next_stop_id: str
    next_stop_name: str
    elapsed_min_placeholder: float = Field(ge=0)
    planned_eva_min_placeholder: float = Field(ge=0)
    suit_o2_remaining_percent: float = Field(ge=0, le=100)
    suit_o2_formula: str
    suit_o2_note: str


class HudTelemetryContract(HudSample):
    contract: Literal["martian-mappers.hud-telemetry.v1"]
    status: str
    primary: HudSample | None = None
    samples: list[HudSample] | None = None


class PointGeometry(_ContractModel):
    type: Literal["Point"]
    coordinates: list[float] = Field(min_length=2, max_length=3)


class StopFeature(_ContractModel):
    type: Literal["Feature"]
    properties: dict[str, Any]
    geometry: PointGeometry

    @model_validator(mode="after")
    def _check_id(self) -> "StopFeature":
        if not self.properties.get("id"):
            raise ValueError("Stop feature missing properties.id")
        return self


class StopsContract(_ContractModel):
    contract: Literal["martian-mappers.stops.v1"]
    status: str
    crs: Literal["mars-geographic-planetocentric"]
    type: Literal["FeatureCollection"]
    features: list[StopFeature] = Field(min_length=1)


class AlertsContract(_ContractModel):
    contract: Literal["martian-mappers.alerts.v1"]
    status: str
    source: str
    source_urls: list[str]
    cache_relpath: str
    alerts: list[dict[str, Any]]
    banner: dict[str, Any]


class DoseContract(_ContractModel):
    contract: Literal["martian-mappers.dose.v1"]
    status: str
    baseline_rate_mSv_per_day: float = Field(gt=0)
    baseline_uncertainty_mSv_per_day: float = Field(ge=0)
    baseline_source: str
    baseline_url: str
    eva_duration_h_placeholder: float = Field(ge=0)
    dose_estimate_mSv: float = Field(ge=0)
    dose_formula: str


class WeatherContract(_ContractModel):
    contract: Literal["martian-mappers.weather.v1"]
    status: str
    instrument: str
    archive_url: str
    site: str
    samples: list[dict[str, Any]] | None = None
    chosen_window: dict[str, Any] | None = None
    latest_sol: dict[str, Any] | None = None

    @model_validator(mode="after")
    def _check_weather_body(self) -> "WeatherContract":
        if self.samples is None and self.latest_sol is None:
            raise ValueError("Weather payload must include samples or latest_sol")
        return self


class LayersThemisContract(_ContractModel):
    contract: Literal["martian-mappers.layer-themis.v1"]
    status: str
    kind: Literal["thermal"]
    mission: str
    day: dict[str, Any]
    night: dict[str, Any]
    cached_tiles_relpath: str


class LayersCrismContract(_ContractModel):
    contract: Literal["martian-mappers.layer-crism.v1"]
    status: str
    kind: Literal["spectral"]
    mission: str
    ode_rest: str
    products: list[dict[str, Any]]
    overlay_relpath: str


class PovContract(_ContractModel):
    contract: Literal["martian-mappers.pov.v1"]
    status: str
    stop_id: str
    image_relpath: str
    credit: str
    missing: bool


class PovIndexContract(_ContractModel):
    contract: Literal["martian-mappers.pov-index.v1"]
    fetched_at: str
    stops_source: str
    count: int = Field(ge=0)
    stops: list[PovContract]


class CorridorManifestContract(_ContractModel):
    contract: Literal["martian-mappers.corridor.v1"]
    frame: str
    sources: list[SourceCitation] = Field(min_length=1)
    bounds: Bounds
    dtm_pixel_m: float = Field(gt=0)
    world_size_m: dict[str, float]
    chunk_px: int = Field(gt=0)
    chunks_x: int = Field(gt=0)
    chunks_z: int = Field(gt=0)
    chunk_tex_px: int = Field(gt=0)
    grid_vertices: dict[str, int]
    overview_step: int = Field(gt=0)
    overview_vertices: dict[str, int]
    elev_min_m: float
    elev_step_m: float = Field(gt=0)
    elev_range_m: list[float] = Field(min_length=2, max_length=2)
    height_encoding: str
    files: dict[str, str]


class ReliefContract(_ContractModel):
    contract: Literal["martian-mappers.relief.v1"]
    status: str
    bounds: Bounds
    size_m: float = Field(gt=0)
    hillshade: dict[str, Any]
    textures: dict[str, Any]
    stl: dict[str, Any]
    preview_png_relpath: str
    sources: list[SourceCitation] = Field(min_length=1)


CONTRACT_MODELS: dict[str, type[BaseModel]] = {
    "martian-mappers.cost-map.v1": CostMapContract,
    "martian-mappers.route.v1": RouteContract,
    "martian-mappers.hud-telemetry.v1": HudTelemetryContract,
    "martian-mappers.stops.v1": StopsContract,
    "martian-mappers.alerts.v1": AlertsContract,
    "martian-mappers.dose.v1": DoseContract,
    "martian-mappers.weather.v1": WeatherContract,
    "martian-mappers.layer-themis.v1": LayersThemisContract,
    "martian-mappers.layer-crism.v1": LayersCrismContract,
    "martian-mappers.pov.v1": PovContract,
    "martian-mappers.pov-index.v1": PovIndexContract,
    "martian-mappers.corridor.v1": CorridorManifestContract,
    "martian-mappers.relief.v1": ReliefContract,
}


def validate_contract(payload: dict[str, Any], contract_id: str | None = None) -> BaseModel:
    """Validate ``payload`` against its ``contract`` identifier and return the parsed model."""
    cid = contract_id or payload.get("contract")
    if not cid or cid not in CONTRACT_MODELS:
        raise ValueError(f"Unknown or missing contract identifier: {cid!r}")
    return CONTRACT_MODELS[cid].model_validate(payload)


def write_validated_json(
    path: Path,
    payload: dict[str, Any],
    *,
    contract_id: str | None = None,
    indent: int | None = 2,
    separators: tuple[str, str] | None = None,
) -> None:
    """Validate ``payload`` via Pydantic and write formatted JSON to ``path``."""
    validate_contract(payload, contract_id=contract_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, indent=indent, separators=separators)
    if indent is not None:
        text += "\n"
    path.write_text(text, encoding="utf-8")


def validate_all_repo_contracts(repo_root: Path = REPO_ROOT) -> list[tuple[Path, str]]:
    """Validate every contracted JSON in docs/contracts, data/processed, and data/demo."""
    checked: list[tuple[Path, str]] = []
    roots = [
        repo_root / "docs" / "contracts",
        repo_root / "data" / "processed",
        repo_root / "data" / "demo",
    ]
    for base in roots:
        if not base.exists():
            continue
        for p in sorted(base.rglob("*.json")):
            data = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(data, dict) and data.get("contract") in CONTRACT_MODELS:
                validate_contract(data)
                checked.append((p.relative_to(repo_root), data["contract"]))
    return checked


if __name__ == "__main__":
    results = validate_all_repo_contracts()
    for rel, cid in results:
        print(f"OK  {cid:34s} {rel}")
    print(f"Validated {len(results)} contracted JSON files.")
