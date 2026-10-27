// Ball-and-stick structure drawn with instanced meshes in the renderer's
// solid layer. Input coordinates are Å; the scene is in pm.

import * as THREE from "three";
import type { MolAtom, MolBond } from "../api/molecular";

export interface StructureStyle {
  radiusScale: number; // fraction of the covalent radius used for spheres
  covalent: Record<string, number>; // Å
  colour: Record<string, string>;
}

const BOND_RADIUS_PM = 9;
const SELECT_COLOUR = new THREE.Color("#f2a541");

export class StructureLayer {
  readonly group = new THREE.Group();
  atomsMesh: THREE.InstancedMesh | null = null;
  private bondMesh: THREE.InstancedMesh | null = null;
  private sphere = new THREE.SphereGeometry(1, 32, 16);
  private cylinder = new THREE.CylinderGeometry(1, 1, 1, 12, 1);

  set(atoms: MolAtom[], bonds: MolBond[], style: StructureStyle, selected: number[] = []) {
    this.clear();
    if (!atoms.length) return;
    const m = new THREE.Matrix4();
    const atomMat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.05 });
    const am = new THREE.InstancedMesh(this.sphere, atomMat, atoms.length);
    atoms.forEach((a, k) => {
      const r = (style.covalent[a.symbol] ?? 0.75) * 100 * style.radiusScale;
      m.compose(new THREE.Vector3(...a.xyz).multiplyScalar(100), new THREE.Quaternion(), new THREE.Vector3(r, r, r));
      am.setMatrixAt(k, m);
      am.setColorAt(k, selected.includes(k) ? SELECT_COLOUR : new THREE.Color(style.colour[a.symbol] ?? "#ff1493"));
    });
    this.atomsMesh = am;
    this.group.add(am);

    // one cylinder per bond; multiple bonds as parallel offset cylinders
    const segs: [THREE.Vector3, THREE.Vector3][] = [];
    for (const b of bonds) {
      const p = new THREE.Vector3(...atoms[b.i].xyz).multiplyScalar(100);
      const q = new THREE.Vector3(...atoms[b.j].xyz).multiplyScalar(100);
      const n = b.order >= 3 ? 3 : b.order >= 2 ? 2 : 1;
      const axis = q.clone().sub(p).normalize();
      const perp = new THREE.Vector3(0, 0, 1).cross(axis);
      if (perp.lengthSq() < 1e-6) perp.set(1, 0, 0);
      perp.normalize();
      const sep = BOND_RADIUS_PM * 2.4;
      for (let k = 0; k < n; k++) {
        const off = perp.clone().multiplyScalar((k - (n - 1) / 2) * sep);
        segs.push([p.clone().add(off), q.clone().add(off)]);
      }
    }
    if (segs.length) {
      const bm = new THREE.InstancedMesh(this.cylinder, new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.5 }), segs.length);
      const up = new THREE.Vector3(0, 1, 0);
      segs.forEach(([p, q], k) => {
        const d = q.clone().sub(p);
        const rad = BOND_RADIUS_PM;
        m.compose(
          p.clone().add(q).multiplyScalar(0.5),
          new THREE.Quaternion().setFromUnitVectors(up, d.clone().normalize()),
          new THREE.Vector3(rad, d.length(), rad),
        );
        bm.setMatrixAt(k, m);
      });
      this.bondMesh = bm;
      this.group.add(bm);
    }
  }

  clear() {
    for (const mesh of [this.atomsMesh, this.bondMesh]) {
      if (!mesh) continue;
      this.group.remove(mesh);
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
    this.atomsMesh = null;
    this.bondMesh = null;
  }
}
