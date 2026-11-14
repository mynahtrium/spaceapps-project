"""8-neighbour Dijkstra on a cost grid. cost == blocked_sentinel or non-finite → impassable."""

from __future__ import annotations

import heapq
import math
from typing import Iterable

import numpy as np

NEIGHBOURS: list[tuple[int, int, float]] = [
    (dr, dc, math.sqrt(2.0) if dr and dc else 1.0)
    for dr in (-1, 0, 1)
    for dc in (-1, 0, 1)
    if not (dr == 0 and dc == 0)
]


def dijkstra(
    cost: np.ndarray,
    start: tuple[int, int],
    goal: tuple[int, int],
    blocked_sentinel: float = 9e99,
) -> list[tuple[int, int]] | None:
    """Return row/col path inclusive of start and goal, or None if unreachable."""
    nrows, ncols = cost.shape
    sr, sc = start
    gr, gc = goal
    if not (0 <= sr < nrows and 0 <= sc < ncols and 0 <= gr < nrows and 0 <= gc < ncols):
        return None
    if not np.isfinite(cost[sr, sc]) or cost[sr, sc] >= blocked_sentinel:
        return None
    if not np.isfinite(cost[gr, gc]) or cost[gr, gc] >= blocked_sentinel:
        return None

    dist = np.full(cost.shape, np.inf, dtype=np.float64)
    parent = np.full(cost.shape + (2,), -1, dtype=np.int32)
    dist[sr, sc] = 0.0
    heap: list[tuple[float, int, int]] = [(0.0, sr, sc)]

    while heap:
        d, r, c = heapq.heappop(heap)
        if d > dist[r, c]:
            continue
        if (r, c) == (gr, gc):
            break
        for dr, dc, step in NEIGHBOURS:
            nr, nc = r + dr, c + dc
            if not (0 <= nr < nrows and 0 <= nc < ncols):
                continue
            cell = cost[nr, nc]
            if not np.isfinite(cell) or cell >= blocked_sentinel:
                continue
            nd = d + step * float(cell)
            if nd < dist[nr, nc]:
                dist[nr, nc] = nd
                parent[nr, nc] = (r, c)
                heapq.heappush(heap, (nd, nr, nc))

    if not np.isfinite(dist[gr, gc]):
        return None

    path: list[tuple[int, int]] = []
    r, c = gr, gc
    while True:
        path.append((r, c))
        if (r, c) == (sr, sc):
            break
        pr, pc = int(parent[r, c, 0]), int(parent[r, c, 1])
        if pr < 0:
            return None
        r, c = pr, pc
    path.reverse()
    return path


def route_through_stops(
    cost: np.ndarray,
    cells: Iterable[tuple[int, int]],
    blocked_sentinel: float = 9e99,
) -> list[tuple[int, int]] | None:
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
