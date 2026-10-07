/**
 * Coming from the `ms365-copilot-vscode` builds (1.3.0–2.0.0), see legacy.ts:
 *
 *  - their `ms365copilot.*` settings are copied to `m365copilot.*` once per
 *    scope (user settings, and each workspace the first time it is opened);
 *  - if that extension is still installed it is offered for uninstall: both
 *    would listen on the token port and register `@m365` and the models.
 */
import * as vscode from 'vscode';
import { LEGACY_EXTENSION_ID, legacySettingKey, migrateLegacyValue, shouldMigrate } from './legacy';
import { errorMessage } from '../tools/common';
import { t } from './i18n';

const MIGRATED_KEY = 'm365copilot.legacySettingsMigrated';

type Inspected = NonNullable<ReturnType<vscode.WorkspaceConfiguration['inspect']>>;

export async function migrateFromLegacy(context: vscode.ExtensionContext, log: (message: string) => void): Promise<void> {
	try {
		const moved = await migrateSettings(context, log);
		if (moved.length > 0) {
			log(t('log.legacySettingsMigrated', moved.join(', ')));
			void announceMigratedSettings(moved.length);
		}
	} catch (error) {
		log(t('log.legacyMigrationFailed', errorMessage(error)));
	}
	await offerLegacyUninstall();
}

/** The settings this version declares, read from its own package.json. */
function contributedSettingKeys(context: vscode.ExtensionContext): string[] {
	const configuration = (context.extension.packageJSON as { contributes?: { configuration?: unknown } }).contributes
		?.configuration;
	const sections = Array.isArray(configuration) ? configuration : configuration ? [configuration] : [];
	return sections.flatMap((section: { properties?: Record<string, unknown> }) => Object.keys(section?.properties ?? {}));
}

async function migrateSettings(context: vscode.ExtensionContext, log: (message: string) => void): Promise<string[]> {
	const keys = contributedSettingKeys(context);
	const moved: string[] = [];

	// An unregistered key (the old extension is gone) can still be read, just
	// not written — so the old entries stay in settings.json, inert.
	const migrateScope = async (
		config: vscode.WorkspaceConfiguration,
		valueIn: (inspected: Inspected) => unknown,
		target: vscode.ConfigurationTarget,
	) => {
		for (const key of keys) {
			const legacyKey = legacySettingKey(key);
			if (!legacyKey) continue;
			const legacy = config.inspect(legacyKey);
			const current = config.inspect(key);
			const legacyValue = legacy ? valueIn(legacy) : undefined;
			if (!shouldMigrate(legacyValue, current ? valueIn(current) : undefined)) continue;
			try {
				await config.update(key, migrateLegacyValue(legacyValue), target);
				moved.push(key);
			} catch (error) {
				// e.g. a machine-scoped setting found in workspace settings.
				log(t('log.legacySettingSkipped', key, errorMessage(error)));
			}
		}
	};

	if (!context.globalState.get<boolean>(MIGRATED_KEY)) {
		await migrateScope(vscode.workspace.getConfiguration(), (i) => i.globalValue, vscode.ConfigurationTarget.Global);
		await context.globalState.update(MIGRATED_KEY, true);
	}
	const folders = vscode.workspace.workspaceFolders ?? [];
	if (folders.length > 0 && !context.workspaceState.get<boolean>(MIGRATED_KEY)) {
		await migrateScope(
			vscode.workspace.getConfiguration(),
			(i) => i.workspaceValue,
			vscode.ConfigurationTarget.Workspace,
		);
		// Folder settings only differ from workspace settings in a multi-root workspace.
		if (vscode.workspace.workspaceFile) {
			for (const folder of folders) {
				await migrateScope(
					vscode.workspace.getConfiguration(undefined, folder.uri),
					(i) => i.workspaceFolderValue,
					vscode.ConfigurationTarget.WorkspaceFolder,
				);
			}
		}
		await context.workspaceState.update(MIGRATED_KEY, true);
	}
	return moved;
}

async function announceMigratedSettings(count: number): Promise<void> {
	const open = t('migration.openSettings');
	if ((await vscode.window.showInformationMessage(t('migration.settingsMoved', count), open)) === open) {
		await vscode.commands.executeCommand('workbench.action.openSettingsJson');
	}
}

async function offerLegacyUninstall(): Promise<void> {
	if (!vscode.extensions.getExtension(LEGACY_EXTENSION_ID)) return;
	const uninstall = t('migration.uninstall');
	if ((await vscode.window.showWarningMessage(t('migration.legacyInstalled'), uninstall)) !== uninstall) return;
	try {
		await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', LEGACY_EXTENSION_ID);
	} catch (error) {
		void vscode.window.showErrorMessage(t('migration.uninstallFailed', errorMessage(error)));
		return;
	}
	const reload = t('migration.reload');
	if ((await vscode.window.showInformationMessage(t('migration.uninstalled'), reload)) === reload) {
		await vscode.commands.executeCommand('workbench.action.reloadWindow');
	}
}
