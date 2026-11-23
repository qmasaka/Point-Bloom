import { readFileSync, readdirSync, statSync } from 'node:fs';
import { SourceTextModule } from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('../web/', import.meta.url));
const source = join(root, 'src');
const entry = join(source, 'main.js');
const errors = [];
let checked = 0;

if (!statSync(entry, { throwIfNoEntry: false })?.isFile()) errors.push('Missing entry point: web/src/main.js');
for (const file of readdirSync(source, { recursive: true, withFileTypes: true })) {
	if (!file.isFile() || !file.name.endsWith('.js')) continue;
	const filename = join(file.parentPath ?? file.path, file.name);
	const name = 'web/' + relative(root, filename).replaceAll('\\', '/');
	const url = pathToFileURL(filename);
	try {
		const module = new SourceTextModule(readFileSync(filename, 'utf8'), { identifier: url.href });
		const imports = module.moduleRequests?.map((request) => request.specifier) ?? module.dependencySpecifiers;
		for (const specifier of imports) {
			if (!specifier.startsWith('./') && !specifier.startsWith('../') && !specifier.startsWith('/')) continue;
			const target = specifier.startsWith('/') ? new URL(specifier.slice(1), pathToFileURL(root)) : new URL(specifier, url);
			if (!statSync(fileURLToPath(target), { throwIfNoEntry: false })?.isFile()) errors.push(name + ' imports missing file ' + specifier);
		}
		checked++;
	} catch (error) {
		errors.push(name + ': ' + error.message);
	}
}

if (errors.length) {
	console.error(errors.join('\n'));
	process.exitCode = 1;
} else console.log('Checked static imports in ' + checked + ' web modules.');
