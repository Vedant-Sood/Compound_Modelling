// Unit-cell wireframe and Miller-plane overlay for the Crystal Explorer,
// added to the renderer's solid layer. Input in Å, scene in pm.

import * as THREE from "three";
import { boxEdges, fracToCart, millerPlanePolygons, type Vec3 } from "../science/crystal";

export class CellOverlay {
  readonly group = new THREE.Group();
  private objects: THREE.Object3D[] = [];

  set(cell: number[][], repeats: Vec3, hkl: Vec3 | null) {
    this.clear();
    const pm = (f: Vec3) => new THREE.Vector3(...fracToCart(f, cell)).multiplyScalar(100);

    // repeat box (bright) and the edges of the first unit cell (dim) when repeated
    const lines = (edges: [Vec3, Vec3][], colour: number, opacity: number) => {
      const g = new THREE.BufferGeometry().setFromPoints(edges.flatMap(([a, b]) => [pm(a), pm(b)]));
      const obj = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: colour, transparent: opacity < 1, opacity }));
      this.add(obj);
    };
    lines(boxEdges(repeats), 0xd8dee9, 1);
    if (repeats.some((n) => n > 1)) lines(boxEdges([1, 1, 1]), 0x7f8a99, 0.8);

    if (hkl) {
      const polys = millerPlanePolygons(hkl, repeats);
      const verts: number[] = [];
      for (const poly of polys) {
        const p = poly.map(pm);
        for (let k = 1; k + 1 < p.length; k++) verts.push(...p[0].toArray(), ...p[k].toArray(), ...p[k + 1].toArray());
      }
      if (verts.length) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
        const mat = new THREE.MeshBasicMaterial({ color: 0xe8c547, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
        this.add(new THREE.Mesh(g, mat));
      }
    }
  }

  private add(o: THREE.Object3D) {
    this.objects.push(o);
    this.group.add(o);
  }

  clear() {
    for (const o of this.objects) {
      this.group.remove(o);
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      (m.material as THREE.Material | undefined)?.dispose();
    }
    this.objects = [];
  }
}
