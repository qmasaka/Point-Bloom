import * as THREE from 'three';
import { waitPrograms } from './programs.js';
import { FX_GUARDS, specializeFx } from './specialize.js';
import { frag } from '../../shaders/glsl/frag.js';
import { lineFrag } from '../../shaders/glsl/line-frag.js';
import { lineVert } from '../../shaders/glsl/line-vert.js';
import { scopeFrag } from '../../shaders/glsl/scope-frag.js';
import { scopeVert } from '../../shaders/glsl/scope-vert.js';
import { vert } from '../../shaders/glsl/vert.js';

/** Управление шейдерами WebGL: урезание под включённые эффекты, фоновая сборка, «шлюз» показа тяжёлых объектов, переключение вывода. Методы подмешиваются в EffectsEngine (см. engine/index.js). */
export class ShaderCachePart {
	// ------------------------------------------------------------ специализация шейдеров (см. specializeFx)
	_fxSource(kind, on) {
		const cache = this._fxCache || (this._fxCache = new Map());
		const sig = [...on].sort().join(',');
		const ck = kind + '|' + sig;
		let v = cache.get(ck);
		if (!v) {
			const base = kind === 'line' ? lineVert : kind === 'scope' ? scopeVert : vert;
			v = specializeFx(base, (name, comp, thr) => (FX_GUARDS.has(name + '.' + comp + '>' + thr) ? on.has(name + '.' + comp + '>' + thr) : undefined));
			// «Экран» есть только в WebGL: блок #ifdef VSCREEN включается здесь, в WGSL-версии его нет
			if (kind === 'vert') v = '#define VSCREEN 1\n' + v;
			cache.set(ck, v);
		}
		return v;
	}

	/**
	 * Каждый кадр: если включился эффект, которого нет в текущем шейдере, в фоне собирается шейдер побольше и подставляется, когда готов.
	 * И наоборот: эффекты, которые давно выключены, из шейдера убираются. Иначе за долгую сессию набор только растёт, шейдер приближается к полному
	 * (а он собирается десятки секунд и может убить видеопроцесс браузера).
	 */
	_fxCheck() {
		if (!this.shared || !this.points || this._fxBusy || this._glDormant) return;
		const cur = this._fxCur || (this._fxCur = new Set());
		const now = performance.now();
		const seen = this._fxSeen || (this._fxSeen = new Map()); // когда эффект был включён в последний раз
		let add = null;
		for (const [key, [name, comp, thr]] of FX_GUARDS) {
			const v = this.shared[name]?.value?.[comp];
			const on = v > thr * 0.5;
			if (on) seen.set(key, now);
			if (on && !cur.has(key)) (add || (add = new Set())).add(key);
		}
		// эффекты, которые не использовались больше 20 секунд: их код из шейдера убирается, когда накопилось хотя бы два таких
		let stale = null;
		for (const key of cur) if (now - (seen.get(key) || 0) > 20000) (stale || (stale = new Set())).add(key);
		if (!add && !(stale && stale.size >= 2)) {
			this._fxDeb = 0;
			return;
		}
		// несколько эффектов, включённых подряд, собираются одним шейдером: каждая сборка это короткое подвисание драйвера, и лучше пережить его один раз
		if (!this._fxDeb) this._fxDeb = now;
		if (now - this._fxDeb < 250) return;
		this._fxDeb = 0;
		this._fxApply(add || new Set(), add ? null : stale);
	}

	/** Все ли включённые сейчас эффекты уже есть в собранном шейдере (иначе картинка WebGL отстаёт от настроек) */
	_fxCovered() {
		if (!this.shared || this._fxBusy) return false;
		const cur = this._fxCur;
		if (!cur) return false;
		for (const [key, [name, comp, thr]] of FX_GUARDS) {
			if (this.shared[name]?.value?.[comp] > thr * 0.5 && !cur.has(key)) return false;
		}
		return true;
	}

	async _fxApply(add, drop) {
		this._fxBusy = true;
		const next = new Set([...(this._fxCur || [])].filter((k) => !(drop && drop.has(k))));
		for (const k of add) next.add(k);
		try {
			await Promise.all(this._warmKinds().map((k) => this._warmKind(k, next)));
		} catch (e) {
			/* если фоновая сборка не удалась, шейдер соберётся при подстановке */
		}
		this._fxCur = next;
		this._fxSwap();
		this._fxBusy = false;
	}

	// ------------------------------------------------------------ фоновая сборка шейдеров
	// На Windows (ANGLE и Direct3D 11) компиляция большого шейдера идёт секунды, и если она случается в кадре, браузер замирает целиком.
	// Поэтому каждая программа собирается заранее и в фоне, под тот вариант вывода, который сейчас используется (в экран или в буфер для свечения и обратной связи):
	// у three.js это две разные программы, и сборка «не того» варианта при первом кадре случалась бы прямо в потоке интерфейса.
	// Второй вариант собирается только когда он понадобится (включилось свечение или выключилось), а вывод переключается, когда он готов: так на каждый новый эффект собирается одна программа, а не две, и подвисание вдвое короче.

	/** Включена ли пост-обработка: тогда сцена рисуется не на экран, а в промежуточный буфер */
	_postOn() {
		const L = this.state.layers;
		const fb = L.feedback;
		const dm = L.datamosh;
		return (this.state.look.bloom || 0) > 0.01 || (this.state.look.aberration || 0) > 0.01 || !!(fb && fb.on && fb.amount > 0.01) || !!(dm && dm.on);
	}

	/** Подпись набора включённых эффектов: от неё зависит текст шейдеров */
	_fxSig(set) {
		return [...(set || this._fxCur || [])].sort().join(',');
	}

	/** Вид главного шейдера точек: режим смешивания входит в ключ программы (у three.js прозрачный и непрозрачный материал это разные программы) */
	_vertKind() {
		const add = this.material ? this.material.blending === THREE.AdditiveBlending : this.state.look.blend === 'add';
		return add ? 'vert|add' : 'vert|norm';
	}

	/** Виды шейдеров, которые сейчас в сцене и должны быть готовы до подстановки нового текста */
	_warmKinds() {
		const kinds = [this._vertKind()];
		const now = performance.now();
		const wanted = (k) => now - ((this._wantT && this._wantT[k]) || -1e9) < 800;
		if (this.hero) kinds.push('hero');
		if (this.linkObj && (this.linkObj.visible || wanted('line'))) kinds.push('line');
		if (this._scopeLine && (this._scopeLine.visible || wanted('scope'))) kinds.push('scope');
		return kinds;
	}

	/** Куда рисует сцена сейчас: в промежуточный буфер (true) или прямо на экран (false) */
	_curTgt() {
		return this.active ? !!this._tgtRT : this._postOn();
	}

	/** Собирает программы объектов сцены под один вариант вывода и ждёт их готовности, не блокируя поток */
	async _warmScene(scene, camera, rt = this._curTgt()) {
		const r = this.app.viewport.renderer;
		const prev = r.getRenderTarget();
		const mats = new Set();
		try {
			// у three.js для вывода в буфер своя программа; буфер для сборки берётся любой, важно только, что это не экран
			const target = rt ? this._warmRT || (this._warmRT = new THREE.WebGLRenderTarget(4, 4)) : null;
			// свет берётся из настоящей сцены: число источников света входит в ключ программы, и без «фонаря» камеры программа получалась бы другой, чем в кадре
			r.setRenderTarget(target);
			r.compile(scene, camera, this.app.viewport.scene).forEach((m) => mats.add(m));
		} catch (e) {
			return;
		} finally {
			r.setRenderTarget(prev);
		}
		await waitPrograms(r, mats);
	}

	_warmObj(kind, set) {
		const g = this._warmGeo || (this._warmGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3)));
		const base = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: {} };
		if (kind === 'line') return new THREE.Mesh(g, new THREE.ShaderMaterial({ ...base, side: THREE.DoubleSide, vertexShader: this._fxSource('line', set), fragmentShader: lineFrag }));
		if (kind === 'scope') return new THREE.Mesh(g, new THREE.ShaderMaterial({ ...base, side: THREE.DoubleSide, vertexShader: this._fxSource('scope', set), fragmentShader: scopeFrag }));
		// точки: параметры материала такие же, как у настоящего (смешивание, прозрачность, запись глубины), иначе ключ программы другой и прогрев не помогает
		const hero = kind === 'hero';
		const add = hero ? !this.hero || this.hero.material.blending === THREE.AdditiveBlending : kind !== 'vert|norm';
		const par = { transparent: add, depthWrite: !add, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: {}, vertexShader: this._fxSource('vert', set), fragmentShader: frag };
		if (hero) par.defines = { HERO: 1 };
		return new THREE.Points(g, new THREE.ShaderMaterial(par));
	}

	/**
	 * Собирает шейдер одного вида под набор эффектов и держит программу живой: иначе three.js выбросит её вместе с временным материалом, и первый кадр соберёт её заново.
	 * Держатся последние несколько наборов: если эффект выключили и включили снова, программа уже есть и подстановка мгновенна.
	 */
	async _warmKind(kind, set, rt = this._curTgt()) {
		set = set || this._fxCur || new Set();
		const sig = this._fxSig(set);
		const keep = this._keep || (this._keep = new Map());
		const warm = this._warm || (this._warm = new Map());
		const id = kind + (rt ? '@r' : '@s');
		const kid = id + '#' + sig;
		const want = this._warmWant || (this._warmWant = {});
		want[id] = sig;
		const prev = keep.get(kid);
		if (prev) {
			keep.delete(kid); // обновляем «свежесть»
			keep.set(kid, prev);
			// уже собран или собирается: ждём тот же результат
			if (prev.job) await prev.job;
			if (want[id] === sig) warm.set(id, sig);
			return;
		}
		const obj = this._warmObj(kind, set);
		const sc = new THREE.Scene();
		sc.add(obj);
		const rec = { sig, mat: obj.material, job: null };
		keep.set(kid, rec);
		// старые наборы выбрасываются, когда их накопилось больше десяти (сам материал освобождается чуть позже)
		for (const [k, r] of keep) {
			if (keep.size <= 10) break;
			if (r.job || k === kid) continue;
			keep.delete(k);
			setTimeout(() => r.mat.dispose(), 1500);
		}
		rec.job = (async () => {
			await null; // сборка начинается после текущего кадра, а не посреди него
			try {
				await this._warmScene(sc, this.app.viewport.camera, rt);
			} catch (e) {
				/* не обязательно: при первом показе программа соберётся как раньше */
			}
			if (want[id] === sig) warm.set(id, sig);
			rec.job = null;
			this.app.viewport.invalidate();
		})();
		await rec.job;
	}

	/**
	 * Объект с тяжёлым собственным шейдером (связи, осциллограф) показывается только когда его программа уже собрана: пока она собирается в фоне, он скрыт, а интерфейс не замирает.
	 * Раньше такой объект появлялся сразу, и первый кадр с ним ждал драйвер секундами.
	 */
	_gate(kind, want) {
		if (!want) return false;
		if (this._glDormant) {
			// пока облако рисует WebGPU, шейдер точек WebGL не нужен; всё остальное будит WebGL
			if (kind.startsWith('vert')) return true;
			const g = this.backend?.gpuMesh?.(kind);
			if (g !== undefined) return g;
			this.backend?.wakeGl?.();
		}
		(this._wantT || (this._wantT = {}))[kind] = performance.now();
		const sig = this._fxSig();
		const id = kind + (this._curTgt() ? '@r' : '@s');
		if (!this._warm || this._warm.get(id) !== sig) {
			const k = this._keep && this._keep.get(id + '#' + sig);
			if (!(k && k.job)) this._warmKind(kind, this._fxCur);
			return false;
		}
		return true;
	}

	/**
	 * Переход между выводом на экран и в буфер (включили или выключили свечение, обратную связь и т. п.): сцена продолжает рисоваться по-старому,
	 * пока в фоне собираются программы нового варианта, и переключается, когда они готовы.
	 */
	_tgtSync() {
		const want = this._postOn();
		if (want === !!this._tgtRT) return;
		const sig = this._fxSig();
		let ready = true;
		// остальные объекты сцены (сетка, оси и т. п.) тоже имеют свою программу под каждый вариант вывода
		const tw = this._tgtWarm || (this._tgtWarm = {});
		const sk = want ? 'r' : 's';
		if (tw[sk] !== 2) {
			ready = false;
			if (!tw[sk]) {
				tw[sk] = 1;
				this._warmScene(this.app.viewport.scene, this.app.viewport.camera, want).then(() => (tw[sk] = 2));
			}
		}
		for (const k of this._warmKinds()) {
			if (!this._warm || this._warm.get(k + (want ? '@r' : '@s')) !== sig) {
				ready = false;
				this._warmKind(k, this._fxCur, want);
			}
		}
		if (ready) this._tgtRT = want;
	}

	_fxSwap() {
		if (!this.points) return;
		this.points.traverse((o) => {
			const m = o.material;
			const k = m && m.userData && m.userData.fxKind;
			if (k) {
				m.vertexShader = this._fxSource(k, this._fxCur);
				m.needsUpdate = true;
			}
		});
		this.app.viewport.invalidate();
	}

	/** Заранее собирает шейдер эффектов, пока вы работаете в редакторе: первый вход в «Эффекты» не подвисает на компиляции (на Windows она идёт секунды) */
	async prewarm() {
		if (this.active) return;
		// облако точек модели тоже считаем заранее: при входе остаётся только построить буферы
		try {
			if (this.hasModel && !this.pm.ready) {
				const saved = this.state.count;
				this.state.count = Math.max(20000, Math.min(2000000, this.app.settings.point.surfaceCount));
				// тихий режим: подготовка идёт в фоне и не должна показывать окно загрузки (раньше оно оставалось на экране навсегда)
				this._quiet = true;
				try {
					await this._cloudFor('model');
				} finally {
					this.state.count = saved;
					this._quiet = false;
				}
			}
		} catch (e) {
			/* не обязательно */
		}
		try {
			// материал остаётся в списке удерживаемых: программа не выбрасывается из кеша, и настоящий материал берёт её готовой (в экран и в буфер)
			await this._warmKind(this._vertKind(), this._fxCur || new Set(), this._postOn());
		} catch (e) {
			/* подготовка не обязательна */
		}
	}
}
