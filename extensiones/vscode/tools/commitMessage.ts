/**
 * Validación (sin `vscode`, igual que `gitArgs.ts`) del mensaje que
 * `ms365_git_commit` va a usar. No reescribe nada: quien redacta el mensaje
 * de verdad es el modelo que llama a la herramienta —con el diff que le da
 * `ms365_generate_commit_message` como contexto—, así que un mensaje mal
 * formado es un error a corregir (misma filosofía que el resto de
 * herramientas: "si falla, lee el error y corrige la llamada"), no algo que
 * esta función deba arreglar en silencio.
 */

/** Tipos de Conventional Commits (https://www.conventionalcommits.org/). */
export const CONVENTIONAL_COMMIT_TYPES = [
	'feat',
	'fix',
	'docs',
	'style',
	'refactor',
	'perf',
	'test',
	'build',
	'ci',
	'chore',
	'revert',
] as const;

const MAX_MESSAGE_CHARS = 8_000;
const MAX_SUBJECT_CHARS = 100;

const SUBJECT_RE = new RegExp(
	`^(${CONVENTIONAL_COMMIT_TYPES.join('|')})(\\([\\w./-]+\\))?(!)?: .{1,${MAX_SUBJECT_CHARS}}$`,
);

/**
 * Comprueba que `raw` sea un mensaje de commit no vacío cuya primera línea
 * siga Conventional Commits, y devuelve el mensaje recortado (fin de línea
 * normalizado a `\n`, sin espacio sobrante en los bordes). Lanza con un
 * mensaje de error accionable en caso contrario.
 */
export function validateConventionalCommitMessage(raw: unknown): string {
	if (typeof raw !== 'string' || !raw.trim()) {
		throw new Error('message no puede estar vacío.');
	}
	const message = raw.replace(/\r\n/g, '\n').trim();
	if (message.length > MAX_MESSAGE_CHARS) {
		throw new Error(`message supera el límite de ${MAX_MESSAGE_CHARS} caracteres.`);
	}

	const subject = message.split('\n', 1)[0];
	if (!SUBJECT_RE.test(subject)) {
		throw new Error(
			'La primera línea de message no sigue Conventional Commits: debe ser ' +
				'"tipo(ámbito opcional)!: resumen en imperativo" ' +
				`(tipos válidos: ${CONVENTIONAL_COMMIT_TYPES.join(', ')}). ` +
				`Ejemplo: "fix(auth): evitar token nulo en refresh". Recibido: "${subject.slice(0, MAX_SUBJECT_CHARS)}".`,
		);
	}
	if (subject.endsWith('.')) {
		throw new Error('La primera línea no debe terminar en punto (Conventional Commits).');
	}

	return message;
}
