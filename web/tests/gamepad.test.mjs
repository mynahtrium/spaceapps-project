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
