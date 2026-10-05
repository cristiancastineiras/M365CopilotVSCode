import * as vscode from 'vscode';
import { t } from '../src/i18n';

/**
 * Rebanada mínima de la API pública de la extensión Git integrada
 * (`vscode.git`, versión 1) — sólo lo que se usa aquí. VS Code no publica
 * estos tipos junto con `@types/vscode` (haría falta copiar `git.d.ts` del
 * propio repo de vscode como dependencia aparte), así que se declaran a mano
 * las formas exactas que se leen, en vez de tipar todo lo que expone.
 */
interface GitExtensionExports {
	getAPI(version: 1): GitApi;
}

interface GitApi {
	readonly repositories: readonly GitRepository[];
	getRepository(uri: vscode.Uri): GitRepository | null;
}

/** La API de la extensión Git integrada, activándola si hace falta. */
async function getGitApi(): Promise<GitApi> {
	const extension = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
	if (!extension) throw new Error(t('git.extensionMissing'));
	const exports = extension.isActive ? extension.exports : await extension.activate();
	return exports.getAPI(1);
}

/** Todos los repositorios que la extensión Git tiene abiertos ahora mismo. */
export async function listGitRepositories(): Promise<readonly GitRepository[]> {
	return (await getGitApi()).repositories;
}

export interface GitRepository {
	readonly rootUri: vscode.Uri;
	/** El cuadro de mensaje del panel de Source Control para este repo. */
	readonly inputBox: { value: string };
	readonly state: {
		/** Cambios en stage (`git add`) — lo que un commit normal incluiría. */
		readonly indexChanges: readonly unknown[];
		/** Cambios en el árbol de trabajo todavía sin stage. */
		readonly workingTreeChanges: readonly unknown[];
	};
}

/** Cuántas veces reintentar mientras la extensión Git termina de descubrir
 * repositorios justo tras activarse. */
const REPOSITORY_DISCOVERY_ATTEMPTS = 10;
const REPOSITORY_DISCOVERY_DELAY_MS = 200;

/**
 * Resuelve, vía la API nativa, el repositorio que contiene `root`. Se usa
 * SOLO para lo que esa API resuelve mejor que el CLI: disparar el comando
 * `git.generateCommitMessage` sobre el repo exacto y leer/vaciar su input
 * box de Source Control. El resto de operaciones de git de esta extensión
 * sigue yendo por `execFile('git', …)` (ver `git.ts`), que es más simple y no
 * depende de que la extensión Git esté activa.
 */
export async function getGitRepository(root: vscode.Uri): Promise<GitRepository> {
	const api = await getGitApi();

	// Justo tras el arranque de VS Code, los repositorios pueden tardar un
	// instante en aparecer; un reintento corto evita un falso "no es un repo"
	// en ese margen en vez de fallar a la primera.
	for (let attempt = 0; attempt < REPOSITORY_DISCOVERY_ATTEMPTS; attempt += 1) {
		const repository = api.getRepository(root);
		if (repository) return repository;
		if (attempt < REPOSITORY_DISCOVERY_ATTEMPTS - 1) {
			await new Promise((resolve) => setTimeout(resolve, REPOSITORY_DISCOVERY_DELAY_MS));
		}
	}
	throw new Error(t('git.noRepository'));
}
