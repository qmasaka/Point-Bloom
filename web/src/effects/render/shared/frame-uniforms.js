import * as THREE from 'three';
function scrDummy() {
const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
t.needsUpdate = true;
return t;
}
import { frDummy2D, frDummyTex, glyphAtlas } from '../webgl/textures.js';
export function createFrameUniforms({ count, specTex, pieceTex }) {
const U = (v) => ({ value: v });
return {
uTime: U(0), uMorph: U(1), uMorphS: U(new THREE.Vector4(0, 0.8, 0.35, 1)), uMorphO: U(new THREE.Vector4(0, 0, 0.4, 0)), uSettle: U(-1), uFr: U(new THREE.Vector4()), uFr2: U(new THREE.Vector4(1, 1, 2.2, 1.2)), uFr3: U(new THREE.Vector4(1.6, 0, 0, 0)), uFr4: U(new THREE.Vector4(0, 0, 0.12, 0.7)), uFr5: U(new THREE.Vector4(0, 0.7, 1, 1)), uHero: U(new THREE.Vector4()), uFr6: U(new THREE.Vector4(1.5, 0, 0, 0.5)), uFr7: U(new THREE.Vector4(1, 0, 0.6, 0)), uHeroTex: U(frDummy2D()), uFrTex: U(frDummyTex()), uSize: U(3), uPR: U(1), uBeat: U(0), uColorBy: U(0), uBright: U(1), uGlow: U(0.8), uAdd: U(1), uDens: U(Math.min(1.6, Math.sqrt(150000 / count))),
uP0: U(new THREE.Color()), uP1: U(new THREE.Color()), uP2: U(new THREE.Color()), uYR: U(new THREE.Vector2(-1, 1)),
uShade: U(0), uGlyph: U(new THREE.Vector3(0, 1, 8)), uAtlas: U(glyphAtlas('ascii')), uMouse: U(new THREE.Vector3()), uMouseOn: U(0), uSpecTex: U(specTex),
uCurl: U(new THREE.Vector4()), uSpec: U(new THREE.Vector4()), uWave: U(new THREE.Vector4()), uTwist: U(new THREE.Vector4()),
uPulse: U(new THREE.Vector4()), uVoxel: U(new THREE.Vector4()), uJitter: U(new THREE.Vector4()), uCursor: U(new THREE.Vector4()),
uGlitch: U(new THREE.Vector4()), uSlice: U(new THREE.Vector4()), uSliceM: U(new THREE.Vector4()), uSliceC: U(new THREE.Color()), uMark: U(new THREE.Vector4()), uMarkC: U(new THREE.Color()), uLink: U(new THREE.Vector4()), uLinkP: U(new THREE.Vector4()), uContact: U(new THREE.Vector4()), uShockP: U(new THREE.Vector4()),
uTrk: U(Array.from({ length: 16 }, () => new THREE.Vector4())), uImp: U(Array.from({ length: 32 }, () => new THREE.Vector4())), uShock: U(Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 0, -1))),
uMask: U(new THREE.Vector4()), uMaskA: U(new THREE.Vector4()), uMaskShow: U(0),
uPhysics: U(new THREE.Vector4()), uCollapseTime: U(0),
uBrushHits: U(Array.from({ length: 20 }, () => new THREE.Vector4(0, 0, 0, -1))), uBrushParam: U(new THREE.Vector4()), uPaintP: U(new THREE.Vector4()),
uLookP2: U(new THREE.Vector4()), uDof: U(new THREE.Vector4()),
uHyp: U(new THREE.Vector4()), uHypP: U(new THREE.Vector4()),
uScr: U(new THREE.Vector4()), uScrP: U(new THREE.Vector4(0, 0.4, 1, 1.78)), uScrTex: U(scrDummy()), uScrD: U(new THREE.Vector4(0, 0.5, 1, 1)), uScrQ: U(new THREE.Vector4()), uScrDep: U(scrDummy()), uScrMTex: U(scrDummy()), uScrMN: U(1),
uSlit: U(new THREE.Vector4()), uSlitP: U(new THREE.Vector4()), uSlitG: U(new THREE.Vector4(1, 1, 1, 1)), uSlitTex: U(frDummyTex()),
uScopeC: U(new THREE.Color(0.24, 1, 0.48)), uScopeW: U(2.4), uScopeLB: U(1), uDepth: U(new THREE.Vector4()), uDepthP: U(new THREE.Vector4()), uDepthQ: U(new THREE.Vector4()), uFlat: U(0), uScope: U(new THREE.Vector4()), uScopeP: U(new THREE.Vector4()), uScopeQ: U(new THREE.Vector4()), uShape: U(1), uCurlP: U(new THREE.Vector4()), uSpecP: U(new THREE.Vector4()), uWaveP: U(new THREE.Vector4()), uWaveSrc: U(new THREE.Vector4()), uPulseP: U(new THREE.Vector4()), uVoxelP: U(new THREE.Vector4()), uGlitchP: U(new THREE.Vector4()), uBlast: U(new THREE.Vector4()), uFlow: U(new THREE.Vector4()), uDisP: U(new THREE.Vector4()), uSolid: U(new THREE.Color()), uAtt: U(1), uHand: U(Array.from({ length: 12 }, () => new THREE.Vector4())), uHandP: U(new THREE.Vector4()), uGrav: U(new THREE.Vector4()), uGravT: U(new THREE.Vector4()), uPhysP: U(new THREE.Vector4()), uAsm: U(0), uDis: U(new THREE.Vector4()), uDisT: U(0.8), uAnimN: U(0), uCen: U(new THREE.Vector3()), uExp: U(new THREE.Vector4()), uExpP: U(new THREE.Vector4()), uPieceTex: U(pieceTex), uGrow: U(new THREE.Vector4()), uGrowP: U(new THREE.Vector4()), uGrowSeed: U(new THREE.Vector3()), uJel: U(Array.from({ length: 3 }, () => new THREE.Vector4(0, 0, 0, -99))), uJelO: U(Array.from({ length: 3 }, () => new THREE.Vector4())), uJelP: U(new THREE.Vector4()), uDisQ: U(new THREE.Vector4(0.32, 1, 0.35, 0.85)), uGravP: U(new THREE.Vector4()), uRes: U(new THREE.Vector2(1, 1)), uLinkW: U(1.8),
};
}
