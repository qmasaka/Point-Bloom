// Готовые формы облака точек (сфера, тор, ДНК и т. д.).

// ───────────────────────────────────────────────────────────── формы
export function baseShape(type, count = 100000) {
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3).fill(1);

  if (type === 'sphere') {
    const phi = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2;
      const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = phi * i;
      const x = Math.cos(theta) * radiusAtY;
      const z = Math.sin(theta) * radiusAtY;
      pos[i*3] = x; pos[i*3+1] = y; pos[i*3+2] = z;
      nor[i*3] = x; nor[i*3+1] = y; nor[i*3+2] = z;
    }
  } else if (type === 'torus') {
    const R = 1.0, r = 0.36;
    for (let i = 0; i < count; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.random() * Math.PI * 2;
      const x = (R + r * Math.cos(v)) * Math.cos(u);
      const y = r * Math.sin(v);
      const z = (R + r * Math.cos(v)) * Math.sin(u);
      pos[i*3] = x; pos[i*3+1] = y; pos[i*3+2] = z;
      const cx = R * Math.cos(u), cz = R * Math.sin(u);
      nor[i*3] = (x - cx) / r; nor[i*3+1] = y / r; nor[i*3+2] = (z - cz) / r;
    }
  } else if (type === 'cube') {
    const h = 0.65;
    for (let i = 0; i < count; i++) {
      const face = Math.floor(Math.random() * 6);
      const u = (Math.random() - 0.5) * h * 2;
      const v = (Math.random() - 0.5) * h * 2;
      switch (face) {
        case 0: pos[i*3]=h;  pos[i*3+1]=u; pos[i*3+2]=v; nor[i*3]=1;  break;
        case 1: pos[i*3]=-h; pos[i*3+1]=u; pos[i*3+2]=v; nor[i*3]=-1; break;
        case 2: pos[i*3]=u;  pos[i*3+1]=h; pos[i*3+2]=v; nor[i*3+1]=1;  break;
        case 3: pos[i*3]=u;  pos[i*3+1]=-h;pos[i*3+2]=v; nor[i*3+1]=-1; break;
        case 4: pos[i*3]=u;  pos[i*3+1]=v; pos[i*3+2]=h; nor[i*3+2]=1;  break;
        case 5: pos[i*3]=u;  pos[i*3+1]=v; pos[i*3+2]=-h;nor[i*3+2]=-1; break;
      }
    }
  } else if (type === 'helix') {
    const turns = 3.5, h = 1.6, r = 0.65;
    for (let i = 0; i < count; i++) {
      const strand = Math.random() < 0.45 ? 0 : Math.random() < 0.85 ? 1 : 2;
      const t = Math.random();
      const angle = t * Math.PI * 2 * turns;
      const y = (t - 0.5) * h;
      if (strand === 0) {
        pos[i*3] = Math.cos(angle) * r; pos[i*3+1] = y; pos[i*3+2] = Math.sin(angle) * r;
        nor[i*3] = Math.cos(angle); nor[i*3+2] = Math.sin(angle);
      } else if (strand === 1) {
        pos[i*3] = Math.cos(angle + Math.PI) * r; pos[i*3+1] = y; pos[i*3+2] = Math.sin(angle + Math.PI) * r;
        nor[i*3] = Math.cos(angle + Math.PI); nor[i*3+2] = Math.sin(angle + Math.PI);
      } else {
        const u = Math.random() * 2 - 1;
        pos[i*3] = Math.cos(angle) * r * u; pos[i*3+1] = y; pos[i*3+2] = Math.sin(angle) * r * u;
        nor[i*3+1] = 1;
      }
    }
  } else if (type === 'saturn') {
    for (let i = 0; i < count; i++) {
      if (Math.random() < 0.3) {
        const u = Math.random(), v = Math.random();
        const theta = 2 * Math.PI * u, phi = Math.acos(2 * v - 1);
        const sr = 0.35;
        pos[i*3] = sr * Math.sin(phi) * Math.cos(theta);
        pos[i*3+1] = sr * Math.sin(phi) * Math.sin(theta);
        pos[i*3+2] = sr * Math.cos(phi);
        nor[i*3] = pos[i*3]/sr; nor[i*3+1] = pos[i*3+1]/sr; nor[i*3+2] = pos[i*3+2]/sr;
      } else {
        const rad = Math.sqrt(Math.random() * (1.4*1.4 - 0.5*0.5) + 0.5*0.5);
        const theta = Math.random() * Math.PI * 2;
        pos[i*3] = Math.cos(theta) * rad;
        pos[i*3+1] = (Math.random() - 0.5) * 0.04;
        pos[i*3+2] = Math.sin(theta) * rad;
        nor[i*3+1] = 1;
      }
    }
  }
  return { positions: pos, normals: nor, colors: col, count };
}

export function extraShape(type, count) {
	const pos = new Float32Array(count * 3);
	const nor = new Float32Array(count * 3);
	const col = new Float32Array(count * 3).fill(1);
	if (type === 'galaxy') {
		const arms = 3;
		for (let i = 0; i < count; i++) {
			const r = Math.pow(Math.random(), 0.7) * 1.6;
			const arm = (i % arms) / arms;
			const a = arm * Math.PI * 2 + r * 2.6 + (Math.random() - 0.5) * 0.5 / (0.3 + r);
			const spread = (Math.random() - 0.5) * 0.18 * (0.4 + r);
			pos[i * 3] = Math.cos(a) * r + spread;
			pos[i * 3 + 1] = (Math.random() - 0.5) * 0.12 * (1.4 - r * 0.6);
			pos[i * 3 + 2] = Math.sin(a) * r + spread;
			nor[i * 3 + 1] = 1;
		}
	} else {
		for (let i = 0; i < count; i++) {
			pos[i * 3] = (Math.random() - 0.5) * 2.6;
			pos[i * 3 + 1] = 0;
			pos[i * 3 + 2] = (Math.random() - 0.5) * 2.6;
			nor[i * 3 + 1] = 1;
		}
	}
	return { positions: pos, normals: nor, colors: col, count };
}

export function generateShapePoints(type, count = 100000) {
	return type === 'galaxy' || type === 'plane' ? extraShape(type, count) : baseShape(type, count);
}
