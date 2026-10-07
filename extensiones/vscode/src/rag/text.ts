/**
 * Text handling of the project index (RAG): how code and questions become
 * search terms, which files are not worth indexing, and exclude globs.
 *
 * Terms are identifiers split the way code is written — `getHTTPResponse` →
 * `gethttpresponse`, `get`, `http`, `response` — case- and accent-folded and
 * with a light plural cut, so `tokens` finds `token` and `Configuración`
 * finds `configuracion`. Questions are often in Spanish while code is in
 * English, so query words get a small Spanish → English expansion.
 *
 * Kept free of the `vscode` import so the tests can exercise all of it.
 */

/** Lowercase, without accents: `Configuración` → `configuracion`. */
export function foldCase(text: string): string {
	return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** `getHTTPResponse_code` → `get`, `HTTP`, `Response`, `code`. */
export function splitIdentifier(word: string): string[] {
	return word
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.split(/[\s_$-]+/)
		.filter(Boolean);
}

/** One search term: folded, and without a plain plural `s` (`tokens` → `token`). */
export function normalizeTerm(term: string): string {
	const folded = foldCase(term);
	if (folded.length > 4 && folded.endsWith('ies')) return `${folded.slice(0, -3)}y`;
	if (folded.length > 3 && folded.endsWith('s') && !/(ss|us|is)$/.test(folded)) return folded.slice(0, -1);
	return folded;
}

const WORD_RE = /[A-Za-z0-9_$À-ɏ]+/g;
/** Longer "words" are hashes, base64 or minified noise. */
const MAX_WORD_CHARS = 64;

/** Every term of a text: each identifier whole and split into its parts. */
export function tokenize(text: string): string[] {
	const terms: string[] = [];
	for (const match of text.matchAll(WORD_RE)) {
		const word = match[0];
		if (word.length > MAX_WORD_CHARS) continue;
		const parts = splitIdentifier(word);
		if (parts.length > 1) {
			const whole = normalizeTerm(word.replace(/[_$-]/g, ''));
			if (isIndexable(whole)) terms.push(whole);
		}
		for (const part of parts) {
			const term = normalizeTerm(part);
			if (isIndexable(term)) terms.push(term);
		}
	}
	return terms;
}

/** Term → occurrences. */
export function termFrequencies(text: string): Map<string, number> {
	const counts = new Map<string, number>();
	for (const term of tokenize(text)) counts.set(term, (counts.get(term) ?? 0) + 1);
	return counts;
}

function isIndexable(term: string): boolean {
	return term.length >= 2 && !/^\d+$/.test(term) && !STOPWORDS.has(term);
}

/**
 * Words that carry no meaning for finding code: English and Spanish function
 * words, the keywords every language repeats, and question words.
 */
const STOPWORDS: ReadonlySet<string> = new Set(
	(
		// English
		'the a an and or of to in is it its for on with as at by be been this that these those from are was were ' +
		'if then else not no yes do does did can could should would will shall may might must has have had ' +
		'which what who whom whose where when why how there here than so such too very just also only all any ' +
		'some each every other into onto out over under about after before again more most less our your their ' +
		'we you they he she him her them me my mine us i am get got use used using via per etc ' +
		// keywords
		'const let var function return import export default class new this self true false null nil none ' +
		'undefined void async await public private protected static readonly def elif fn func pub mut impl ' +
		'struct package namespace end begin then fi esac done case break continue switch try catch finally ' +
		'throw throws while for each foreach do in of instanceof typeof extends implements require module ' +
		'string number boolean int float double char long short byte bool str any unknown object array ' +
		// Spanish
		'el la lo los las un una uno unos unas de del al y o u e ni que en se su sus por para con sin sobre ' +
		'entre hasta desde hacia como mas pero si no ya le les me mi mis te tu tus nos os este esta esto estos ' +
		'estas ese esa eso esos esas aquel aquella otro otra otros otras mismo misma todo toda todos todas ' +
		'muy mucho poco tan tanto cual cuales quien quienes donde cuando cuanto porque pues aunque tambien ' +
		'hay ser es son era fue sea estar esta estan estoy he ha han hemos habia puedo puedes puede pueden ' +
		'hacer hace hago haz quiero quieres necesito dime explica explicame explicar cosa cosas algo nada ' +
		'funciona funcionan sirve parte forma manera ver vez veces aqui alli ahi asi bien mal ok'
	).split(' '),
);

/**
 * Spanish (folded) → English terms a codebase uses for the same thing. Not a
 * translator: just the vocabulary people use when asking about code.
 */
const ES_TO_EN: Readonly<Record<string, readonly string[]>> = {
	archivo: ['file'],
	fichero: ['file'],
	carpeta: ['folder', 'directory', 'dir'],
	directorio: ['directory', 'dir', 'folder'],
	guardar: ['save', 'store', 'storage', 'persist'],
	guarda: ['save', 'store', 'storage'],
	guardado: ['saved', 'store', 'storage'],
	almacenar: ['store', 'storage'],
	almacenamiento: ['storage', 'store'],
	leer: ['read', 'load'],
	lee: ['read'],
	cargar: ['load'],
	carga: ['load'],
	escribir: ['write'],
	borrar: ['delete', 'remove', 'clear'],
	eliminar: ['delete', 'remove'],
	crear: ['create', 'new'],
	crea: ['create'],
	actualizar: ['update', 'refresh'],
	actualiza: ['update', 'refresh'],
	buscar: ['search', 'find'],
	busqueda: ['search', 'query'],
	mostrar: ['show', 'display', 'render'],
	muestra: ['show', 'display'],
	pintar: ['render', 'draw'],
	enviar: ['send', 'post'],
	envia: ['send'],
	envio: ['send'],
	recibir: ['receive'],
	recibe: ['receive'],
	usuario: ['user'],
	contrasena: ['password'],
	clave: ['key', 'secret', 'password'],
	secreto: ['secret'],
	sesion: ['session', 'login'],
	iniciar: ['start', 'init', 'login'],
	inicio: ['start', 'init', 'home'],
	arrancar: ['start', 'activate', 'startup'],
	arranque: ['startup', 'activate', 'boot'],
	conexion: ['connection', 'connect', 'socket'],
	conectar: ['connect'],
	servidor: ['server'],
	cliente: ['client'],
	peticion: ['request'],
	solicitud: ['request'],
	respuesta: ['response', 'reply', 'answer'],
	error: ['error', 'exception'],
	fallo: ['error', 'fail', 'failure'],
	falla: ['fail', 'error'],
	prueba: ['test', 'spec'],
	test: ['test', 'spec'],
	configuracion: ['config', 'configuration', 'setting', 'option'],
	ajuste: ['setting', 'config', 'option'],
	opcion: ['option', 'setting'],
	idioma: ['language', 'locale', 'i18n'],
	traduccion: ['translation', 'i18n', 'locale'],
	traducir: ['translate', 'i18n'],
	modelo: ['model'],
	mensaje: ['message'],
	comando: ['command'],
	herramienta: ['tool'],
	boton: ['button'],
	ventana: ['window'],
	pantalla: ['screen', 'view'],
	vista: ['view'],
	lista: ['list'],
	registro: ['log', 'register', 'record'],
	navegador: ['browser'],
	pagina: ['page'],
	enlace: ['link', 'url'],
	ruta: ['path', 'route'],
	red: ['network'],
	internet: ['web', 'internet', 'http'],
	web: ['web', 'http'],
	datos: ['data'],
	dato: ['data'],
	tabla: ['table'],
	consulta: ['query'],
	fecha: ['date'],
	hora: ['time', 'hour'],
	tiempo: ['time', 'timeout'],
	cola: ['queue'],
	evento: ['event'],
	estado: ['state', 'status'],
	cerrar: ['close'],
	abrir: ['open'],
	cambio: ['change', 'diff'],
	cambiar: ['change'],
	historial: ['history'],
	seguridad: ['security', 'auth'],
	autenticacion: ['auth', 'authentication', 'login'],
	permiso: ['permission'],
	codigo: ['code'],
	funcion: ['function'],
	clase: ['class'],
	tipo: ['type'],
	interfaz: ['interface', 'ui'],
	imagen: ['image'],
	icono: ['icon'],
	estilo: ['style', 'css'],
	plantilla: ['template'],
	componente: ['component'],
	correo: ['email', 'mail'],
	notificacion: ['notification', 'notify'],
	aviso: ['warning', 'notification', 'alert'],
	rendimiento: ['performance'],
	memoria: ['memory', 'cache'],
	proceso: ['process'],
	tarea: ['task', 'job'],
	flujo: ['flow', 'pipeline'],
	paso: ['step'],
	compilar: ['build', 'compile'],
	compilacion: ['build', 'compile'],
	desplegar: ['deploy', 'release'],
	despliegue: ['deploy', 'release'],
	publicar: ['publish', 'release'],
	version: ['version', 'release'],
	paquete: ['package'],
	dependencia: ['dependency'],
	importar: ['import'],
	exportar: ['export'],
	validar: ['validate', 'validation'],
	validacion: ['validation', 'validate'],
	formato: ['format'],
	depurar: ['debug'],
	comprobar: ['check', 'verify'],
	verificar: ['verify', 'check'],
	cuenta: ['account'],
	perfil: ['profile'],
	captura: ['capture'],
	capturar: ['capture'],
	caducidad: ['expiry', 'expire', 'exp'],
	caduca: ['expire', 'expiry'],
	renovar: ['renew', 'refresh'],
	extension: ['extension'],
	sincronizar: ['sync'],
	sincronizacion: ['sync'],
	revisar: ['review'],
	revision: ['review'],
	editar: ['edit'],
	edicion: ['edit'],
	completado: ['completion'],
	autocompletado: ['completion', 'inline'],
	antiguo: ['legacy', 'old'],
	viejo: ['old', 'legacy'],
	nuevo: ['new'],
	migrar: ['migrate', 'migration'],
	participante: ['participant'],
	agente: ['agent'],
	subagente: ['subagent'],
	comentario: ['comment'],
	diferencia: ['diff'],
	raiz: ['root'],
	entrada: ['input', 'entry'],
	salida: ['output', 'exit'],
	pago: ['payment'],
	precio: ['price'],
	producto: ['product'],
	pedido: ['order'],
	factura: ['invoice'],
};

/**
 * English look-alikes of a Spanish word, for words the table above misses:
 * `migracion` → `migration`, `funcion` → `function`, `validar` → `validate`,
 * `participante` → `participant`, `normalizar` → `normalize`. A wrong guess
 * is just a term no file contains.
 */
export function cognates(folded: string): string[] {
	if (folded.length < 5) return [];
	if (folded.endsWith('cion')) {
		const base = folded.slice(0, -4);
		return [`${base}tion`, `${base}ction`];
	}
	if (folded.endsWith('izar')) return [`${folded.slice(0, -4)}ize`];
	if (folded.endsWith('ante') || folded.endsWith('ente')) return [folded.slice(0, -1)];
	if (folded.endsWith('ar')) return [`${folded.slice(0, -2)}ate`];
	if (folded.endsWith('ico')) return [`${folded.slice(0, -3)}ic`];
	return [];
}

export interface QueryTerm {
	readonly term: string;
	/** 1 for the user's own words, less for parts and expansions. */
	readonly weight: number;
	/** A word the user wrote (not a part or an expansion): what "coverage" counts. */
	readonly original: boolean;
}

/**
 * The weighted terms of a question: its identifiers whole (strongest), their
 * parts, and English equivalents of Spanish words.
 */
export function queryTerms(query: string): QueryTerm[] {
	const terms = new Map<string, QueryTerm>();
	const add = (term: string, weight: number, original: boolean) => {
		if (!isIndexable(term)) return;
		const known = terms.get(term);
		if (!known || known.weight < weight) terms.set(term, { term, weight, original: original || Boolean(known?.original) });
	};
	for (const match of query.matchAll(WORD_RE)) {
		const word = match[0];
		if (word.length > MAX_WORD_CHARS) continue;
		const parts = splitIdentifier(word);
		if (parts.length > 1) add(normalizeTerm(word.replace(/[_$-]/g, '')), 1.5, true);
		for (const part of parts) {
			const term = normalizeTerm(part);
			add(term, parts.length > 1 ? 0.8 : 1, parts.length === 1);
			const folded = foldCase(part);
			const known = ES_TO_EN[folded] ?? ES_TO_EN[term];
			for (const english of known ?? []) add(normalizeTerm(english), 0.7, false);
			if (!known && parts.length === 1) for (const guess of cognates(folded)) add(normalizeTerm(guess), 0.5, false);
		}
	}
	return [...terms.values()];
}

/** Files that are never worth indexing, by name. */
const SKIPPED_NAME_RE =
	/(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|composer\.lock|poetry\.lock|Pipfile\.lock|Cargo\.lock|Gemfile\.lock|go\.sum|[^/]*\.min\.(?:js|css)|[^/]*\.map|[^/]*\.snap)$/i;

const BINARY_EXTENSIONS: ReadonlySet<string> = new Set(
	(
		'png jpg jpeg gif webp ico bmp tif tiff svg psd ai sketch fig pdf zip gz tgz tar 7z rar xz bz2 jar war ear ' +
		'exe dll so dylib bin wasm class o obj a lib pyc pyo mp3 mp4 m4a mov avi mkv webm ogg wav flac ttf otf woff ' +
		'woff2 eot vsix xpi crx db sqlite sqlite3 parquet avro pkl npy npz onnx pt h5 ckpt keystore p12 pfx der cer'
	).split(' '),
);

/** Folders skipped even when git tracks them or no exclude names them. */
export const SKIPPED_SEGMENTS: ReadonlySet<string> = new Set([
	'node_modules',
	'.git',
	'.hg',
	'.svn',
	'.venv',
	'venv',
	'__pycache__',
	'.turbo',
	'.next',
	'.nuxt',
	'.output',
	'.wxt',
	'.cache',
	'coverage',
	'.idea',
	'.gradle',
	// Build output of Rust/Maven and .NET (`bin/` is left alone: in Node
	// projects it holds the CLI entry points).
	'target',
	'obj',
]);

/** Whether a file is skipped by its path alone: binary, lock file, minified, map, or in a skipped folder. */
export function isSkippedPath(path: string): boolean {
	if (SKIPPED_NAME_RE.test(path)) return true;
	const segments = path.split('/');
	if (segments.slice(0, -1).some((segment) => SKIPPED_SEGMENTS.has(segment))) return true;
	const name = segments[segments.length - 1];
	const dot = name.lastIndexOf('.');
	return dot > 0 && BINARY_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

/**
 * Bundled, minified or generated text: a "DO NOT EDIT" header, or very long
 * lines. It drowns real code in search results and teaches the model nothing.
 */
export function looksGenerated(text: string): boolean {
	const head = text.slice(0, 600);
	if (/@generated|do not edit|auto-?generated|code generated by/i.test(head)) return true;
	let long = 0;
	let lines = 0;
	let start = 0;
	while (start < text.length && lines < 400) {
		const end = text.indexOf('\n', start);
		const length = (end === -1 ? text.length : end) - start;
		if (length > 1_000) long += 1;
		lines += 1;
		start = end === -1 ? text.length : end + 1;
	}
	return long > 0 && (long >= 3 || lines <= 3 || text.length / lines > 400);
}

/** Whether bytes look binary (a NUL in the first 8 KB). */
export function looksBinary(bytes: Uint8Array): boolean {
	const end = Math.min(bytes.length, 8_192);
	for (let index = 0; index < end; index += 1) if (bytes[index] === 0) return true;
	return false;
}

/**
 * A `files.exclude`-style glob as a regular expression over `/`-separated
 * relative paths: `**`, `*`, `?`, `{a,b}` and `[...]`. A pattern names a file
 * or a folder (`**\/node_modules` excludes everything inside), see {@link isExcluded}.
 */
export function globToRegExp(glob: string): RegExp {
	let source = '';
	let index = 0;
	let braces = 0;
	const pattern = glob.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
	while (index < pattern.length) {
		const char = pattern[index];
		if (char === '*') {
			if (pattern[index + 1] === '*') {
				const slash = pattern[index + 2] === '/';
				source += slash ? '(?:.*/)?' : '.*';
				index += slash ? 3 : 2;
				continue;
			}
			source += '[^/]*';
		} else if (char === '?') {
			source += '[^/]';
		} else if (char === '{') {
			braces += 1;
			source += '(?:';
		} else if (char === '}' && braces > 0) {
			braces -= 1;
			source += ')';
		} else if (char === ',' && braces > 0) {
			source += '|';
		} else if (char === '[') {
			const close = pattern.indexOf(']', index + 1);
			if (close === -1) {
				source += '\\[';
			} else {
				source += `[${pattern.slice(index + 1, close).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`;
				index = close;
			}
		} else {
			source += char.replace(/[.+^$()|\\]/g, '\\$&');
		}
		index += 1;
	}
	return new RegExp(`^${source}$`, process.platform === 'win32' ? 'i' : '');
}

/** Whether `path` or one of its folders matches any of the globs. */
export function isExcluded(path: string, globs: readonly RegExp[]): boolean {
	if (globs.length === 0) return false;
	const segments = path.split('/');
	for (let end = segments.length; end >= 1; end -= 1) {
		const candidate = segments.slice(0, end).join('/');
		if (globs.some((glob) => glob.test(candidate))) return true;
	}
	return false;
}

/** The enabled globs of `files.exclude`-style settings plus a plain list. */
export function excludeGlobs(
	settings: readonly (Record<string, unknown> | undefined)[],
	extra: readonly unknown[] = [],
): RegExp[] {
	const globs = new Set<string>();
	for (const setting of settings) {
		for (const [glob, enabled] of Object.entries(setting ?? {})) if (enabled === true) globs.add(glob);
	}
	for (const glob of extra) if (typeof glob === 'string' && glob.trim()) globs.add(glob.trim());
	return [...globs].map(globToRegExp);
}

const MAX_QUERY_CHARS = 1_500;

/**
 * The part of a chat message worth searching for. Copilot Chat wraps the
 * user's words in its own context (`<attachments>`, `<context>`…) and puts
 * them in `<userRequest>`; anything else is used as is. Tags are dropped and
 * the result is bounded.
 */
export function retrievalQuery(message: string): string {
	const request = /<userRequest>([\s\S]*?)<\/userRequest>/i.exec(message)?.[1] ?? message;
	return request
		.replace(/<\/?[A-Za-z][\w-]*(?:\s[^>]*)?>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, MAX_QUERY_CHARS);
}
