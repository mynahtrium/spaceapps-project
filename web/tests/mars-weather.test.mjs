import test from "node:test";
import assert from "node:assert/strict";
import weather, { WEATHER_STATES, computeWeatherTelemetry } from "../environment/marsWeather.js";

test("WEATHER_STATES defines 4 scientifically calibrated Gale Crater states", () => {
  assert.equal(WEATHER_STATES.length, 4);
  assert.equal(WEATHER_STATES[0].id, "CLEAR_SOL");
  assert.equal(WEATHER_STATES[0].tau, 0.4);
  assert.equal(WEATHER_STATES[1].id, "DUST_DEVIL");
  assert.equal(WEATHER_STATES[1].pressureOffsetPa, -3);
  assert.equal(WEATHER_STATES[2].id, "REGIONAL_DUST_STORM");
  assert.ok(WEATHER_STATES[2].tau > 2.5);
  assert.equal(
    WEATHER_STATES[2].banner?.text,
    "CAUTION: HIGH DUST OPACITY (\u03c4 > 2.5) - REDUCE ROVER SPEED"
  );
  assert.equal(WEATHER_STATES[3].id, "DONKI_SPE");
  assert.equal(
    WEATHER_STATES[3].banner?.text,
    "WARNING: DONKI SPE RADIATION SURGE - SEEK HABITAT AIRLOCK"
  );
});

test("computeWeatherTelemetry computes pressure drop, tau > 2.5, and SPE dose spike", () => {
  const clear = computeWeatherTelemetry(0, 0);
  assert.equal(clear.sol, 4995);
  assert.equal(clear.pressurePa, 740);
  assert.equal(clear.tau, 0.4);
  assert.equal(clear.isAlert, false);
  assert.ok(Math.abs(clear.radMsvDay - 0.64) < 0.05);

  const devil = computeWeatherTelemetry(1, 0);
  assert.equal(devil.pressurePa, 737);
  assert.equal(devil.isAlert, false);

  const storm = computeWeatherTelemetry(2, 0);
  assert.ok(storm.tau > 2.5);
  assert.equal(storm.isAlert, true);

  const spe = computeWeatherTelemetry(3, 0);
  assert.ok(spe.radMsvHr > 2.0);
  assert.equal(spe.isAlert, true);
});

test("cycleState steps through 4 states, Auto Mode, and wraps back to CLEAR_SOL", () => {
  weather.setState(0);
  assert.equal(weather.getState().stateId, "CLEAR_SOL");
  assert.equal(weather.getState().autoMode, false);

  assert.equal(weather.cycleState().stateId, "DUST_DEVIL");
  assert.equal(weather.cycleState().stateId, "REGIONAL_DUST_STORM");
  assert.equal(weather.cycleState().stateId, "DONKI_SPE");

  const auto = weather.cycleState();
  assert.equal(auto.autoMode, true);

  const wrapped = weather.cycleState();
  assert.equal(wrapped.autoMode, false);
  assert.equal(wrapped.stateId, "CLEAR_SOL");
});

test("MartianWeather safely syncs isAlert to window.MartianAudio when present", () => {
  const calls = [];
  let hazardBeeps = 0;
  globalThis.window = {
    MartianAudio: {
      update: (payload) => calls.push(payload),
      playHazardBeep: () => {
        hazardBeeps += 1;
      },
    },
  };

  try {
    weather.setState(0);
    assert.deepEqual(calls.at(-1), { isAlert: false });

    weather.setState(2);
    assert.deepEqual(calls.at(-1), { isAlert: true });
    assert.equal(hazardBeeps, 1);

    weather.setState(3);
    assert.deepEqual(calls.at(-1), { isAlert: true });
    assert.equal(hazardBeeps, 2);

    weather.setState(1);
    assert.deepEqual(calls.at(-1), { isAlert: false });
  } finally {
    delete globalThis.window;
  }
});
