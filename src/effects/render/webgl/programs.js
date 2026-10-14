// Ожидание готовности шейдерных программ WebGL.

/**
 * Ждёт, пока видеодрайвер соберёт ВСЕ программы указанных материалов (в экран и в буфер), не блокируя интерфейс.
 * Встроенный compileAsync у three.js следит только за последней собранной программой материала, а остальные варианты при первом кадре ждут синхронно.
 */
export function waitPrograms(renderer, mats) {
	return new Promise((resolve) => {
		const t0 = performance.now();
		const check = () => {
			// контекст потерян (сброс видеопроцесса): программы уже не соберутся, ждать бессмысленно. После восстановления three.js соберёт всё заново
			if (renderer.getContext().isContextLost()) {
				resolve();
				return;
			}
			let busy = false;
			try {
				for (const m of mats) {
					const progs = renderer.properties.get(m).programs;
					if (!progs) continue;
					for (const p of progs.values()) {
						if (!p.isReady()) {
							busy = true;
							break;
						}
					}
					if (busy) break;
				}
			} catch (e) {
				busy = false;
			}
			if (!busy || performance.now() - t0 > 180000) resolve();
			else setTimeout(check, 16);
		};
		check();
	});
}
