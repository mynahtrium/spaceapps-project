import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIONS, BACK_BUTTON, BUTTON_NAMES, CONFIRM_BUTTON, gamepad } from "../shared/gamepad.js";

test("Xbox / XInput default bindings match requested layout", () => {
  const byId = Object.fromEntries(ACTIONS.map((a) => [a.id, a.button]));
  assert.equal(CONFIRM_BUTTON, 0, "Confirm = A (0)");
  assert.equal(BACK_BUTTON, 1, "Back = B (1)");
  assert.equal(byId.confirm, 0, "Seç ve Onayla = A (0)");
  assert.equal(byId.back, 1, "Geri Git = B (1)");
  assert.equal(byId.pin, 2, "Landmark Bırakma = X (2)");
  assert.equal(byId.interact, 3, "Etkileşim (araçlar ve insanlar) = Y (3)");
  assert.equal(byId.jump, 4, "Zıplama = LB (4)");
  assert.equal(byId.run, 5, "Hızlı Koşu = RB (5)");
  assert.equal(byId.brake, 6, "Fren = LT (6)");
  assert.equal(byId.throttle, 7, "Gaz = RT (7)");
  assert.equal(byId.map, 8, "Map = 2 kare / View (8)");
  assert.equal(byId.menu, 9, "ESC Menü = 3 çizgi / Menu (9)");
  assert.equal(byId.lamp, 11, "El feneri / Farlar = R3 (11)");
  assert.equal(BUTTON_NAMES[8], "View (2▢)");
  assert.equal(BUTTON_NAMES[9], "Menu (≡)");
});

test("Left stick moves, Right stick controls camera / map cursor, triggers report analog values", () => {
  gamepad.reset();
  // Simulate an XInput gamepad state
  gamepad.pad = { id: "Xbox 360 Controller (XInput STANDARD GAMEPAD)", index: 0, connected: true, mapping: "standard" };
  gamepad.axes = [0.6, -0.8, 0.5, 0.5];
  gamepad.buttons[7] = 0.85; // RT (Gaz)
  gamepad.buttons[6] = 0.25; // LT (Fren)
  gamepad.buttons[5] = 1; // RB (Hızlı Koşu)
  gamepad.buttons[4] = 1; // LB (Zıplama)
  gamepad.buttons[3] = 1; // Y (Etkileşim)
  gamepad.buttons[2] = 1; // X (Landmark)

  const mv = gamepad.move();
  assert.ok(mv.x > 0.4, "Left stick X moves right");
  assert.ok(mv.y > 0.6, "Left stick -Y moves forward (+y)");

  const rs = gamepad.rightStick();
  assert.ok(rs.x > 0.3 && rs.y > 0.3, "Right stick returns radial deadzone-filtered cursor input");

  const lk = gamepad.look();
  assert.ok(Math.abs(lk.x) > 0.3 && Math.abs(lk.y) > 0.3, "Right stick look returns x and y");

  assert.equal(gamepad.analog("throttle"), 0.85, "RT analog throttle");
  assert.equal(gamepad.analog("brake"), 0.25, "LT analog brake");
  assert.equal(gamepad.isDown("run"), true, "RB fast run held");
  assert.equal(gamepad.isDown("jump"), true, "LB jump held");
  assert.equal(gamepad.isDown("interact"), true, "Y interact held");
  assert.equal(gamepad.isDown("pin"), true, "X landmark held");
});

test("SDL non-standard GUID normalization remaps DualSense/DS4, Switch Pro, and DirectInput pads to W3C standard indices", () => {
  gamepad.reset();

  // Simulate non-standard Sony DualSense on Firefox/Linux (raw DirectInput/HID layout: 0=Square, 1=Cross, 2=Circle, 3=Triangle)
  const rawDualSense = {
    id: "054c-0ce6-Sony Interactive Entertainment Wireless Controller",
    index: 0,
    connected: true,
    mapping: "",
    buttons: [
      { pressed: false, value: 0 }, // raw 0 = Square (W3C 2)
      { pressed: true, value: 1 },  // raw 1 = Cross / South (W3C 0)
      { pressed: false, value: 0 }, // raw 2 = Circle / East (W3C 1)
      { pressed: true, value: 1 },  // raw 3 = Triangle / North (W3C 3)
      { pressed: true, value: 1 },  // raw 4 = L1 (W3C 4)
      { pressed: false, value: 0 }, // raw 5 = R1 (W3C 5)
      { pressed: false, value: 0 }, // raw 6 = L2 digital
      { pressed: false, value: 0 }, // raw 7 = R2 digital
      { pressed: false, value: 0 }, // raw 8 = Create (W3C 8)
      { pressed: true, value: 1 },  // raw 9 = Options (W3C 9)
      { pressed: false, value: 0 }, // raw 10 = L3 (W3C 10)
      { pressed: false, value: 0 }, // raw 11 = R3 (W3C 11)
    ],
    // Raw axes: 0=LX, 1=LY, 2=RX, 3=L2(-1..1), 4=R2(-1..1), 5=RY
    axes: [0.5, -0.7, 0.25, -0.2, 0.8, 0.4],
  };

  const normDS = gamepad.normalizePad(rawDualSense);
  assert.equal(normDS.buttons[0], 1, "DualSense Cross mapped to W3C button 0 (Confirm)");
  assert.equal(normDS.buttons[2], 0, "DualSense Square mapped to W3C button 2 (Pin)");
  assert.equal(normDS.buttons[3], 1, "DualSense Triangle mapped to W3C button 3 (Interact)");
  assert.equal(normDS.buttons[4], 1, "DualSense L1 mapped to W3C button 4");
  assert.equal(normDS.buttons[9], 1, "DualSense Options mapped to W3C button 9");
  assert.ok(Math.abs(normDS.buttons[6] - 0.4) < 0.05, "DualSense L2 axis -0.2 normalized to 0.4 trigger value");
  assert.ok(Math.abs(normDS.buttons[7] - 0.9) < 0.05, "DualSense R2 axis +0.8 normalized to 0.9 trigger value");
  assert.ok(Math.abs(normDS.axes[2] - 0.25) < 1e-4 && Math.abs(normDS.axes[3] - 0.4) < 1e-4, "DualSense right stick RX/RY normalized to axes 2/3");

  // Simulate non-standard Nintendo Switch Pro Controller (DirectInput: 0=B(South), 1=A(East), 2=Y(West), 3=X(North))
  const rawSwitch = {
    id: "057e-2009-Pro Controller",
    index: 0,
    connected: true,
    mapping: "",
    buttons: [
      { pressed: true, value: 1 },  // 0 = B (South)
      { pressed: false, value: 0 }, // 1 = A (East)
      { pressed: true, value: 1 },  // 2 = Y (West)
      { pressed: false, value: 0 }, // 3 = X (North)
      { pressed: false, value: 0 }, // 4 = L
      { pressed: true, value: 1 },  // 5 = R
      { pressed: false, value: 0 }, // 6 = ZL
      { pressed: true, value: 1 },  // 7 = ZR
    ],
    axes: [-0.6, 0.5, 0.1, -0.3],
  };
  const normSw = gamepad.normalizePad(rawSwitch);
  assert.equal(normSw.buttons[0], 1, "Switch B (South) at W3C button 0");
  assert.equal(normSw.buttons[2], 1, "Switch Y (West) at W3C button 2");
  assert.equal(normSw.buttons[5], 1, "Switch R at W3C button 5");
  assert.equal(normSw.buttons[7], 1, "Switch ZR at W3C button 7");
});

test("Controller family auto-detection and console-accurate glyphFor mapping", () => {
  gamepad.reset();

  gamepad.pad = { id: "DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)", connected: true, mapping: "standard" };
  gamepad.connectedId = gamepad.pad.id;
  assert.equal(gamepad.deviceFamily(), "playstation");
  assert.equal(gamepad.glyphFor("confirm"), "✕");
  assert.equal(gamepad.glyphFor("back"), "○");
  assert.equal(gamepad.glyphFor("pin"), "□");
  assert.equal(gamepad.glyphFor("interact"), "△");
  assert.equal(gamepad.glyphFor("jump"), "L1");
  assert.equal(gamepad.glyphFor("run"), "R1");
  assert.equal(gamepad.glyphFor("brake"), "L2");
  assert.equal(gamepad.glyphFor("throttle"), "R2");
  assert.equal(gamepad.glyphFor("map"), "Create");
  assert.equal(gamepad.glyphFor("menu"), "Options");

  gamepad.pad = { id: "Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)", connected: true, mapping: "standard" };
  gamepad.connectedId = gamepad.pad.id;
  assert.equal(gamepad.deviceFamily(), "switch");
  assert.equal(gamepad.glyphFor("confirm"), "B");
  assert.equal(gamepad.glyphFor("back"), "A");
  assert.equal(gamepad.glyphFor("pin"), "Y");
  assert.equal(gamepad.glyphFor("interact"), "X");
  assert.equal(gamepad.glyphFor("jump"), "L");
  assert.equal(gamepad.glyphFor("run"), "R");
  assert.equal(gamepad.glyphFor("brake"), "ZL");
  assert.equal(gamepad.glyphFor("throttle"), "ZR");

  gamepad.pad = { id: "Xbox Wireless Controller (XInput STANDARD GAMEPAD)", connected: true, mapping: "standard" };
  gamepad.connectedId = gamepad.pad.id;
  assert.equal(gamepad.deviceFamily(), "xbox");
  assert.equal(gamepad.glyphFor("confirm"), "A");
  assert.equal(gamepad.glyphFor("back"), "B");
  assert.equal(gamepad.glyphFor("pin"), "X");
  assert.equal(gamepad.glyphFor("interact"), "Y");
  assert.equal(gamepad.glyphFor("brake"), "LT");
  assert.equal(gamepad.glyphFor("throttle"), "RT");

  // BUTTON_NAMES remains unchanged for legacy XInput consumers
  assert.equal(BUTTON_NAMES[0], "A");
  assert.equal(BUTTON_NAMES[8], "View (2▢)");
  assert.equal(BUTTON_NAMES[9], "Menu (≡)");
});

test("Presets (EVA Default, Rover Trigger Swap, Left-Handed Sticks, Flight/Freecam), trigger deadzone, and response curves", () => {
  gamepad.reset();
  gamepad.pad = { id: "Xbox Wireless Controller", connected: true, mapping: "standard" };
  gamepad.buttons[6] = 0.2;
  gamepad.buttons[7] = 0.8;

  // Rover Trigger Swap preset swaps LT and RT for throttle/brake
  gamepad.applyPreset("rover-trigger-swap");
  assert.equal(gamepad.settings.preset, "rover-trigger-swap");
  assert.equal(gamepad.analog("throttle"), 0.2);
  assert.equal(gamepad.analog("brake"), 0.8);

  // Left-Handed Sticks swaps move() and look() sticks
  gamepad.applyPreset("left-handed");
  assert.equal(gamepad.settings.swapSticks, true);

  // Flight/Freecam enables invertY and exponential curve
  gamepad.applyPreset("flight-freecam");
  assert.equal(gamepad.settings.invertY, true);
  assert.equal(gamepad.settings.responseCurve, "exponential");

  // Trigger deadzone filters small trigger noise and rescales remaining travel
  gamepad.applyPreset("eva-default");
  gamepad.set("triggerDeadzone", 0.25);
  gamepad.buttons[7] = 0.2; // below 0.25 deadzone -> 0
  assert.equal(gamepad.analog("throttle"), 0);
  gamepad.buttons[7] = 0.625; // halfway between 0.25 and 1.0 -> 0.5
  assert.ok(Math.abs(gamepad.analog("throttle") - 0.5) < 1e-3);

  gamepad.reset();
});

test("Rumble haptics throttling, Node no-op safety, and DualSense safety LED + adaptive triggers", async () => {
  gamepad.reset();
  gamepad.pad = null;

  // Safe no-op in Node when no gamepad or vibrationActuator is present
  assert.equal(gamepad.triggerHaptic("land", 0.8), false);

  const effects = [];
  gamepad.pad = {
    id: "DualSense Wireless Controller (054c:0ce6)",
    connected: true,
    mapping: "standard",
    vibrationActuator: {
      type: "dual-rumble",
      playEffect: (type, params) => {
        effects.push({ type, params });
        return Promise.resolve("complete");
      },
    },
  };

  const fired1 = gamepad.triggerHaptic("land", 1.0, { force: true });
  assert.equal(fired1, true);
  assert.equal(effects.length, 1);
  assert.equal(effects[0].type, "dual-rumble");
  assert.ok(effects[0].params.strongMagnitude > 0.4);

  // Immediate repeat of same non-forced preset is throttled by cooldown
  const fired2 = gamepad.triggerHaptic("wheelspin", 0.7);
  const fired3 = gamepad.triggerHaptic("wheelspin", 0.7);
  assert.equal(fired2, true);
  assert.equal(fired3, false, "Expected cooldown throttle on back-to-back wheelspin haptics");

  // Safety LED state transitions for Mars EVA slope limits
  const safeLed = gamepad.setSafetyLedState({ slopeDeg: 6.5 });
  assert.equal(safeLed.level, "safe");
  assert.ok(safeLed.g > safeLed.r, "Safe <=10 deg should be cyan/green");

  const amberLed = gamepad.setSafetyLedState({ slopeDeg: 12.5 });
  assert.equal(amberLed.level, "caution");

  const redLed = gamepad.setSafetyLedState({ slopeDeg: 17.5 });
  assert.equal(redLed.level, "warning");

  const blockedLed = gamepad.setSafetyLedState({ slopeDeg: 23.0, solarStorm: true });
  assert.equal(blockedLed.level, "blocked");
  assert.equal(blockedLed.pulse, true);

  // WebHID connect safely no-ops in Node where navigator.hid is absent
  const hidConnected = await gamepad.connectDualSenseWebHID();
  assert.equal(hidConnected, false);
});

test("Virtual nipplejs touch controls state injection routes into gamepad sticks, triggers, and button presses", () => {
  gamepad.reset();
  gamepad.pad = null;

  const pressedActions = [];
  const unsub = gamepad.onPress(({ actions }) => pressedActions.push(...actions));

  gamepad.setVirtualStick("left", 0.75, -0.85);
  gamepad.setVirtualStick("right", -0.5, 0.4);
  gamepad.setVirtualButton(7, 0.9); // RT throttle
  gamepad.setVirtualButton(0, 1);   // A confirm press edge

  assert.equal(gamepad.connected, true, "Virtual touch input marks gamepad connected");
  const mv = gamepad.move();
  assert.ok(mv.x > 0.5 && mv.y > 0.6, "Virtual left stick drives gamepad.move()");
  const rs = gamepad.rightStick();
  assert.ok(rs.x < -0.3 && rs.y > 0.2, "Virtual right stick drives gamepad.rightStick()");
  assert.equal(gamepad.analog("throttle"), 0.9, "Virtual RT drives analog throttle");
  assert.ok(pressedActions.includes("confirm"), "Virtual button edge triggers onPress");

  gamepad.clearVirtualInputs();
  unsub();
  gamepad.reset();
});

