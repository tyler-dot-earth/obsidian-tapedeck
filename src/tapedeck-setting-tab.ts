import { homedir } from 'node:os'

import { Option, Schema } from 'effect'
import { type App, Plugin, PluginSettingTab, type SettingDefinitionItem } from 'obsidian'

import {
	type TapedeckPluginSettingsHost,
	isTapedeckSettingKey,
	resolveTapedeckSettings,
	withTapedeckSetting,
} from '#/src/tapedeck-plugin-settings'
import { defaultSourceDirectory } from '#/src/tapedeck-session-files'
import { claudeCodeSource } from '#/src/tapedeck-source-claude-code'
import { codexSource } from '#/src/tapedeck-source-codex'
import { piSource } from '#/src/tapedeck-source-pi'

/** Plugin settings tab: where the tapes live, how notes come out, what gets blurred. */
export class TapedeckSettingTab extends PluginSettingTab {
	private readonly settingsHost: TapedeckPluginSettingsHost

	constructor(app: App, plugin: Plugin, settingsHost: TapedeckPluginSettingsHost) {
		super(app, plugin)
		this.settingsHost = settingsHost
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		const home = homedir()

		return [
			{
				name: '📺 Sources',
				desc: 'Where each agent keeps its session files. Empty means the default for this OS.',
			},
			{
				name: 'Claude Code sessions',
				desc: 'Folder of project folders with <session-id>.jsonl files.',
				control: {
					type: 'text',
					key: 'claudeCodeDirectory',
					placeholder: defaultSourceDirectory(claudeCodeSource, home),
				},
			},
			{
				name: 'Codex CLI sessions',
				desc: 'Folder with YYYY/MM/DD/rollout-*.jsonl files.',
				control: {
					type: 'text',
					key: 'codexDirectory',
					placeholder: defaultSourceDirectory(codexSource, home),
				},
			},
			{
				name: 'Pi sessions',
				desc: 'Folder of --<cwd>-- folders with <time>_<id>.jsonl files.',
				control: {
					type: 'text',
					key: 'piDirectory',
					placeholder: defaultSourceDirectory(piSource, home),
				},
			},
			{
				name: 'Recent sessions to list',
				desc: 'How many tapes Import recent sessions shows.',
				control: { type: 'number', key: 'recentCount', placeholder: '10' },
			},
			{ name: '🏷️ Notes', desc: 'How a transcript lands in the vault.' },
			{
				name: 'Import folder',
				desc: 'Created if missing.',
				control: { type: 'folder', key: 'importFolder', placeholder: 'Transcripts' },
			},
			{
				name: 'Filename pattern',
				desc: 'Tokens: {date} {time} {harness} {session} {title}.',
				control: { type: 'text', key: 'filenamePattern', placeholder: '{date} {harness} {title}' },
			},
			{
				name: 'Note style',
				desc: 'Raw keeps every tool call. Summary keeps the conversation and lists tools per turn.',
				control: {
					type: 'dropdown',
					key: 'noteStyle',
					options: { raw: 'Raw', summary: 'Summary' },
				},
			},
			{
				name: 'Fold tool calls',
				desc: 'Tool callouts start collapsed.',
				control: { type: 'toggle', key: 'foldToolCalls' },
			},
			{
				name: 'Tool output',
				desc: 'Full keeps everything. Truncated keeps the first lines.',
				control: {
					type: 'dropdown',
					key: 'toolOutput',
					options: { full: 'Full', truncated: 'Truncated', none: 'None' },
				},
			},
			{
				name: 'Truncate after lines',
				desc: 'Used when tool output is Truncated.',
				control: { type: 'number', key: 'truncateLines', placeholder: '40' },
			},
			{
				name: 'Include thinking',
				desc: 'Keep stored model reasoning in a folded quote.',
				control: { type: 'toggle', key: 'includeThinking' },
			},
			{
				name: '✂️ Redaction',
				desc: 'Applied to the whole note at import. Basic patterns, not a guarantee.',
			},
			{
				name: 'Home folder as ~',
				desc: 'Rewrite your home directory path to ~.',
				control: { type: 'toggle', key: 'redactHomePaths' },
			},
			{
				name: 'Mask secrets',
				desc: 'API keys, tokens, bearer headers, private keys, and key=value secrets become [REDACTED].',
				control: { type: 'toggle', key: 'redactSecrets' },
			},
		]
	}

	override getControlValue(key: string): unknown {
		if (!isTapedeckSettingKey(key)) {
			return undefined
		}

		return resolveTapedeckSettings(this.settingsHost.settings)[key]
	}

	override setControlValue(key: string, value: unknown): void {
		if (!isTapedeckSettingKey(key)) {
			return
		}

		const json = Schema.decodeUnknownOption(Schema.Json)(
			typeof value === 'string' ? value.trim() : value,
		)

		if (Option.isNone(json)) {
			return
		}

		this.settingsHost.settings = withTapedeckSetting(this.settingsHost.settings, key, json.value)
		void this.settingsHost.saveTapedeckPluginSettings()
	}
}
