/**
 * Catálogo de las herramientas disponibles en un turno de chat.
 *
 * VS Code entrega en `ProvideLanguageModelChatResponseOptions.tools` TODAS las
 * herramientas activas para la petición: las nuestras (`m365_*`, registradas
 * con `vscode.lm.registerTool`), las nativas del editor y del chat en modo
 * agente, las de servidores MCP y las de otras extensiones. Antes sólo
 * mirábamos las nuestras y descartábamos el resto, así que con un modelo de
 * M365 Copilot seleccionado el agente se quedaba sin las herramientas del
 * propio VS Code.
 *
 * Este módulo normaliza esa lista heterogénea a algo que se pueda describir en
 * un prompt de texto plano (BizChat no tiene function-calling nativo):
 *   - clasifica cada herramienta por capacidad a partir de su nombre,
 *   - marca duplicados entre las nuestras y las del editor según la política
 *     elegida, para que el modelo no dude entre dos que hacen lo mismo,
 *   - resume el JSON Schema de entrada en una firma corta, y
 *   - recorta el catálogo a un presupuesto de caracteres (en modo agente puede
 *     haber decenas de herramientas y el prompt tiene un límite práctico).
 *
 * A propósito NO importa `vscode`: así se puede probar fuera del host.
 */
import { t } from './i18n';

export const M365_TOOL_NAMES = {
	listFiles: 'm365_list_files',
	readFile: 'm365_read_file',
	searchText: 'm365_search_text',
	applyWorkspaceEdits: 'm365_apply_edits',
	getDiagnostics: 'm365_get_diagnostics',
	gitInfo: 'm365_git_info',
	generateCommitMessage: 'm365_generate_commit_message',
	gitCommit: 'm365_git_commit',
	runCommand: 'm365_run_command',
	searchProject: 'm365_search_project',
	projectMap: 'm365_project_map',
	webSearch: 'm365_web_search',
	spawnAgents: 'm365_spawn_agents',
} as const;

/**
 * Las herramientas de workspace, sin {@link M365_TOOL_NAMES.spawnAgents} —
 * es el catálogo que se le ofrece a un SUB-agente (ver `subagents.ts`): un
 * sub-agente nunca puede delegar a su vez, así que la propia herramienta de
 * delegación queda fuera de su propio catálogo.
 */
export const M365_WORKSPACE_TOOL_NAMES: readonly M365ToolName[] = [
	M365_TOOL_NAMES.searchProject,
	M365_TOOL_NAMES.projectMap,
	M365_TOOL_NAMES.listFiles,
	M365_TOOL_NAMES.readFile,
	M365_TOOL_NAMES.searchText,
	M365_TOOL_NAMES.applyWorkspaceEdits,
	M365_TOOL_NAMES.getDiagnostics,
	M365_TOOL_NAMES.gitInfo,
	M365_TOOL_NAMES.generateCommitMessage,
	M365_TOOL_NAMES.gitCommit,
	M365_TOOL_NAMES.runCommand,
	M365_TOOL_NAMES.webSearch,
];

export type M365ToolName = (typeof M365_TOOL_NAMES)[keyof typeof M365_TOOL_NAMES];

const M365_TOOL_NAME_SET: ReadonlySet<string> = new Set(Object.values(M365_TOOL_NAMES));

export function isM365Tool(name: string): name is M365ToolName {
	return M365_TOOL_NAME_SET.has(name);
}

/**
 * Descripción y ejemplo curados de NUESTRAS herramientas. La descripción que
 * llega en `options.tools` es la de package.json (escrita para modelos con
 * function-calling nativo); estas están afinadas para el protocolo de texto,
 * así que las preferimos cuando la herramienta es nuestra.
 */
interface M365Hint {
	readonly description: string;
	readonly example: Record<string, unknown>;
}

/**
 * Se construye en cada llamada (no es una constante de módulo) para que salga
 * en el idioma activo: el usuario puede cambiar `m365copilot.language` sin
 * recargar la ventana.
 */
function m365Hints(): Readonly<Record<M365ToolName, M365Hint>> {
	return {
		[M365_TOOL_NAMES.listFiles]: {
			description: t('hint.listFiles'),
			example: { path: 'src', maxEntries: 100 },
		},
		[M365_TOOL_NAMES.searchText]: {
			description: t('hint.searchText'),
			example: { query: 'registerCommand', path: 'src', maxResults: 30 },
		},
		[M365_TOOL_NAMES.readFile]: {
			description: t('hint.readFile'),
			example: { path: 'src/extension.ts', startLine: 1, endLine: 180 },
		},
		[M365_TOOL_NAMES.applyWorkspaceEdits]: {
			description: t('hint.applyEdits'),
			example: {
				edits: [
					{
						operation: 'replace',
						path: 'src/example.ts',
						oldText: '@@block:1@@',
						newText: '@@block:2@@',
					},
					{ operation: 'create', path: t('hint.applyEdits.newFile'), content: '@@block:3@@' },
				],
			},
		},
		[M365_TOOL_NAMES.getDiagnostics]: {
			description: t('hint.diagnostics'),
			example: { path: 'src/extension.ts', severity: 'error' },
		},
		[M365_TOOL_NAMES.gitInfo]: {
			description: t('hint.gitInfo'),
			example: { action: 'status' },
		},
		[M365_TOOL_NAMES.generateCommitMessage]: {
			description: t('hint.generateCommitMessage', M365_TOOL_NAMES.gitCommit),
			example: {},
		},
		[M365_TOOL_NAMES.gitCommit]: {
			description: t('hint.gitCommit'),
			example: { message: t('hint.gitCommit.example'), stageAll: true },
		},
		[M365_TOOL_NAMES.runCommand]: {
			description: t('hint.runCommand'),
			example: { command: 'npm test' },
		},
		[M365_TOOL_NAMES.searchProject]: {
			description: t('hint.searchProject'),
			example: { query: t('hint.searchProject.example'), maxResults: 8 },
		},
		[M365_TOOL_NAMES.projectMap]: {
			description: t('hint.projectMap'),
			example: { path: 'src/extension.ts' },
		},
		[M365_TOOL_NAMES.webSearch]: {
			description: t('hint.webSearch'),
			example: { query: t('hint.webSearch.example') },
		},
		[M365_TOOL_NAMES.spawnAgents]: {
			description: t('hint.spawnAgents'),
			example: {
				tasks: [
					{ task: t('hint.spawnAgents.task1'), label: t('hint.spawnAgents.label1') },
					{ task: t('hint.spawnAgents.task2'), label: t('hint.spawnAgents.label2') },
				],
			},
		},
	};
}

/** Reflejo estructural de `vscode.LanguageModelChatTool` (sin depender de `vscode`). */
export interface OfferedTool {
	readonly name: string;
	readonly description?: string;
	readonly inputSchema?: object;
}

export type ToolOrigin = 'm365' | 'editor';

export type ToolCapability =
	| 'context'
	| 'read'
	| 'search'
	| 'list'
	| 'edit'
	| 'create'
	| 'diagnostics'
	| 'terminal'
	| 'git'
	| 'tests'
	| 'web'
	| 'agent'
	| 'other';

/** Qué hacer cuando una herramienta nuestra y una del editor hacen lo mismo. */
export type DuplicatePolicy = 'preferEditor' | 'preferM365' | 'both';

export interface ToolParameter {
	readonly name: string;
	readonly type: string;
	readonly required: boolean;
	readonly description: string;
	readonly enumValues: readonly string[];
}

export interface CatalogEntry {
	readonly name: string;
	readonly origin: ToolOrigin;
	readonly capability: ToolCapability;
	readonly description: string;
	readonly parameters: readonly ToolParameter[];
	/** Ejemplo de `input` curado (sólo para las nuestras), o null. */
	readonly example: Record<string, unknown> | null;
	/** Nombre de la herramienta equivalente que debería usarse antes que ésta. */
	readonly preferInstead: string | null;
}

export interface ToolCatalog {
	/** Herramientas descritas en el prompt, ya ordenadas y recortadas. */
	readonly entries: readonly CatalogEntry[];
	/**
	 * TODOS los nombres que el host ofreció. El decodificador acepta cualquiera
	 * de ellos, incluso si no cupo en el prompt: si el modelo acierta con una
	 * herramienta real por su cuenta, ejecutarla es correcto.
	 */
	readonly callable: ReadonlySet<string>;
	/** Nombres que no cupieron en el presupuesto del prompt. */
	readonly omitted: readonly string[];
	readonly m365Count: number;
	readonly editorCount: number;
	/** Hay alguna herramienta que escribe archivos (nuestra o del editor). */
	readonly hasEditTools: boolean;
}

export interface ToolCatalogOptions {
	/** Describir también las herramientas nativas/MCP. Por defecto sí. */
	readonly includeEditorTools?: boolean;
	readonly duplicates?: DuplicatePolicy;
	readonly maxTools?: number;
	readonly maxChars?: number;
}

const DEFAULT_MAX_TOOLS = 48;
const DEFAULT_MAX_CHARS = 12_000;
const MAX_TOOL_DESC_CHARS = 320;
const MAX_PARAM_DESC_CHARS = 90;
const MAX_PARAMS = 12;
const MAX_ENUM_VALUES = 8;

/**
 * Clasificación por nombre (y descripción como refuerzo). Deliberadamente
 * heurística: los nombres de las herramientas nativas cambian entre versiones
 * de VS Code y de Copilot Chat, así que esto sólo ordena y agrupa el catálogo
 * — nunca decide si una herramienta se puede llamar.
 */
const CAPABILITY_RULES: readonly (readonly [ToolCapability, RegExp])[] = [
	// El índice del proyecto (RAG): no es «otra búsqueda de texto» que
	// deduplicar contra la del editor, sino lo primero que conviene usar.
	['context', /^m365(?:searchproject|projectmap)$/],
	['agent', /spawnagent|subagent|delegat/],
	['terminal', /terminal|runcommand|runinshell|runtask|runscript|shellexec|executeshell/],
	['tests', /test/],
	['diagnostics', /error|problem|diagnostic|lint|compilecheck/],
	// `git(?!hub|lab)`: sin eso, cualquier herramienta MCP de GitHub/GitLab
	// entraría como «git» y competiría con la nuestra, que hace otra cosa.
	['git', /git(?!hub|lab)|scm|sourcecontrol|changedfiles|commit|branch|pullrequest/],
	['web', /fetch|webpage|website|browser|http|openurl|websearch/],
	['edit', /edit|replace|patch|insert|applydiff|writefile|modifyfile/],
	['create', /create|newfile|newworkspace|mkdir|scaffold/],
	['read', /readfile|filecontent|readnotebook|opendocument|getdocument|readtext/],
	['list', /listdir|listfile|directory|folder|filetree|workspacestructure/],
	['search', /search|grep|find|glob|usage|codebase|symbol|reference/],
];

const CAPABILITY_ORDER: readonly ToolCapability[] = [
	'context',
	'read',
	'search',
	'list',
	'edit',
	'create',
	'diagnostics',
	'terminal',
	'git',
	'tests',
	'web',
	'agent',
	'other',
];

/**
 * Capacidades donde dos herramientas son de verdad intercambiables y tiene
 * sentido decir «usa una, no las dos». `git` queda fuera a propósito: lo nativo
 * suele ser «lista de archivos cambiados», que no sustituye a un status/diff/log.
 */
const DEDUPED_CAPABILITIES: ReadonlySet<ToolCapability> = new Set<ToolCapability>([
	'read',
	'search',
	'list',
	'edit',
	'create',
	'diagnostics',
	'terminal',
]);

export function classifyCapability(name: string, description = ''): ToolCapability {
	const haystack = normalizeName(name);
	for (const [capability, pattern] of CAPABILITY_RULES) {
		if (pattern.test(haystack)) return capability;
	}
	// El nombre no dijo nada; probamos con la descripción, que es mucho más
	// ruidosa, así que sólo con las señales más inequívocas.
	const text = description.toLowerCase();
	if (/\bterminal\b|\bshell command\b/.test(text)) return 'terminal';
	if (/\bread\b.*\bfile\b/.test(text)) return 'read';
	if (/\bsearch\b|\bgrep\b/.test(text)) return 'search';
	return 'other';
}

function normalizeName(name: string): string {
	return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function buildToolCatalog(
	offered: readonly OfferedTool[] | undefined,
	options: ToolCatalogOptions = {},
): ToolCatalog {
	const includeEditorTools = options.includeEditorTools ?? true;
	const duplicates = options.duplicates ?? 'preferEditor';
	const maxTools = options.maxTools ?? DEFAULT_MAX_TOOLS;
	const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;

	const hints = m365Hints();
	const callable = new Set<string>();
	const candidates: CatalogEntry[] = [];
	const order = new Map<string, number>();

	for (const tool of offered ?? []) {
		if (!tool || typeof tool.name !== 'string' || !tool.name) continue;
		if (callable.has(tool.name)) continue; // el host puede repetir una herramienta
		callable.add(tool.name);

		const origin: ToolOrigin = isM365Tool(tool.name) ? 'm365' : 'editor';
		if (origin === 'editor' && !includeEditorTools) continue;

		const hint = origin === 'm365' ? hints[tool.name as M365ToolName] : undefined;
		const description = hint?.description ?? shortText(tool.description ?? '', MAX_TOOL_DESC_CHARS);
		order.set(tool.name, order.size);
		candidates.push({
			name: tool.name,
			origin,
			capability: classifyCapability(tool.name, tool.description ?? ''),
			description,
			parameters: parametersOf(tool.inputSchema),
			example: hint?.example ?? null,
			preferInstead: null,
		});
	}

	const marked = markDuplicates(candidates, duplicates);

	// Dos ordenaciones distintas a propósito: para RECORTAR, lo primero que
	// sobra es un duplicado (su equivalente ya está descrito), da igual su
	// capacidad; para MOSTRAR, el catálogo se lee mucho mejor agrupado por
	// capacidad, con la preferida delante de su duplicada.
	const byImportance = [...marked].sort(
		(a, b) => selectionRank(a, order) - selectionRank(b, order),
	);

	const chosen: CatalogEntry[] = [];
	const omitted: string[] = [];
	let used = 0;
	for (const entry of byImportance) {
		const weight = entryWeight(entry);
		if (chosen.length >= maxTools || (chosen.length > 0 && used + weight > maxChars)) {
			omitted.push(entry.name);
			continue;
		}
		chosen.push(entry);
		used += weight;
	}
	const entries = chosen.sort((a, b) => displayRank(a, order) - displayRank(b, order));

	return {
		entries,
		callable,
		omitted,
		m365Count: marked.filter((entry) => entry.origin === 'm365').length,
		editorCount: marked.filter((entry) => entry.origin === 'editor').length,
		hasEditTools: entries.some((entry) => entry.capability === 'edit' || entry.capability === 'create'),
	};
}

/**
 * Marca como secundaria cada herramienta que duplica la capacidad de una del
 * otro origen. No se elimina: si la preferida falla (p. ej. una nativa que
 * exige rutas absolutas en un workspace remoto), el modelo aún tiene la otra.
 */
function markDuplicates(entries: readonly CatalogEntry[], policy: DuplicatePolicy): CatalogEntry[] {
	if (policy === 'both') return [...entries];
	const winnerOrigin: ToolOrigin = policy === 'preferEditor' ? 'editor' : 'm365';

	const preferredByCapability = new Map<ToolCapability, string>();
	for (const entry of entries) {
		if (entry.origin !== winnerOrigin) continue;
		if (!DEDUPED_CAPABILITIES.has(entry.capability)) continue;
		if (!preferredByCapability.has(entry.capability)) {
			preferredByCapability.set(entry.capability, entry.name);
		}
	}

	return entries.map((entry) => {
		if (entry.origin === winnerOrigin) return entry;
		const preferred = preferredByCapability.get(entry.capability);
		return preferred ? { ...entry, preferInstead: preferred } : entry;
	});
}

function capabilityRank(entry: CatalogEntry): number {
	return Math.max(0, CAPABILITY_ORDER.indexOf(entry.capability)) * 1000;
}

/**
 * Orden de recorte: las duplicadas se van antes que cualquier herramienta
 * única. `m365_spawn_agents` es la excepción: va SIEMPRE la primera, pase lo
 * que pase con su capacidad ('agent', la última de {@link CAPABILITY_ORDER}).
 * Sin esto, una sesión de modo agente con muchas herramientas nativas/MCP
 * (fácil pasar de las 48 por defecto, o del presupuesto de caracteres) la
 * dejaba fuera del catálogo descrito con bastante frecuencia — el modelo
 * nunca llegaba a enterarse de que existe, así que nunca podía delegar. Es
 * una única entrada, minúscula frente al presupuesto (~1 KB), así que
 * dejarla pasar siempre no le quita sitio a nada que de verdad lo necesite.
 */
function selectionRank(entry: CatalogEntry, order: ReadonlyMap<string, number>): number {
	if (entry.name === M365_TOOL_NAMES.spawnAgents) return -1;
	const duplicatePenalty = entry.preferInstead ? 100_000 : 0;
	return duplicatePenalty + capabilityRank(entry) + (order.get(entry.name) ?? 0);
}

/** Orden de lectura: agrupadas por capacidad, la preferida antes que su duplicada. */
function displayRank(entry: CatalogEntry, order: ReadonlyMap<string, number>): number {
	return capabilityRank(entry) + (entry.preferInstead ? 500 : 0) + (order.get(entry.name) ?? 0);
}

/** Coste aproximado en caracteres de describir esta herramienta en el prompt. */
function entryWeight(entry: CatalogEntry): number {
	const params = entry.parameters.reduce(
		(total, parameter) =>
			total + parameter.name.length + parameter.type.length + parameter.description.length + 8,
		0,
	);
	const example = entry.example ? JSON.stringify(entry.example).length : 0;
	return entry.name.length + entry.description.length + params + example + 48;
}

// ------------------------------------------------------------- JSON Schema

function parametersOf(schema: object | undefined): ToolParameter[] {
	const root = asRecord(schema);
	const properties = asRecord(root?.properties);
	if (!properties) return [];

	const required = new Set(
		Array.isArray(root?.required)
			? (root.required as unknown[]).filter((name): name is string => typeof name === 'string')
			: [],
	);

	const out: ToolParameter[] = [];
	for (const [name, raw] of Object.entries(properties)) {
		if (out.length >= MAX_PARAMS) break;
		const property = asRecord(raw) ?? {};
		out.push({
			name,
			type: schemaTypeName(property),
			required: required.has(name),
			description: shortText(stringOf(property.description), MAX_PARAM_DESC_CHARS),
			enumValues: enumValuesOf(property),
		});
	}
	return out;
}

function schemaTypeName(property: Record<string, unknown>, depth = 0): string {
	if (depth > 2) return 'any';

	const type = property.type;
	if (typeof type === 'string') {
		if (type === 'array') {
			const items = asRecord(property.items);
			return `array<${items ? schemaTypeName(items, depth + 1) : 'any'}>`;
		}
		return type;
	}
	if (Array.isArray(type)) {
		const names = type.filter((value): value is string => typeof value === 'string');
		if (names.length > 0) return names.join('|');
	}

	for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
		const branches = property[key];
		if (!Array.isArray(branches)) continue;
		const names = branches
			.map((branch) => asRecord(branch))
			.filter((branch): branch is Record<string, unknown> => Boolean(branch))
			.map((branch) => schemaTypeName(branch, depth + 1));
		if (names.length > 0) return [...new Set(names)].join('|');
	}

	if (Array.isArray(property.enum)) return 'string';
	if (property.properties) return 'object';
	return 'any';
}

function enumValuesOf(property: Record<string, unknown>): string[] {
	const values = property.enum;
	if (!Array.isArray(values)) return [];
	return values
		.slice(0, MAX_ENUM_VALUES)
		.map((value) => (typeof value === 'string' ? value : (JSON.stringify(value) ?? '')))
		.filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function stringOf(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/** Colapsa espacios y corta por palabra, para que el catálogo quepa en el prompt. */
export function shortText(value: string, maxChars: number): string {
	const collapsed = value.replace(/\s+/g, ' ').trim();
	if (collapsed.length <= maxChars) return collapsed;
	const cut = collapsed.slice(0, maxChars);
	const lastSpace = cut.lastIndexOf(' ');
	return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
