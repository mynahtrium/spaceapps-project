"""8-neighbour least-cost pathfinding via scikit-image MCP_Geometric / route_through_array.

Cells with ``cost >= blocked_sentinel``, non-finite cost, or negative cost are
treated as impassable obstacles.
"""

from __future__ import annotations

from typing import Iterable

import numpy as np
from skimage.graph import route_through_array


def _prepare_cost_surface(cost: np.ndarray, blocked_sentinel: float) -> tuple[np.ndarray, np.ndarray]:
    arr = np.asarray(cost, dtype=np.float64)
    blocked = (~np.isfinite(arr)) | (arr >= blocked_sentinel) | (arr < 0.0)
    # scikit-image treats negative costs in route_through_array as impassable obstacles.
    surface = np.where(blocked, -1.0, arr)
    return surface, blocked


def dijkstra(
    cost: np.ndarray,
    start: tuple[int, int],
    goal: tuple[int, int],
    blocked_sentinel: float = 9e99,
) -> list[tuple[int, int]] | None:
    """Return row/col path inclusive of start and goal, or None if unreachable."""
    surface, blocked = _prepare_cost_surface(cost, blocked_sentinel)
    nrows, ncols = surface.shape
    sr, sc = int(start[0]), int(start[1])
    gr, gc = int(goal[0]), int(goal[1])
    if not (0 <= sr < nrows and 0 <= sc < ncols and 0 <= gr < nrows and 0 <= gc < ncols):
        return None
    if blocked[sr, sc] or blocked[gr, gc]:
        return None
    if (sr, sc) == (gr, gc):
        return [(sr, sc)]

    try:
        indices, _ = route_through_array(
            surface,
            (sr, sc),
            (gr, gc),
            fully_connected=True,
            geometric=True,
        )
    except ValueError:
        return None
    return [(int(r), int(c)) for r, c in indices]


def route_through_stops(
    cost: np.ndarray,
    cells: Iterable[tuple[int, int]],
    blocked_sentinel: float = 9e99,
) -> list[tuple[int, int]] | None:
    """Concatenate least-cost paths through an ordered sequence of (row, col) stop cells."""
    cells_list = list(cells)
    if len(cells_list) < 2:
        return None
    full: list[tuple[int, int]] = []
    for a, b in zip(cells_list, cells_list[1:]):
        seg = dijkstra(cost, a, b, blocked_sentinel=blocked_sentinel)
        if seg is None:
            return None
        if full:
            seg = seg[1:]
        full.extend(seg)
    return full
