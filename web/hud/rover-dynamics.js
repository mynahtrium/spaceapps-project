/**
 * MMSEV 6x6 & Historic Rover Dynamics Adapter (`web/hud/rover-dynamics.js`).
 *
 * Delegates all rigid-body / raycast suspension / drivetrain simulation to the
 * unified Rapier3D + Three.js vehicle solver in `web/physics/VehicleDynamics.js`.
 */

export {
  WATTS_PER_HP,
  TORQUE_MULTIPLIER,
  POWER_MULTIPLIER,
  ROVER_PARAMS,
  roverParamsFor,
  roverParamsForHistoric,
  createRoverDynamics,
} from "../physics/VehicleDynamics.js";
