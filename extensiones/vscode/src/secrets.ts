import * as vscode from 'vscode';
import { parsePastedProfile, type CopilotProfile } from './profile';

const SECRET_KEY = 'ms365copilot.profile.v1';

/**
 * Stores the captured Copilot profile in VS Code SecretStorage (encrypted,
 * per-machine) and notifies listeners when it changes so the model picker can
 * refresh its warning state.
 */
export class ProfileStore {
	private cached: CopilotProfile | null | undefined;
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changeEmitter.event;

	constructor(private readonly secrets: vscode.SecretStorage) {
		// Cross-window sync: another window writing the secret should refresh
		// this window's cache and picker.
		this.disposable = secrets.onDidChange((e) => {
			if (e.key === SECRET_KEY) {
				this.cached = undefined;
				this.changeEmitter.fire();
			}
		});
	}

	private readonly disposable: vscode.Disposable;

	async get(): Promise<CopilotProfile | null> {
		if (this.cached !== undefined) return this.cached;
		const raw = await this.secrets.get(SECRET_KEY);
		if (!raw) {
			this.cached = null;
			return null;
		}
		try {
			this.cached = JSON.parse(raw) as CopilotProfile;
		} catch {
			this.cached = null;
		}
		return this.cached;
	}

	async has(): Promise<boolean> {
		return (await this.get()) !== null;
	}

	/** Parse and store a pasted profile/token. Returns the normalized profile. */
	async setFromPaste(pasted: string): Promise<CopilotProfile> {
		const profile = parsePastedProfile(pasted);
		await this.secrets.store(SECRET_KEY, JSON.stringify(profile));
		this.cached = profile;
		this.changeEmitter.fire();
		return profile;
	}

	async clear(): Promise<void> {
		await this.secrets.delete(SECRET_KEY);
		this.cached = null;
		this.changeEmitter.fire();
	}

	dispose(): void {
		this.disposable.dispose();
		this.changeEmitter.dispose();
	}
}
