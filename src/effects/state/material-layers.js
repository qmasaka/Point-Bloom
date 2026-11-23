export const MATERIAL_LAYERS = [
	{
		id: 'inners', group: 'Эксперименты', name: 'Внутренности', icon: 'cube-transparent',
		hint: 'Линии заполняют объём формы. «Экран» окрашивает их кадром.',
		sound: false, noAmount: true, max: 1, def: { on: false, amount: 1, mode: 'flow', density: 0.53, complexity: 0.55, shell: 'hide' },
		extras: [
			{ key: 'mode', label: 'Рисунок', type: 'select', options: [['flow', 'Течение'], ['orbit', 'Орбиты'], ['growth', 'Ветвление'], ['weave', 'Переплетение']] },
			{ key: 'density', label: 'Плотность', min: 0, max: 1, step: 0.01 },
			{ key: 'complexity', label: 'Сложность', min: 0, max: 1, step: 0.01 },
			{ key: 'shell', label: 'Оболочка', type: 'seg', options: [['show', 'Видна'], ['hide', 'Скрыта']] },
		],
	},
	{
		id: 'affinity', group: 'Видео', name: 'Родство', icon: 'share-network',
		hint: 'Объединяет участки видео, которые движутся одинаково. Нужен движущийся кадр.',
		sound: false, noAmount: true, max: 1, def: { on: false, amount: 1, mode: 'clusters', similarity: 0.56, strength: 0.65, source: 'hide' },
		extras: [
			{ key: 'mode', label: 'Рисунок', type: 'seg', options: [['clusters', 'Скопления'], ['filaments', 'Нити']] },
			{ key: 'similarity', label: 'Сходство', min: 0, max: 1, step: 0.01 },
			{ key: 'strength', label: 'Сила', min: 0, max: 1, step: 0.01 },
			{ key: 'source', label: 'Исходник', type: 'seg', options: [['show', 'Виден'], ['hide', 'Скрыт']] },
		],
	},
	{
		id: 'temporalFabric', group: 'Анимация', name: 'Ткань движения', icon: 'waves',
		hint: 'Нити и полотна соединяют позы анимированной модели. След можно рассмотреть на паузе.',
		sound: false, noAmount: true, max: 1, def: { on: false, amount: 1, mode: 'ribbons', history: 1.8, density: 0.52 },
		extras: [
			{ key: 'mode', label: 'Рисунок', type: 'seg', options: [['threads', 'Нити'], ['ribbons', 'Ленты'], ['membrane', 'Полотно']] },
			{ key: 'history', label: 'История', min: 0.25, max: 4, step: 0.05, noNorm: true, unit: 'с' },
			{ key: 'density', label: 'Плотность', min: 0, max: 1, step: 0.01 },
		],
	},
	{
		id: 'voidPrint', group: 'Видео', name: 'Отпечаток пустоты', icon: 'intersect',
		hint: 'Движущийся силуэт прорезает объём. Отпечаток остаётся после паузы и удаления видео.',
		sound: false, noAmount: true, max: 1, def: { on: false, amount: 1, mode: 'print', depth: 0.72, history: 2.4 },
		extras: [
			{ key: 'mode', label: 'Режим', type: 'seg', options: [['cut', 'Вырез'], ['print', 'Отпечаток'], ['negative', 'Негатив']] },
			{ key: 'depth', label: 'Глубина', min: 0.08, max: 1, step: 0.01 },
			{ key: 'history', label: 'История', min: 0.4, max: 4, step: 0.05, noNorm: true, unit: 'с', when: ['mode', ['print', 'negative']] },
			{ type: 'button', label: 'Очистить отпечаток', icon: 'broom', act: 'clearVoidPrint' },
		],
	},
];
