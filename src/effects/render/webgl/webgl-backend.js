import { RenderBackend } from '../backend.js';
import { PostPipeline } from './post-pipeline.js';

/**
 * Рендер-движок эффектов на WebGL (three.js). Выходная стадия: пост-обработка (обратная связь, свечение, аберрация, датамош)
 * и переключение вывода между экраном и промежуточным буфером. Рядом лежат остальные части WebGL: scene-build.js (объекты сцены:
 * точки, призраки, линии), shader-cache.js (урезание и фоновая сборка шейдеров), specialize.js, post-pipeline.js, textures.js.
 * Эти файлы подмешиваются в движок эффектов как методы (см. engine/index.js), поэтому пока тесно связаны с ним.
 */
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
		// главный шейдер точек (он же у призраков шлейфа), связи, шейдеры вывода и обратной связи: каждый под вариант вывода, который нужен сейчас, в фоне, без замирания.
		// Программы остаются «на удержании»: облако при смене модели создаётся заново, старый материал удаляется, и без удержания three.js выбросил бы программу вместе с ним
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
			// вывод в экран или в буфер меняется, когда готовы программы нового варианта (см. _tgtSync)
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
