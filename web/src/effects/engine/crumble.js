const BINS = 256;
export class CrumblePart {
crumbleReset() {
const C = this._crumble;
if (!C) return;
C.times.fill(-1);
C.damage = 0;
C.last = 0;
C.phase = 'break';
C.hold = 0;
C.asm = 0;
this._crumble = null;
if (this.shared) this.shared.uAsm.value = 0;
}
_crumbleTick(P, dt, u) {
const C = this._crumble ||= { times: new Float32Array(BINS).fill(-1), damage: 0, last: 0, phase: 'break', hold: 0, asm: 0 };
const level = this.levels || { bass: 0, mid: 0, high: 0, beat: 0 };
const gate = P.amode === 'gate';
const heard = P.band === 'none' ? 0 : gate ? this._eff(P) / Math.max(0.01, P.amount) : this._bandLevel(P) * Math.min(2, (P.react || 0) * 2);
if (C.phase === 'break') {
const rise = dt * (P.idle * 0.08 + heard * 0.35);
C.damage = Math.min(1, C.damage + rise);
const top = Math.min(BINS - 1, Math.floor(C.damage * (BINS - 1)));
for (let i = C.last; i <= top; i++) C.times[i] = this._time;
C.last = Math.max(C.last, top + 1);
if (C.damage >= 1) {
C.phase = 'hold';
C.hold = 0;
}
} else if (C.phase === 'hold') {
C.hold += dt;
if (P.repeat === 'loop' && C.hold > P.hold) {
C.phase = 'asm';
C.asm = 0;
}
} else {
C.asm = Math.min(1, C.asm + dt / Math.max(0.5, P.asm));
if (C.asm >= 1) {
C.times.fill(-1);
C.damage = 0;
C.last = 0;
C.phase = 'break';
C.asm = 0;
}
}
const packed = u.uCrumbleT.value;
for (let i = 0; i < BINS / 4; i++) packed[i].set(C.times[i * 4], C.times[i * 4 + 1], C.times[i * 4 + 2], C.times[i * 4 + 3]);
u.uCrumble.value.set(this.state.source === 'media' && this.pm?.ready ? 2 : 1, this._time, P.chunk, P.fade ?? 0.6);
u.uPhysics.value.set(Math.max(0.01, P.amount), P.gravity, P.bounce, P.wind);
u.uPhysP.value.set(P.burst, P.peel, P.swirl, 0);
u.uAsm.value = C.phase === 'asm' ? C.asm : 0;
u.uCollapseTime.value = 0;
}
}
