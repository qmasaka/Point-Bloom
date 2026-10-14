import { RenderBackend } from '../backend.js';
import { PostPipeline } from './post-pipeline.js';
export class WebGLBackend extends RenderBackend {
get kind() {
return 'webgl';
}
create() {
this.post = new PostPipeline(this.engine.app.viewport.renderer);
}
async prepare(kinds) {
const e = this.engine;
const vp = e.app.viewport;
await Promise.all([e._warmScene(vp.scene, vp.camera), this.post.warm(), ...kinds.map((k) => e._warmKind(k, e._fxCur))]);
e._tgtWarm[e._tgtRT ? 'r' : 's'] = 2;
}
install() {
const e = this.engine;
e.app.viewport.renderHook = (renderer, scene, camera) => {
if (!e.active) {
renderer.render(scene, camera);
return;
}
const fb = e.state.layers.feedback;
const bloom = e.state.look.bloom || 0;
const ab = e.state.look.aberration || 0;
const dm = e.state.layers.datamosh;
e._tgtSync();
if (!e._tgtRT) {
renderer.setRenderTarget(null);
renderer.render(scene, camera);
this.post.hasHistory = false;
return;
}
this.post.render(scene, camera, fb, bloom, ab, dm && dm.on ? e._moshParams(dm) : null, true);
};
}
setTint(color) {
this.post.tint = color;
}
dispose() {
this.engine.app.viewport.renderHook = null;
this.post?.dispose();
this.post = null;
}
}
