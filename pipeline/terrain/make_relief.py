"""High-quality relief products for the 3D view and a printable relief model.

Run make_slope.py first (it writes data/raw/terrain/dtm_crop_1m.tif for the
current example-stop window, the same window as cost-map.json).

Usage (from repo root):
    .venv/Scripts/python pipeline/terrain/make_relief.py [--height-px 1024] [--tex-px 4096]
        [--stl-px 256] [--exaggeration 1.0] [--skip-ortho]

Outputs (data/processed/terrain/):
    height-hi.png        RGB-encoded 16-bit height (value = R*256 + G), --height-px square
    hillshade.png        grey multi-directional hillshade of the 1 m DTM
    texture-ortho.jpg    HiRISE 25 cm orthoimage resampled to --tex-px (contrast stretched)
    texture-relief.jpg   ortho x hillshade, tinted with an illustrative Mars palette
    relief.stl           closed binary STL (surface + walls + base), metres, --stl-px grid
    relief-preview.png   oblique 3D render (needs matplotlib; skipped if missing)
    relief.json          manifest: bounds, grids, encoding, sources, honesty notes

Cached raw input: data/raw/terrain/ortho_crop_<px>.tif (gitignored).

HiRISE RED orthoimages are greyscale. The Mars tint in texture-relief.jpg is an
illustrative colour map, not measured colour. Label it that way in the UI.
"""
import argparse
import json
import math
import struct
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds
from scipy.ndimage import gaussian_filter, zoom
from skimage.io import imsave

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data/raw/terrain"
OUT = ROOT / "data/processed/terrain"
MARS_R_M = 3396190.0
LON0 = 137.38
DTM_ID = "DTEEC_019698_1750_019988_1750_U01"
ORTHO_ID = "ESP_019698_1750_RED_A_01_ORTHO"
PDS_DIR = (
    "https://hirise-pds.lpl.arizona.edu/PDS/DTM/ESP/ORB_019600_019699/"
    "ESP_019698_1750_ESP_019988_1750/"
)
DTM_URL = PDS_DIR + DTM_ID + ".IMG"
ORTHO_URL = PDS_DIR + ORTHO_ID + ".JP2"
FETCH_DATE = "2026-11-14"

# Illustrative Mars palette (dark basalt -> dust), used only for the tinted texture.
MARS_DARK = np.array([52, 30, 22], dtype=float)
MARS_MID = np.array([150, 88, 58], dtype=float)
MARS_LIGHT = np.array([232, 186, 142], dtype=float)


def xy_to_lonlat(x, y):
    k = MARS_R_M * math.pi / 180.0
    return x / k + LON0, y / k


def load_dtm():
    with rasterio.open(RAW / "dtm_crop_1m.tif") as ds:
        z = ds.read(1).astype("float64")
        z[(z == ds.nodata) | (z < -1e6)] = np.nan
        return z, ds.res[0], ds.bounds, ds.crs


def load_from_preview():
    """Offline fallback: the 5 m height preview and 1000 px ortho preview already in the repo."""
    from skimage.io import imread
    cm = json.loads((OUT / "cost-map.json").read_text())
    rgb = imread(OUT / "height-preview.png")
    v = rgb[..., 0].astype(float) * 256 + rgb[..., 1]
    lo, hi = cm["height_preview_elevation_range_m"]
    z = lo + v / 65535.0 * (hi - lo)
    z[v == 0] = np.nan
    b = cm["bounds"]
    k = MARS_R_M * math.pi / 180.0
    bounds = rasterio.coords.BoundingBox((b["west_lon_deg"] - LON0) * k, b["south_lat_deg"] * k,
                                         (b["east_lon_deg"] - LON0) * k, b["north_lat_deg"] * k)
    ortho = imread(OUT / "ortho-preview.png")
    if ortho.ndim == 3:
        ortho = ortho[..., 0]
    return z, cm["cell_size_m"], bounds, ortho


def fill_nan(z):
    if np.isfinite(z).all():
        return z
    # nearest valid neighbour, not the global mean (a mean fill makes tall spikes)
    from scipy.ndimage import distance_transform_edt
    idx = distance_transform_edt(~np.isfinite(z), return_distances=False, return_indices=True)
    return z[tuple(idx)]


def resample(a, n):
    return zoom(a, (n / a.shape[0], n / a.shape[1]), order=1)


def hillshade(z, cell, azimuths=(225, 270, 315, 360), weights=(0.15, 0.25, 0.45, 0.15), altitude=40):
    """Multi-directional hillshade (0..1). Light comes mostly from the north-west."""
    dzdy, dzdx = np.gradient(z, cell)
    slope = np.arctan(np.hypot(dzdx, dzdy))
    aspect = np.arctan2(-dzdx, dzdy)
    alt = math.radians(altitude)
    out = np.zeros_like(z)
    for az, w in zip(azimuths, weights):
        a = math.radians(360 - az + 90)
        out += w * (np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(a - aspect))
    return np.clip(out, 0, 1)


def stretch(a, lo=1, hi=99):
    p0, p1 = np.nanpercentile(a, [lo, hi])
    return np.clip((a - p0) / max(p1 - p0, 1e-9), 0, 1)


def encode_height(z):
    zmin, zmax = float(np.nanmin(z)), float(np.nanmax(z))
    v = np.where(np.isfinite(z), (z - zmin) / (zmax - zmin), 0) * 65534 + 1  # 0 = no-data
    v = np.where(np.isfinite(z), v, 0).astype("uint16")
    rgb = np.dstack([v >> 8, v & 255, np.zeros_like(v)]).astype("uint8")
    return rgb, zmin, zmax


def fetch_ortho(bounds, px):
    cache = RAW / f"ortho_crop_{px}.tif"
    if cache.exists():
        with rasterio.open(cache) as ds:
            return ds.read(1)
    with rasterio.open("/vsicurl/" + ORTHO_URL) as ds:
        win = from_bounds(bounds.left, bounds.bottom, bounds.right, bounds.top, ds.transform)
        img = ds.read(1, window=win, out_shape=(px, px), resampling=Resampling.average)
        crs = ds.crs
    transform = rasterio.transform.from_bounds(bounds.left, bounds.bottom, bounds.right, bounds.top, px, px)
    with rasterio.open(cache, "w", driver="GTiff", height=px, width=px, count=1, dtype="uint8",
                       crs=crs, transform=transform, compress="deflate") as dst:
        dst.write(img, 1)
    return img


def mars_tint(gray):
    """Map 0..1 grey to an illustrative Mars palette (two linear segments)."""
    g = gray[..., None]
    low = MARS_DARK + (MARS_MID - MARS_DARK) * np.clip(g * 2, 0, 1)
    high = MARS_MID + (MARS_LIGHT - MARS_MID) * np.clip(g * 2 - 1, 0, 1)
    return np.where(g < 0.5, low, high)


def write_stl(path, z, cell, base_m=20.0, exaggeration=1.0):
    """Closed binary STL: top surface, four walls and a flat base. Units: metres."""
    n_r, n_c = z.shape
    zz = (fill_nan(z) - np.nanmin(z)) * exaggeration + base_m
    xs = np.arange(n_c) * cell
    ys = (n_r - 1 - np.arange(n_r)) * cell  # north up
    X, Y = np.meshgrid(xs, ys)
    tris = []

    top = np.dstack([X, Y, zz])
    a, b = top[:-1, :-1], top[:-1, 1:]
    c, d = top[1:, :-1], top[1:, 1:]
    tris.append(np.stack([a, c, b], -2).reshape(-1, 3, 3))
    tris.append(np.stack([b, c, d], -2).reshape(-1, 3, 3))

    def wall(edge_xy, edge_z, flip):
        p_top = np.column_stack([edge_xy, edge_z])
        p_bot = np.column_stack([edge_xy, np.zeros_like(edge_z)])
        t0, t1, b0, b1 = p_top[:-1], p_top[1:], p_bot[:-1], p_bot[1:]
        w1 = np.stack([t0, b0, t1] if not flip else [t0, t1, b0], 1)
        w2 = np.stack([t1, b0, b1] if not flip else [t1, b1, b0], 1)
        return np.concatenate([w1, w2])

    tris.append(wall(np.column_stack([X[0], Y[0]]), zz[0], False))          # north
    tris.append(wall(np.column_stack([X[-1], Y[-1]]), zz[-1], True))        # south
    tris.append(wall(np.column_stack([X[:, 0], Y[:, 0]]), zz[:, 0], True))  # west
    tris.append(wall(np.column_stack([X[:, -1], Y[:, -1]]), zz[:, -1], False))  # east

    # Base: fan from the centre to every bottom perimeter vertex, so it shares the
    # walls' bottom edges exactly (no T-junctions). Perimeter is clockwise from above.
    per = np.concatenate([
        np.column_stack([X[0], Y[0]]),                # north, west -> east
        np.column_stack([X[1:, -1], Y[1:, -1]]),      # east, north -> south
        np.column_stack([X[-1, -2::-1], Y[-1, -2::-1]]),  # south, east -> west
        np.column_stack([X[-2:0:-1, 0], Y[-2:0:-1, 0]]),  # west, south -> north
    ])
    per = np.column_stack([per, np.zeros(len(per))])
    nxt = np.roll(per, -1, axis=0)
    centre = np.array([xs[-1] / 2, ys[0] / 2, 0.0])
    tris.append(np.stack([np.broadcast_to(centre, per.shape), per, nxt], 1))

    # Orient every part outwards: top up, base down, walls away from the centre.
    centre_xy = np.array([xs[-1] / 2, ys[0] / 2])
    out_dirs = []
    for i, part in enumerate(tris):
        n = np.cross(part[:, 1] - part[:, 0], part[:, 2] - part[:, 0])
        if i < 2:  # top surface
            want = n[:, 2] > 0
        elif i == len(tris) - 1:  # base
            want = n[:, 2] < 0
        else:  # walls
            c = part.mean(axis=1)[:, :2] - centre_xy
            want = (n[:, :2] * c).sum(axis=1) > 0
        tris[i] = np.where(want[:, None, None], part, part[:, [0, 2, 1]])
    t = np.concatenate(tris).astype("float32")
    nrm = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-12
    rec = np.zeros(len(t), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    rec["n"], rec["v"] = nrm, t
    with open(path, "wb") as f:
        f.write(b"Martian Mappers relief, HiRISE DTEEC_019698, metres".ljust(80, b" "))
        f.write(struct.pack("<I", len(t)))
        rec.tofile(f)
    return len(t)


def render_voxel(path, z, cell, tex, exaggeration, width=1600, height=1000, sky=(13, 13, 16)):
    """Oblique 3D view by front-to-back column rendering (no extra libraries).

    The camera looks north from beyond the south edge, raised above the terrain.
    """
    n = z.shape[0]
    zz = (fill_nan(z) - np.nanmin(z)) * exaggeration / cell  # height in grid cells
    tex = np.asarray(tex)
    tn = tex.shape[0]  # sample the full-resolution texture, not one texel per height cell
    grad = np.linspace(0, 1, height)[:, None]
    top_sky, low_sky = np.array([8, 9, 14], float), np.array([96, 62, 44], float)  # dusty Mars horizon
    img = (top_sky + (low_sky - top_sky) * grad ** 1.6)[:, None, :].repeat(width, 1).astype("uint8")
    sky = low_sky
    ybuf = np.full(width, height, dtype=int)
    cam_x, cam_y, cam_h = n / 2, n * 1.18, zz.max() + n * 0.42
    horizon, scale = -height * 0.05, height * 0.95
    sx = np.arange(width)
    for depth in np.arange(n * 0.2, n * 1.18 + 1, 0.4):
        half_w = depth * 0.55
        px = cam_x - half_w + sx / width * 2 * half_w
        py = cam_y - depth
        if py < 0 or py >= n:
            continue
        ix = np.clip(px.astype(int), 0, n - 1)
        iy = int(py)
        inside = (px >= 0) & (px < n)
        h = zz[iy, ix]
        scr = ((cam_h - h) / depth * scale + horizon).astype(int)
        scr = np.clip(scr, 0, height)
        fog = min(1.0, max(0.0, (depth - n * 0.2) / (n * 1.0))) ** 1.5
        tx = np.clip((px / n * tn).astype(int), 0, tn - 1)
        ty = min(tn - 1, int(py / n * tn))
        c = tex[ty, tx].astype(float) * (1 - 0.35 * fog) + np.array(sky) * 0.35 * fog
        for x in np.nonzero(inside & (scr < ybuf))[0]:
            img[scr[x]:ybuf[x], x] = c[x]
            ybuf[x] = scr[x]
    imsave(path, img, check_contrast=False)
    return True


def render_preview(path, z, cell, tex, exaggeration):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from matplotlib.colors import LightSource  # noqa: F401
    except ImportError:
        return render_voxel(path, z, cell, tex, exaggeration)
    n = z.shape[0]
    zz = (fill_nan(z) - np.nanmin(z)) * exaggeration
    X, Y = np.meshgrid(np.arange(n) * cell, (n - 1 - np.arange(n)) * cell)
    face = resample_rgb(tex, n) / 255.0
    fig = plt.figure(figsize=(12, 9), dpi=150, facecolor="#0d0d10")
    ax = fig.add_subplot(111, projection="3d", facecolor="#0d0d10")
    ax.plot_surface(X / 1000, Y / 1000, zz, facecolors=face, rstride=1, cstride=1,
                    linewidth=0, antialiased=False, shade=False)
    ax.set_box_aspect((1, 1, max(0.12, zz.max() / (n * cell) * 1.0)))
    ax.view_init(elev=32, azim=-120)
    ax.set_axis_off()
    fig.text(0.02, 0.02,
             f"HiRISE {DTM_ID} + {ORTHO_ID}, Gale crater / Mount Sharp. "
             f"Vertical exaggeration x{exaggeration:g}. Mars tint is illustrative.",
             color="#bbbbbb", fontsize=9)
    fig.savefig(path, bbox_inches="tight", pad_inches=0.1, facecolor=fig.get_facecolor())
    plt.close(fig)
    return True


def resample_rgb(img, n):
    return np.dstack([resample(img[..., i].astype(float), n) for i in range(3)]).clip(0, 255)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--height-px", type=int, default=1024)
    ap.add_argument("--tex-px", type=int, default=4096)
    ap.add_argument("--stl-px", type=int, default=256)
    ap.add_argument("--exaggeration", type=float, default=1.0)
    ap.add_argument("--skip-ortho", action="store_true")
    ap.add_argument("--from-preview", action="store_true",
                    help="offline: build from height-preview.png (5 m) and ortho-preview.png instead of the 1 m DTM")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    preview_ortho = None
    if a.from_preview:
        z, res, bounds, preview_ortho = load_from_preview()
        a.height_px = z.shape[0]  # no point upsampling the 5 m grid
        a.tex_px = min(a.tex_px, 2048)
    else:
        z, res, bounds, _ = load_dtm()
    zs = gaussian_filter(fill_nan(z), sigma=0.8)  # light smoothing of stereo noise
    zs[~np.isfinite(z)] = np.nan
    size_m = z.shape[0] * res

    # 1. high-res height for the 3D view
    zh = resample(fill_nan(zs), a.height_px)
    rgb, zmin, zmax = encode_height(zh)
    if not a.from_preview:  # in offline mode height-preview.png already is the best height we have
        imsave(OUT / "height-hi.png", rgb, check_contrast=False)

    # 2. hillshade at native 1 m, then 2048 px
    hs = hillshade(fill_nan(zs), res)
    hs_px = min(2048, a.tex_px)
    hs_img = resample(hs, hs_px)
    imsave(OUT / "hillshade.png", (hs_img * 255).astype("uint8"), check_contrast=False)

    # 3. textures
    tex_rgb = None
    if not a.skip_ortho:
        ortho = (resample(preview_ortho.astype(float), a.tex_px) if preview_ortho is not None
                 else fetch_ortho(bounds, a.tex_px).astype(float))
        og = stretch(ortho, 0.5, 99.5)
        imsave(OUT / "texture-ortho.jpg", (og * 255).astype("uint8"), check_contrast=False, quality=90)
        hs_t = resample(hs, a.tex_px)
        shade = 0.55 + 0.45 * hs_t  # keep the ortho readable, add relief
        relief_grey = np.clip(og * shade * 1.1, 0, 1)
        tex_rgb = mars_tint(relief_grey).clip(0, 255).astype("uint8")
        imsave(OUT / "texture-relief.jpg", tex_rgb, check_contrast=False, quality=90)
    else:
        tex_rgb = mars_tint(hs_img).clip(0, 255).astype("uint8")

    # 4. printable relief model
    zst = resample(fill_nan(zs), a.stl_px)
    n_tri = write_stl(OUT / "relief.stl", zst, size_m / a.stl_px, exaggeration=a.exaggeration)

    # 5. preview render
    zp = resample(fill_nan(zs), 400)
    rendered = render_preview(OUT / "relief-preview.png", zp, size_m / 400, tex_rgb, max(a.exaggeration, 1.5))

    w_lon, n_lat = xy_to_lonlat(bounds.left, bounds.top)
    e_lon, s_lat = xy_to_lonlat(bounds.right, bounds.bottom)
    manifest = {
        "contract": "martian-mappers.relief.v1",
        "status": "example-stop crop, not a locked route (PRE-07 still open)",
        "bounds": {"west_lon_deg": round(w_lon, 6), "south_lat_deg": round(s_lat, 6),
                   "east_lon_deg": round(e_lon, 6), "north_lat_deg": round(n_lat, 6)},
        "size_m": round(size_m, 1),
        "input_mode": "offline: 5 m height-preview.png + 1000 px ortho-preview.png" if a.from_preview else "1 m DTM crop + HiRISE ortho",
        "height_hi": None if a.from_preview else {
            "relpath": "data/processed/terrain/height-hi.png",
            "grid_px": a.height_px,
            "cell_size_m": round(size_m / a.height_px, 3),
            "elevation_range_m": [round(zmin, 2), round(zmax, 2)],
            "encoding": "8-bit RGB PNG: value = R*256 + G; value 0 = no-data; elevation_m = min + (value-1)/65534*(max-min)",
            "smoothing": "Gaussian sigma 0.8 px on the 1 m DTM before resampling (stereo noise)",
        },
        "hillshade": {"relpath": "data/processed/terrain/hillshade.png", "grid_px": hs_px,
                      "method": "multi-directional (225/270/315/360 deg), sun altitude 40 deg"},
        "textures": {
            "ortho": None if a.skip_ortho else {"relpath": "data/processed/terrain/texture-ortho.jpg", "grid_px": a.tex_px,
                                                "cell_size_m": round(size_m / a.tex_px, 3), "note": "HiRISE RED greyscale, 0.5-99.5 percentile stretch"},
            "relief": None if a.skip_ortho else {"relpath": "data/processed/terrain/texture-relief.jpg", "grid_px": a.tex_px,
                                                 "note": "ortho x hillshade with an illustrative Mars colour map; not measured colour"},
        },
        "stl": {"relpath": "data/processed/terrain/relief.stl", "grid_px": a.stl_px, "triangles": n_tri,
                "units": "metres; x east, y north, z = elevation - min + 20 m base",
                "vertical_exaggeration": a.exaggeration},
        "preview_png_relpath": "data/processed/terrain/relief-preview.png" if rendered else None,
        "sources": [
            {"name": "HiRISE DTM (MRO), PDS", "product_id": DTM_ID, "url": DTM_URL, "fetch_date": FETCH_DATE,
             "used_for": "height, hillshade, STL"},
            {"name": "HiRISE orthoimage (MRO), PDS", "product_id": ORTHO_ID, "url": ORTHO_URL, "fetch_date": FETCH_DATE,
             "used_for": "textures"},
        ],
        "notes": [
            "Same window as data/processed/terrain/cost-map.json. The 5 m cost grid is unchanged; these files are visual only.",
            "The Mars tint is illustrative. HiRISE RED is greyscale.",
            "Slope limits and route logic still use cost-map.json, not these files.",
        ],
    }
    (OUT / "relief.json").write_text(json.dumps(manifest, indent=2) + "\n")
    for f in ("height-hi.png", "hillshade.png", "texture-ortho.jpg", "texture-relief.jpg", "relief.stl", "relief-preview.png"):
        p = OUT / f
        if p.exists():
            print(f"{f:20s} {p.stat().st_size / 1e6:6.2f} MB")
    print("triangles", n_tri, "elev", round(zmin, 1), round(zmax, 1), "preview", rendered)


if __name__ == "__main__":
    main()
