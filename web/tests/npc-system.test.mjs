import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as THREE from "../vendor/three.module.js";
import {
  MARS_STATION_NPCS,
  CORRIDOR_SCREEN_NPC_SPECS,
  getNpcSpecById,
  answerNpcQuestion,
  queryNpcWithHook,
  registerNpcAiHook,
} from "../hud/npc-knowledge.js";
import {
  createNpcManager,
  spawnCorridorScreenNPCs,
  computeSpotInFrontOfVehicle,
} from "../hud/npc-system.js";
import {
  GARAGE_DRIVABLE_VEHICLES,
  getGarageVehicleSpec,
  createExperimentalRover,
} from "../hud/experimental-rover.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, "..");

test("NPC roster covers all 7 Green Zone vehicles with bilingual fields and preset questions", () => {
  assert.equal(MARS_STATION_NPCS.length, 7);
  const expectedVehicles = [
    "mmsev",
    "mars_robo_concept",
    "sojourner",
    "spirit",
    "opportunity",
    "curiosity",
    "perseverance",
  ];
  assert.deepEqual(
    MARS_STATION_NPCS.map((n) => n.vehicleId),
    expectedVehicles
  );

  for (let i = 0; i < MARS_STATION_NPCS.length; i++) {
    const npc = MARS_STATION_NPCS[i];
    assert.equal(npc.npcNumber, i + 1);
    assert.ok(npc.name && typeof npc.name === "string");
    assert.ok(npc.tagText && typeof npc.tagText === "string");
    assert.ok(npc.role?.en && npc.role?.tr, `NPC ${npc.id} must have EN & TR roles`);
    assert.ok(npc.vehicleName?.en && npc.vehicleName?.tr, `NPC ${npc.id} must have EN & TR vehicle names`);
    assert.ok(npc.greeting?.en && npc.greeting?.tr, `NPC ${npc.id} must have EN & TR greetings`);
    assert.ok(Array.isArray(npc.presets) && npc.presets.length >= 3, `NPC ${npc.id} needs >= 3 preset topics`);
    for (const preset of npc.presets) {
      assert.ok(preset.label?.en && preset.label?.tr);
      assert.ok(preset.question?.en && preset.question?.tr);
      assert.ok(preset.answer?.en && preset.answer?.tr);
    }
    assert.equal(getNpcSpecById(npc.id), npc);
  }

  assert.equal(GARAGE_DRIVABLE_VEHICLES.length, 2);
  assert.equal(getGarageVehicleSpec("mmsev").id, "mmsev");
  assert.equal(getGarageVehicleSpec("mars_robo_concept").id, "mars_robo_concept");
});

test("Corridor info screen NPC placeholder exists and remains disabled by default", () => {
  assert.ok(Array.isArray(CORRIDOR_SCREEN_NPC_SPECS) && CORRIDOR_SCREEN_NPC_SPECS.length >= 2);
  const scene = new THREE.Scene();

  const disabledRes = spawnCorridorScreenNPCs({ scene });
  assert.equal(disabledRes.spawned, false);
  assert.equal(disabledRes.count, 0);
  assert.deepEqual(disabledRes.npcs, []);
  assert.equal(scene.children.length, 0, "Disabled corridor placeholder must not add objects to scene");

  const enabledPreview = spawnCorridorScreenNPCs({ scene, forceEnable: true });
  assert.equal(enabledPreview.spawned, true);
  assert.equal(enabledPreview.count, CORRIDOR_SCREEN_NPC_SPECS.length);

  const hudSrc = fs.readFileSync(path.join(WEB_DIR, "hud/hud3d.js"), "utf8");
  assert.match(
    hudSrc,
    /\/\/\s*npcManager\.spawnCorridorScreenNPCs\(/,
    "hud3d.js must keep spawnCorridorScreenNPCs commented out until Pink Zone screens exist"
  );
});

test("Static Anchor Rule: drivable bay NPCs 1 & 2 are unparented from vehicles and never move when rovers drive away", () => {
  const scene = new THREE.Scene();
  const sampleFlatY = (x, z) => 1.5 + Math.sin(x * 0.01) * 0.1 + Math.cos(z * 0.01) * 0.1;

  const mmsev = createExperimentalRover(THREE, "mmsev");
  const concept = createExperimentalRover(THREE, "mars_robo_concept");
  scene.add(mmsev.group);
  scene.add(concept.group);

  const mmsevSpot = { x: -4.0, z: -12.0, yaw: Math.PI };
  const conceptSpot = { x: 4.0, z: -12.0, yaw: Math.PI };
  mmsev.placeAt(mmsevSpot.x, mmsevSpot.z, mmsevSpot.yaw, sampleFlatY);
  concept.placeAt(conceptSpot.x, conceptSpot.z, conceptSpot.yaw, sampleFlatY);

  const npcManager = createNpcManager(THREE, scene, { sampleElevY: sampleFlatY });
  assert.equal(npcManager.getAllNpcs().length, 7);

  const npc1 = npcManager.anchorDrivableVehicleNpc("mmsev", mmsevSpot.x, mmsevSpot.z, mmsevSpot.yaw, {
    standoffM: 3.7,
    sideOffsetM: 0.75,
    resetAnchor: true,
  });
  const npc2 = npcManager.anchorDrivableVehicleNpc("mars_robo_concept", conceptSpot.x, conceptSpot.z, conceptSpot.yaw, {
    standoffM: 3.7,
    sideOffsetM: -0.75,
    resetAnchor: true,
  });

  assert.ok(npc1 && npc2);
  assert.equal(npc1.group.parent, npcManager.npcGroup);
  assert.equal(npc2.group.parent, npcManager.npcGroup);
  assert.equal(npcManager.npcGroup.parent, scene);

  // Ensure neither NPC group lives anywhere inside vehicle scene subtrees
  let foundInMmsev = false;
  mmsev.group.traverse((o) => {
    if (o === npc1.group || o === npc2.group) foundInMmsev = true;
  });
  let foundInConcept = false;
  concept.group.traverse((o) => {
    if (o === npc1.group || o === npc2.group) foundInConcept = true;
  });
  assert.equal(foundInMmsev, false);
  assert.equal(foundInConcept, false);

  const expected1 = computeSpotInFrontOfVehicle(mmsevSpot.x, mmsevSpot.z, mmsevSpot.yaw, 3.7, 0.75);
  const expected2 = computeSpotInFrontOfVehicle(conceptSpot.x, conceptSpot.z, conceptSpot.yaw, 3.7, -0.75);
  assert.ok(Math.abs(npc1.group.position.x - expected1.x) < 1e-6);
  assert.ok(Math.abs(npc1.group.position.z - expected1.z) < 1e-6);
  assert.ok(Math.abs(npc2.group.position.x - expected2.x) < 1e-6);
  assert.ok(Math.abs(npc2.group.position.z - expected2.z) < 1e-6);

  // Drive both vehicles far away and simulate elapsed frames
  mmsev.placeAt(120, -140, 0.9, sampleFlatY);
  concept.placeAt(-95, 110, -1.2, sampleFlatY);
  // Attempting to re-anchor without resetAnchor=true must also preserve locked coordinates
  npcManager.anchorDrivableVehicleNpc("mmsev", 120, -140, 0.9, { resetAnchor: false });
  npcManager.anchorDrivableVehicleNpc("mars_robo_concept", -95, 110, -1.2, { resetAnchor: false });

  for (let i = 0; i < 15; i++) {
    npcManager.update(0.05, { x: 120, z: -140 }, i * 0.05, { terrainSampler: sampleFlatY });
  }

  assert.equal(npc1.group.position.x, expected1.x);
  assert.equal(npc1.group.position.z, expected1.z);
  assert.equal(npc2.group.position.x, expected2.x);
  assert.equal(npc2.group.position.z, expected2.z);
});

test("NPC smoothly turns toward nearby or spoken player and blocks cylinder collision", () => {
  const scene = new THREE.Scene();
  const mgr = createNpcManager(THREE, scene, { sampleElevY: () => 0 });
  const npc = mgr.anchorDrivableVehicleNpc("mmsev", 0, -10, Math.PI, { resetAnchor: true });
  assert.ok(npc);

  const playerPos = { x: npc.x + 2.5, z: npc.z };
  for (let i = 0; i < 45; i++) {
    mgr.update(0.05, playerPos, i * 0.05, { activeNpcId: npc.id });
  }

  // Suit local forward is -Z -> world forward vector = (-sin(yaw), -cos(yaw))
  const fwdX = -Math.sin(npc.group.rotation.y);
  const fwdZ = -Math.cos(npc.group.rotation.y);
  const toPlayerX = (playerPos.x - npc.x) / 2.5;
  const toPlayerZ = (playerPos.z - npc.z) / 2.5;
  const alignment = fwdX * toPlayerX + fwdZ * toPlayerZ;
  assert.ok(alignment > 0.98, `Expected NPC to face player (dot=${alignment.toFixed(3)})`);

  const col = mgr.resolveCollision(npc.x + 0.12, npc.z, 0.42, 0);
  assert.equal(col.hit, true);
  assert.ok(Math.hypot(col.x - npc.x, col.z - npc.z) >= 0.89);
});

test("Smart Q&A engine answers rover-specific and Mars science custom questions in EN & TR and supports external hook", async () => {
  // Vehicle specialists
  const cases = [
    ["npc_active_rover", "how do I drive and control this rover?", /MMSEV|W\/S|throttle/i],
    ["npc_robo_concept", "tell me about its nitinol wheels and suspension", /Nitinol|mesh|autonomous/i],
    ["npc_sojourner", "what happened on Pathfinder in 1997?", /1997|Pathfinder|microwave/i],
    ["npc_spirit", "where did MER-A land and find water?", /Gusev|Columbia|silica|water/i],
    ["npc_opportunity", "tell me about hematite blueberries and marathon duration", /Meridiani|blueberries|15 years|marathon/i],
    ["npc_curiosity", "how is it powered and what did Gale Crater reveal?", /RTG|plutonium|Gale|Mount Sharp/i],
    ["npc_perseverance", "tell me about sample tubes and Ingenuity helicopter", /Jezero|Ingenuity|sample/i],
  ];
  for (const [npcId, q, regex] of cases) {
    const res = answerNpcQuestion(npcId, q, { lang: "en" });
    assert.match(res.answer, regex, `Failed vehicle intent for ${npcId}`);
    assert.ok(res.sourceNote && res.topic);
  }

  // General Mars science in EN & TR
  const atmoEn = answerNpcQuestion("npc_perseverance", "What is Mars atmosphere like?", { lang: "en" });
  assert.match(atmoEn.answer, /CO₂|95%|millibars/i);

  const gravTr = answerNpcQuestion("npc_active_rover", "Mars yerçekimi ne kadar?", { lang: "tr" });
  assert.match(gravTr.answer, /3[.,]717|m\/s²/);

  const radEn = answerNpcQuestion("npc_curiosity", "How dangerous is radiation exposure at Gale Crater?", { lang: "en" });
  assert.match(radEn.answer, /0\.64|mSv\/day|Hassler/i);

  const stormEn = answerNpcQuestion("npc_opportunity", "Tell me about planet-encircling dust storms", { lang: "en" });
  assert.match(stormEn.answer, /2018|solar|dust/i);

  // Modular AI hook override & reset
  registerNpcAiHook(async ({ npc, question }) => ({
    answer: `[HOOK:${npc.id}] ${question}`,
    sourceNote: "Custom LLM Stub",
    topic: "external_hook",
  }));
  const hooked = await queryNpcWithHook("npc_curiosity", "Hello Mars?", { lang: "en" });
  assert.equal(hooked.answer, "[HOOK:npc_curiosity] Hello Mars?");
  assert.equal(hooked.topic, "external_hook");
  registerNpcAiHook(null);

  const unhooked = await queryNpcWithHook("npc_curiosity", "What is Mars atmosphere made of?", { lang: "en" });
  assert.match(unhooked.answer, /CO₂|carbon dioxide/i);
});

test("HUD dialogue modal DOM markup and overlay modal pause guards exist", () => {
  const html = fs.readFileSync(path.join(WEB_DIR, "index.html"), "utf8");
  for (const id of [
    "npc-dialogue-modal",
    "npc-dlg-messages",
    "npc-dlg-presets",
    "npc-dlg-form",
    "npc-dlg-input",
    "npc-dlg-send",
    "npc-dlg-close",
  ]) {
    assert.ok(html.includes(`id="${id}"`), `index.html missing #${id}`);
  }

  const css = fs.readFileSync(path.join(WEB_DIR, "styles.css"), "utf8");
  assert.match(
    css,
    /body\.landing-active \.rover-dash\s*\{\s*visibility:\s*hidden;\s*\}\s*(?:\/\*[\s\S]*?\*\/\s*)?\.npc-dialogue-backdrop\s*\{/,
    "Expected body.landing-active .rover-dash rule to close properly before .npc-dialogue-backdrop"
  );

  const hudSrc = fs.readFileSync(path.join(WEB_DIR, "hud", "hud3d.js"), "utf8");
  assert.doesNotMatch(hudSrc, /\bs\.roleTr\b/, "hud3d.js should read s.role?.tr instead of undefined s.roleTr");
  assert.match(hudSrc, /nearNpcHit\?\.npc/, "hud3d.js should unwrap getNearestInteractableNpc().npc");
  assert.match(hudSrc, /MAX_NPC_INTERACT_DIST_M\s*=\s*4\.8/, "hud3d.js should enforce close-range NPC interaction limit");
  assert.match(hudSrc, /MAX_ROVER_INTERACT_DIST_M\s*=\s*6\.5/, "hud3d.js should enforce close-range rover interaction limit");
  assert.match(hudSrc, /uDlssEnabled/, "hud3d.js should wire DLSS reconstruction shader uniforms");
  assert.match(hudSrc, /landing\.warmup\?\.\(renderer,\s*camera\)/, "hud3d.js should precompile lander shaders before veil lifts");
  assert.match(hudSrc, /if\s*\(landing\.active\)\s*\{\s*followEndless\(freePos\);/, "hud3d.js should skip 1m chunk rebuilds while landing cinematic plays");

  const landingSrc = fs.readFileSync(path.join(WEB_DIR, "hud", "landing-sequence.js"), "utf8");
  assert.match(landingSrc, /function warmup\(renderer, camera\)/, "landing-sequence.js should provide shader/texture warmup()");
  assert.match(landingSrc, /s\.dustAcc\s*=\s*Math\.min\(/, "landing-sequence.js should cap per-frame dust bursts with clamped stepDt");
});

test("NPC overhead nameplate supports live speech text updates and EN/TR language switching", () => {
  const scene = new THREE.Scene();
  const mgr = createNpcManager(THREE, scene, { sampleElevY: () => 0 });
  const ok = mgr.setNpcSpeech("npc_curiosity", "Gale Krateri çamurtaşlarında organik molekül kanıtları var.", "tr");
  assert.equal(ok, true);
  assert.equal(mgr.getNpc("npc_curiosity").speechText, "Gale Krateri çamurtaşlarında organik molekül kanıtları var.");
  mgr.setLanguage("en");
  assert.equal(mgr.getNpc("npc_curiosity").speechText, "");
});

test("NPC Q&A interaction is blocked beyond close-range walking distance", () => {
  const scene = new THREE.Scene();
  const mgr = createNpcManager(THREE, scene, { sampleElevY: () => 0 });
  const npc = mgr.anchorDrivableVehicleNpc("mmsev", 0, -10, Math.PI, { resetAnchor: true });
  assert.ok(npc);

  // Proximity check must ignore NPCs farther than maxDist
  assert.equal(mgr.getNearestInteractableNpc(npc.x + 12, npc.z, 4.6), null);
  assert.equal(mgr.getNearestInteractableNpc(npc.x + 2.5, npc.z, 4.6)?.npc, npc);

  // Raycast picker must reject far hits when maxDist is bounded
  const ray = new THREE.Raycaster(new THREE.Vector3(npc.x, 1.5, npc.z + 20), new THREE.Vector3(0, 0, -1));
  assert.equal(mgr.pickNpc(ray, 6.0), null);

  const hudSrc = fs.readFileSync(path.join(WEB_DIR, "hud", "hud3d.js"), "utf8");
  const distMatch = hudSrc.match(/const\s+NPC_TALK_MAX_DIST_M\s*=\s*(\d+(?:\.\d+)?)/);
  assert.ok(distMatch && Number(distMatch[1]) <= 6, "NPC_TALK_MAX_DIST_M must enforce close-range interaction");
  assert.doesNotMatch(hudSrc, /npcManager\.pickNpc\(raycaster,\s*38\)/);
});

test("NPC nameplate is compact name-only, and E key only interacts with rovers while crew/screens use mouse click", () => {
  const scene = new THREE.Scene();
  const mgr = createNpcManager(THREE, scene, { sampleElevY: () => 0 });
  for (const npc of mgr.getAllNpcs()) {
    const sp = npc.nameplate?.sprite;
    assert.ok(sp, `Missing nameplate sprite for ${npc.id}`);
    assert.ok(sp.scale.x <= 1.6 && sp.scale.y <= 0.35, `Expected compact name-only sprite for ${npc.id}`);
    assert.equal(sp.userData.npcId, npc.id);
  }

  const npcSrc = fs.readFileSync(path.join(WEB_DIR, "hud", "npc-system.js"), "utf8");
  assert.doesNotMatch(npcSrc, /\[E\] TALK|\[E\] KONUŞ/);

  const hudSrc = fs.readFileSync(path.join(WEB_DIR, "hud", "hud3d.js"), "utf8");
  const eBlockMatch = hudSrc.match(/if \(k === "e" && !e\.repeat\) \{[\s\S]*?\r?\n    \}\r?\n\r?\n    keys\.add\(k\);/);
  assert.ok(eBlockMatch, "Expected k === 'e' handler block in hud3d.js");
  const eBlock = eBlockMatch[0];
  assert.doesNotMatch(eBlock, /openNpcDialogueSafe/, "[E] must not open NPC dialogue");
  assert.doesNotMatch(eBlock, /tryTransitInteract/, "[E] must not trigger screens/terminals");
  assert.doesNotMatch(eBlock, /openRoverInfoSafe/, "[E] must not open rover info screen");
  assert.match(hudSrc, /pickInteractiveScreen\(cx, cy\)/, "pointerdown must pick interactive screens");
  assert.match(hudSrc, /activateScreenTarget\(hitScreen\)/, "pointerdown must activate clicked screens");

  const habSrc = fs.readFileSync(path.join(WEB_DIR, "hud", "mars-habitat.js"), "utf8");
  assert.match(habSrc, /getInteractiveGroup:\s*\(\)\s*=>\s*interactiveGroup/);
  assert.doesNotMatch(habSrc, /\[E\] SITE SELECTOR/);
});
