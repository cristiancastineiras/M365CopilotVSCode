import * as vscode from 'vscode';

/**
 * M365 Copilot / BizChat selects a model through the `tone` field of the chat
 * invocation, not a model id. The available tones vary by tenant and ring, so
 * the "Auto" model deliberately reuses whatever tone the web app captured (see
 * client.ts); the named ones override it. If a ring rejects a named tone, the
 * Auto model always works because it replays the web app's own choice.
 */
export interface CopilotModel {
	readonly id: string;
	readonly name: string;
	readonly family: string;
	/** `tone` to send, or null to reuse the captured template's tone. */
	readonly tone: string | null;
	readonly detail: string;
}

export const MODELS: readonly CopilotModel[] = [
	{
		id: 'ms365-copilot-auto',
		name: 'M365 Copilot (Auto)',
		family: 'm365-copilot',
		tone: null,
		detail: 'Enrutado automático de Microsoft 365 Copilot (recomendado).',
	},
	{
		id: 'ms365-copilot-gpt',
		name: 'M365 Copilot · GPT',
		family: 'm365-copilot',
		tone: 'Gpt_5_5_Chat',
		detail: 'Fuerza el modelo GPT del backend de Copilot.',
	},
	{
		id: 'ms365-copilot-gpt56',
		name: 'M365 Copilot · GPT 5.6',
		family: 'm365-copilot',
		tone: 'Gpt_5_6_Chat',
		detail: 'GPT 5.6 (respuestas rápidas) — el modelo preferido de M365 Copilot desde julio de 2026.',
	},
	{
		id: 'ms365-copilot-gpt56-reasoning',
		name: 'M365 Copilot · GPT 5.6 Reasoning',
		family: 'm365-copilot',
		tone: 'Gpt_5_6_Reasoning',
		detail: 'GPT 5.6 en modo razonamiento («Think deeper»): respuestas más elaboradas para trabajo difícil.',
	},
	{
		id: 'ms365-copilot-claude',
		name: 'M365 Copilot · Claude Sonnet',
		family: 'm365-copilot',
		tone: 'Claude_Sonnet',
		detail: 'Fuerza Claude Sonnet en el backend de Copilot.',
	},
	{
		id: 'ms365-copilot-reasoning',
		name: 'M365 Copilot · Reasoning',
		family: 'm365-copilot',
		tone: 'Gpt_5_5_Reasoning',
		detail: 'Modo de razonamiento (más lento, respuestas más elaboradas).',
	},
];

const MAX_INPUT_TOKENS = 128_000;
const MAX_OUTPUT_TOKENS = 16_000;

export function findModel(id: string): CopilotModel | undefined {
	return MODELS.find((m) => m.id === id);
}

/**
 * Extra fields Copilot Chat reads from a model's information that are not (yet)
 * on the stable `LanguageModelChatInformation` type. They live in the same
 * proposed-API bucket, so we attach them via a cast — exactly what the
 * minimax / deepseek BYOK providers do.
 *
 * - `isUserSelectable` — WITHOUT this the model is registered (and shows in
 *   "Manage Models") but Copilot Chat never offers it in the in-chat model
 *   picker. This is the field that makes the picker list our models.
 * - `isBYOK` — tokens are billed to the user's M365 plan, not Copilot's
 *   premium-request quota, so Copilot must not count the round-trip against
 *   its own budget.
 */
type PickerChatInformation = vscode.LanguageModelChatInformation & {
	readonly isUserSelectable: boolean;
	readonly isBYOK?: true;
	readonly statusIcon?: vscode.ThemeIcon;
};

/** Build the model information VS Code renders in the picker. */
export function toChatInformation(
	model: CopilotModel,
	hasProfile: boolean,
): vscode.LanguageModelChatInformation {
	const info: PickerChatInformation = {
		id: model.id,
		name: model.name,
		family: model.family,
		version: '1.0.0',
		maxInputTokens: MAX_INPUT_TOKENS,
		maxOutputTokens: MAX_OUTPUT_TOKENS,
		detail: hasProfile ? model.detail : 'Pega tu token de M365 Copilot para activarlo.',
		tooltip: model.detail,
		// This is what surfaces the model in the in-chat picker (not just in
		// "Manage Models").
		isUserSelectable: true,
		isBYOK: true,
		statusIcon: hasProfile ? undefined : new vscode.ThemeIcon('warning'),
		capabilities: {
			// We advertise tool calling so the models also appear in the default
			// Agent/Edit chat mode (which filters out models without it). BizChat
			// has no native tool execution: the calls are a text protocol we
			// describe in the prompt and decode from the reply (see
			// toolProtocol.ts), covering both our tools and the editor's own —
			// so the agent loop does work, one tool call per turn.
			toolCalling: true,
			imageInput: false,
		},
	};
	return info;
}
