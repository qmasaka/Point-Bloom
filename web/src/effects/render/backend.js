export class RenderBackend {
constructor(engine) {
this.engine = engine;
}
get kind() {
throw new Error('RenderBackend.kind не реализован');
}
create() {}
async prepare(kinds) {}
install() {}
setTint(color) {}
dispose() {}
}
