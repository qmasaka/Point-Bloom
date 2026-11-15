export function waitPrograms(renderer, mats) {
	return new Promise((resolve) => {
		const t0 = performance.now();
		const check = () => {
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
