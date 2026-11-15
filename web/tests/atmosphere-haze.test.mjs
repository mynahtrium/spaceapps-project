import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../vendor/three.module.js";

import {
  MARS_ATMO_HAZE_FRAG_APPLY,
  MARS_ATMO_HAZE_FRAG_PARS,
  MARS_ATMO_HAZE_VERT_PARS,
  computeHazeDensityFactor,
  createAtmosphericHazeUniforms,
  patchAtmosphericHaze,
  updateAtmosphericHazeUniforms,
} from "../hud/MarsAtmosphereHaze.js";

test("MarsAtmosphereHaze exports GLSL chunks with refractive dispersion and scattering", () => {
  assert.match(MARS_ATMO_HAZE_VERT_PARS, /varying vec3 vAtmoWorldPos;/);
  assert.match(MARS_ATMO_HAZE_FRAG_PARS, /vec3 mmAtmoInscatter\(/);
  assert.match(MARS_ATMO_HAZE_FRAG_PARS, /vec3 mmMarsAtmoHaze\(/);
  assert.match(MARS_ATMO_HAZE_FRAG_PARS, /extCoeff\s*=\s*vec3\(/);
  assert.match(MARS_ATMO_HAZE_FRAG_APPLY, /mmMarsAtmoHaze\(/);
});

test("computeHazeDensityFactor maps calm and gusty REMS fog densities safely", () => {
  assert.equal(computeHazeDensityFactor(0.00042), 1.0);
  const gusty = computeHazeDensityFactor(0.00114);
  assert.ok(gusty > 1.2 && gusty <= 1.65, `expected bounded gusty factor, got ${gusty}`);
  assert.equal(computeHazeDensityFactor(0.00001), 0.75);
  assert.equal(computeHazeDensityFactor(0.05), 1.65);
});

test("createAtmosphericHazeUniforms shares references and updates cleanly", () => {
  const horizon = new THREE.Color(0.62, 0.43, 0.3);
  const zenith = new THREE.Color(0.23, 0.15, 0.12);
  const ground = new THREE.Color(0.3, 0.19, 0.13);
  const sunDir = new THREE.Vector3(0.4, 0.7, -0.5).normalize();

  const u = createAtmosphericHazeUniforms(THREE, {
    horizonColor: horizon,
    zenithColor: zenith,
    groundColor: ground,
    sunDir,
    sunElev: 0.35,
    tau: 0.5,
    baseY: 0,
  });

  assert.equal(u.uAtmoHorizon.value, horizon);
  assert.equal(u.uAtmoZenith.value, zenith);
  assert.equal(u.uAtmoGround.value, ground);
  assert.equal(u.uAtmoSunDir.value, sunDir);

  updateAtmosphericHazeUniforms(u, {
    sunElev: -0.1,
    tau: 1.4,
    fogDensity: 0.00084,
    baseY: -12,
    time: 42.5,
    enabled: false,
  });
  assert.equal(u.uAtmoSunElev.value, -0.1);
  assert.equal(u.uAtmoTau.value, 1.4);
  assert.ok(Math.abs(u.uAtmoDensity.value - 1.28) < 1e-6);
  assert.equal(u.uAtmoBaseY.value, -12);
  assert.equal(u.uAtmoTime.value, 42.5);
  assert.equal(u.uAtmoEnabled.value, 0);
});

test("patchAtmosphericHaze patches a terrain material with curvature", () => {
  const mat = new THREE.MeshStandardMaterial();
  const sunDir = new THREE.Vector3(0.5, 0.6, 0.6).normalize();
  const atmoUniforms = createAtmosphericHazeUniforms(THREE, { sunDir });
  const curvature = {
    uCurvAnchor: { value: new THREE.Vector2() },
    uCurvInv2N: { value: 1e-7 },
    uCurvInv2M: { value: 1e-7 },
  };
  patchAtmosphericHaze(THREE, mat, atmoUniforms, { curvature });
  assert.match(mat.customProgramCacheKey(), /mm-atmo-haze-curv/);
  const mockShader = {
    uniforms: {},
    vertexShader: "#include <common>\nvoid main() {\n#include <project_vertex>\n}",
    fragmentShader: "#include <common>\nvoid main() {\n#include <fog_fragment>\n}",
  };
  mat.onBeforeCompile(mockShader, {});
  assert.match(mockShader.vertexShader, /vAtmoWorldPos = mmAtmoWorld\.xyz;/);
  assert.match(mockShader.vertexShader, /uCurvInv2N/);
  assert.doesNotMatch(mockShader.vertexShader, /#include <project_vertex>/);
  assert.match(mockShader.fragmentShader, /mmMarsAtmoHaze\(/);
  assert.ok(mockShader.uniforms.uCurvAnchor);
});
