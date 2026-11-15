export function mixin(target, ...parts) {
	for (const Part of parts) {
		for (const key of Reflect.ownKeys(Part.prototype)) {
			if (key === 'constructor') continue;
			if (Object.prototype.hasOwnProperty.call(target.prototype, key)) throw new Error('mixin: метод ' + String(key) + ' объявлен дважды');
			Object.defineProperty(target.prototype, key, Object.getOwnPropertyDescriptor(Part.prototype, key));
		}
	}
}
