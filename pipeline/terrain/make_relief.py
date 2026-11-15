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
import sys
from pathlib import Path

import numpy as np
from PIL import Image
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds
from scipy.ndimage import gaussian_filter, zoom
import trimesh

_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
from pipeline.contracts import write_validated_json  # noqa: E402
from pipeline.terrain.crop_window import LON0, MARS_R_M, lonlat_to_xy, xy_to_lonlat  # noqa: E402
from pipeline.terrain.terrain_ops import hillshade as _xr_hillshade, save_image  # noqa: E402

ROOT = _ROOT
RAW = ROOT / "data/raw/terrain"
OUT = ROOT / "data/processed/terrain"
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


def load_dtm():
    with rasterio.open(RAW / "dtm_crop_1m.tif") as ds:
        z = ds.read(1).astype("float64")
        z[(z == ds.nodata) | (z < -1e6)] = np.nan
        return z, ds.res[0], ds.bounds, ds.crs


def load_from_preview():
    """Offline fallback: the 5 m height preview and 1000 px ortho preview already in the repo."""
    cm = json.loads((OUT / "cost-map.json").read_text())
    with Image.open(OUT / "height-preview.png") as im:
        rgb = np.asarray(im)
    v = rgb[..., 0].astype(float) * 256 + rgb[..., 1]
    lo, hi = cm["height_preview_elevation_range_m"]
    z = lo + v / 65535.0 * (hi - lo)
    z[v == 0] = np.nan
    b = cm["bounds"]
    left, bottom = lonlat_to_xy(b["west_lon_deg"], b["south_lat_deg"])
    right, top = lonlat_to_xy(b["east_lon_deg"], b["north_lat_deg"])
    bounds = rasterio.coords.BoundingBox(left, bottom, right, top)
    with Image.open(OUT / "ortho-preview.png") as im:
        ortho = np.asarray(im)
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
    """Multi-directional hillshade (0..1) via ``xrspatial.hillshade``. Light comes mostly from the north-west."""
    out = np.zeros_like(z, dtype=np.float64)
    for az, w in zip(azimuths, weights):
        out += float(w) * _xr_hillshade(z, cell, azimuth_deg=float(az), altitude_deg=float(altitude))
    return np.clip(out, 0.0, 1.0)


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
    """Closed watertight binary STL via ``trimesh`` (top surface + four walls + base). Units: metres."""
    n_r, n_c = z.shape
    zz = (fill_nan(z) - np.nanmin(z)) * exaggeration + base_m
    xs = np.arange(n_c, dtype=np.float64) * cell
    ys = (n_r - 1 - np.arange(n_r, dtype=np.float64)) * cell  # north up
    x_grid, y_grid = np.meshgrid(xs, ys)
    top_verts = np.column_stack([x_grid.ravel(), y_grid.ravel(), zz.ravel()])

    row_i = np.arange(n_r - 1)[:, None]
    col_i = np.arange(n_c - 1)[None, :]
    a = (row_i * n_c + col_i).ravel()
    b = a + 1
    c_idx = a + n_c
    d = c_idx + 1
    top_faces = np.concatenate([np.column_stack([a, c_idx, b]), np.column_stack([b, c_idx, d])], axis=0)

    # Clockwise perimeter vertices from above so shared wall/base edges remain watertight.
    per_top = np.concatenate([
        np.arange(n_c),
        np.arange(1, n_r) * n_c + (n_c - 1),
        (n_r - 1) * n_c + np.arange(n_c - 2, -1, -1),
        np.arange(n_r - 2, 0, -1) * n_c,
    ])
    per_len = len(per_top)
    base_off = n_r * n_c
    bot_verts = np.column_stack([top_verts[per_top, 0], top_verts[per_top, 1], np.zeros(per_len)])
    center_idx = base_off + per_len
    center_vert = np.array([[xs[-1] / 2.0, ys[0] / 2.0, 0.0]])

    verts = np.vstack([top_verts, bot_verts, center_vert])
    i = np.arange(per_len)
    j = (i + 1) % per_len
    t0, t1 = per_top[i], per_top[j]
    b0, b1 = base_off + i, base_off + j
    wall_faces = np.concatenate([np.column_stack([t0, t1, b0]), np.column_stack([t1, b1, b0])], axis=0)
    base_faces = np.column_stack([np.full(per_len, center_idx), b0, b1])
    faces = np.vstack([top_faces, wall_faces, base_faces])

    mesh = trimesh.Trimesh(vertices=verts, faces=faces, process=False)
    mesh.metadata["name"] = "Martian Mappers relief, HiRISE DTEEC_019698, metres"
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    mesh.export(path, file_type="stl")
    return len(mesh.faces)


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
    save_image(path, img)
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
        save_image(OUT / "height-hi.png", rgb)

    # 2. hillshade at native 1 m, then 2048 px
    hs = hillshade(fill_nan(zs), res)
    hs_px = min(2048, a.tex_px)
    hs_img = resample(hs, hs_px)
    save_image(OUT / "hillshade.png", (hs_img * 255).astype("uint8"))

    # 3. textures
    tex_rgb = None
    if not a.skip_ortho:
        ortho = (resample(preview_ortho.astype(float), a.tex_px) if preview_ortho is not None
                 else fetch_ortho(bounds, a.tex_px).astype(float))
        og = stretch(ortho, 0.5, 99.5)
        save_image(OUT / "texture-ortho.jpg", (og * 255).astype("uint8"), quality=90)
        hs_t = resample(hs, a.tex_px)
        shade = 0.55 + 0.45 * hs_t  # keep the ortho readable, add relief
        relief_grey = np.clip(og * shade * 1.1, 0, 1)
        tex_rgb = mars_tint(relief_grey).clip(0, 255).astype("uint8")
        save_image(OUT / "texture-relief.jpg", tex_rgb, quality=90)
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
    write_validated_json(OUT / "relief.json", manifest, contract_id="martian-mappers.relief.v1")
    for f in ("height-hi.png", "hillshade.png", "texture-ortho.jpg", "texture-relief.jpg", "relief.stl", "relief-preview.png"):
        p = OUT / f
        if p.exists():
            print(f"{f:20s} {p.stat().st_size / 1e6:6.2f} MB")
    print("triangles", n_tri, "elev", round(zmin, 1), round(zmax, 1), "preview", rendered)


if __name__ == "__main__":
    main()
