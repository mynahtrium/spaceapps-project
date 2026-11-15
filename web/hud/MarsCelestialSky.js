/**
 * Local star field (~3,000 real Yale BSC / HYG bright stars) plus Earth and the Moon, placed from MarsEphemeris.
 * Stars fade when the Sun is above about +3°. Positions use the observer's latitude/longitude
 * and the IAU Mars rotation for `sunState.date`, so they are consistent with the Sun.
 */

import {
  BRIGHT_STARS,
  altAzToScene,
  bodyFixedToHorizon,
  earthFromGale,
  marsEquatorialRad,
  marsRaDecToBodyFixed,
} from "./MarsEphemeris.js";

const DEG = Math.PI / 180;
const R = 11800;

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Approximate blackbody RGB tint from B-V color index. */
function bvToRgb(bv = 0.4) {
  const c = Math.max(-0.4, Math.min(2.0, Number.isFinite(bv) ? bv : 0.4));
  let r = 1.0;
  let g = 0.96;
  let b = 0.88;
  if (c < 0.0) {
    r = 0.78 + 0.55 * (c + 0.4);
    g = 0.86 + 0.35 * (c + 0.4);
    b = 1.0;
  } else if (c < 0.5) {
    r = 0.96 + 0.08 * (c / 0.5);
    g = 0.96;
    b = 1.0 - 0.16 * (c / 0.5);
  } else {
    const t = Math.min(1, (c - 0.5) / 1.5);
    r = 1.0;
    g = 0.96 - 0.24 * t;
    b = 0.84 - 0.38 * t;
  }
  return [r, g, b];
}

export function createCelestialSky(THREE) {
  const starCount = BRIGHT_STARS.length;
  const starPos = new Float32Array(starCount * 3);
  const starCol = new Float32Array(starCount * 3);
  const marsStars = BRIGHT_STARS.map(([ra, dec, mag, bv = 0.4], i) => {
    const eq = marsEquatorialRad(ra, dec);
    const bright = Math.min(1, 0.14 + 0.92 * Math.pow(10, -0.32 * Math.max(-1.5, mag)));
    const [cr, cg, cb] = bvToRgb(bv);
    starCol[i * 3] = bright * cr;
    starCol[i * 3 + 1] = bright * cg;
    starCol[i * 3 + 2] = bright * cb;
    return { ra: eq.ra, dec: eq.dec, mag, bv };
  });

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(starPos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(starCol, 3));
  const mat = new THREE.PointsMaterial({
    size: 2.0,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const stars = new THREE.Points(geo, mat);
  stars.frustumCulled = false;
  stars.renderOrder = -2;

  function onePoint(color, size) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3), 3));
    const m = new THREE.PointsMaterial({
      color,
      size,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    p.renderOrder = -2;
    return p;
  }

  const earth = onePoint(0xc5dcff, 3.4);
  const moon = onePoint(0xe7e2d8, 2.2);
  const group = new THREE.Group();
  group.add(stars, earth, moon);

  function place(point, dir, radius) {
    const arr = point.geometry.attributes.position.array;
    arr[0] = dir.x * radius;
    arr[1] = dir.y * radius;
    arr[2] = dir.z * radius;
    point.geometry.attributes.position.needsUpdate = true;
  }

  function update(sunState) {
    const fade = smoothstep(3 * DEG, -8 * DEG, sunState.elevationRad);
    mat.opacity = fade;
    earth.material.opacity = fade;
    moon.material.opacity = fade;
    stars.visible = fade > 0.02;
    earth.visible = stars.visible;
    moon.visible = stars.visible;
    if (!stars.visible) return;

    const date = sunState.date || new Date();
    const lat = sunState.latDeg ?? -4.8;
    const lon = sunState.lonEastDeg ?? 137.4;
    for (let i = 0; i < marsStars.length; i++) {
      const s = marsStars[i];
      const d = bodyFixedToHorizon(marsRaDecToBodyFixed(s.ra, s.dec, date), lat, lon);
      starPos[i * 3] = d.x * R;
      starPos[i * 3 + 1] = d.y * R;
      starPos[i * 3 + 2] = d.z * R;
    }
    geo.attributes.position.needsUpdate = true;

    const eh = earthFromGale(date, sunState.lstRad, lat, lon);
    const ed = altAzToScene(eh.el, eh.az);
    place(earth, ed, R - 20);
    // 0.07° Moon beside Earth, visible as a separate point once the visor zooms.
    const md = altAzToScene(eh.el, eh.az + 0.07 * DEG);
    place(moon, md, R - 20);
  }

  return { group, update };
}
