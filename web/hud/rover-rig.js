/**
 * Suspension rig for the drivable MMSEV (`web/hud/rover-rig.js`).
 *
 * Builds visible running gear on the rover body and drives it from `rover-dynamics.js` every frame:
 *  - a lower control arm from the chassis to each wheel hub (it swings as the wheel moves),
 *  - a coil-over strut (piston + helical spring) from the upper mount to the hub; the spring
 *    stretches and squashes with the real strut length,
 *  - wheel hub height, steering angle (four-wheel Ackermann) and wheel spin.
 * The chassis pose (position, yaw, pitch, roll) comes from the rigid-body model too.
 */

function helixGeometry(THREE, turns = 7, radius = 0.075, wire = 0.012, segs = 140) {
  class Helix extends THREE.Curve {
    getPoint(t, target = new THREE.Vector3()) {
      const a = t * turns * Math.PI * 2;
      return target.set(Math.cos(a) * radius, t, Math.sin(a) * radius);
    }
  }
  return new THREE.TubeGeometry(new Helix(), segs, wire, 6, false); // unit height along +Y
}

export function attachSuspensionRig(THREE, rover, dynamics) {
  const rig = rover.getActiveRig();
  const body = rover.bodyRoot;
  const springMat = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.35, metalness: 0.75 });
  const pistonMat = new THREE.MeshStandardMaterial({ color: 0xb9c0c8, roughness: 0.18, metalness: 0.95 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2f37, roughness: 0.55, metalness: 0.7 });
  const springGeom = helixGeometry(THREE);
  const cylGeom = new THREE.CylinderGeometry(1, 1, 1, 10);
  cylGeom.translate(0, 0.5, 0); // unit cylinder from y=0 to y=1
  const armGeom = new THREE.BoxGeometry(1, 1, 1);
  armGeom.translate(0.5, 0, 0); // unit box from x=0 to x=1

  const P = dynamics.params;
  const up = new THREE.Vector3(0, 1, 0);
  const xAxis = new THREE.Vector3(1, 0, 0);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const d = new THREE.Vector3();

  // pair each visual pod with the dynamics wheel at the same corner
  const links = rig.pods.map((pod) => {
    const wheel = dynamics.wheels.reduce((best, wh) =>
      Math.hypot(wh.lx - pod.lx, wh.lz - pod.lz) < Math.hypot(best.lx - pod.lx, best.lz - pod.lz) ? wh : best
    );
    const side = Math.sign(pod.lx) || 1;
    const strut = new THREE.Group();
    const housing = new THREE.Mesh(cylGeom, bodyMat); // damper body (upper part)
    const piston = new THREE.Mesh(cylGeom, pistonMat); // shiny rod (lower part)
    const spring = new THREE.Mesh(springGeom, springMat);
    for (const mesh of [housing, piston, spring]) {
      mesh.castShadow = true;
      strut.add(mesh);
    }
    const arm = new THREE.Mesh(armGeom, bodyMat);
    arm.castShadow = true;
    body.add(strut, arm);
    return {
      pod,
      wheel,
      side,
      strut,
      housing,
      piston,
      spring,
      arm,
      mountTop: new THREE.Vector3(pod.lx - side * 0.32, dynamics.mountY + 0.18, pod.lz),
      armRoot: new THREE.Vector3(pod.lx - side * 0.62, P.wheelRadius + 0.04, pod.lz),
    };
  });

  const q = new THREE.Quaternion();
  /** Pose the rover and its running gear from the dynamics state (call once per frame). */
  function sync() {
    const st = dynamics.state;
    const att = dynamics.attitude();
    rover.group.position.copy(st.pos);
    rover.group.rotation.set(0, att.yaw, 0);
    body.position.set(0, 0, 0);
    body.rotation.set(att.pitch, 0, att.roll, "XYZ");

    for (let idx = 0; idx < links.length; idx++) {
      const L = links[idx];
      const { pod, wheel } = L;
      const vc = dynamics.vehicleController || null;
      const hubY = wheel.hubY;
      const steer = vc && typeof vc.wheelSteering === "function" && Number.isFinite(wheel.steer) ? wheel.steer : wheel.steer;
      const spin = vc && typeof vc.wheelRotation === "function" && Number.isFinite(wheel.angle) ? wheel.angle : wheel.angle;
      const hubX = pod.lx - L.side * (pod.hubInset || 0);
      // hub, steering, spin
      pod.podRoot.position.y = hubY;
      pod.knuckle.rotation.y = steer;
      pod.spinner.rotation.x = spin;

      // coil-over: from the upper mount to the upright hub carrier
      a.copy(L.mountTop);
      b.set(hubX - L.side * (pod.hubInset ? 0.02 : 0.06), wheel.hubY + 0.2, pod.lz);
      d.copy(b).sub(a);
      const len = Math.max(0.05, d.length());
      q.setFromUnitVectors(up, d.normalize());
      L.strut.position.copy(a);
      L.strut.quaternion.copy(q);
      L.housing.scale.set(0.05, len * 0.55, 0.05);
      L.piston.position.y = len * 0.5;
      L.piston.scale.set(0.022, len * 0.5, 0.022);
      L.spring.position.y = len * 0.12;
      L.spring.scale.set(1, len * 0.8, 1);

      // lower control arm from the chassis pivot to the upright hub carrier
      a.copy(L.armRoot);
      b.set(hubX, wheel.hubY, pod.lz);
      d.copy(b).sub(a);
      const armLen = d.length();
      L.arm.position.copy(a);
      L.arm.quaternion.setFromUnitVectors(xAxis, d.normalize());
      L.arm.scale.set(armLen, 0.07, 0.16);
    }
  }

  return { sync, links };
}
