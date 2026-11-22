import { z } from "zod";

import {
  ASK_COMMANDS,
  ASK_MODES,
  CLI_COMMAND_IDS,
  DEFAULT_CLI_SETTINGS,
  MAX_ALLOWED_RECIPIENTS,
  normalizeAllowedRecipient,
  SKILL_TARGET_IDS,
  type AskCommand,
  type AskMode,
  type CliSettings,
} from "@shared/cli";

import { reportError } from "../events";
import { migrate } from "../migrate";
import type { SettingsSection } from "../settings-file";

/** The version of the `cli` section of `settings.json`. */
const CLI_SETTINGS_VERSION = 3;

/**
 * Version 2 added how each command that cannot be undone behaves (`ask`) and the recipients that may be
 * sent to without asking (`allowedRecipients`). A version 1 file has neither, and gets the defaults:
 * every such command asks first, and no one is allowed in advance.
 */
const STEPS = {
  1: (payload: unknown): unknown => ({
    ...(payload as Record<string, unknown>),
    ask: structuredClone(DEFAULT_CLI_SETTINGS.ask),
    allowedRecipients: [],
  }),
  /** Version 3 added the link for the terminal (`pathLink`), which is on while the CLI is on unless the person turns it off. */
  2: (payload: unknown): unknown => ({ ...(payload as Record<string, unknown>), pathLink: true }),
} as const;

const askMode = (command: AskCommand) => z.enum(ASK_MODES as unknown as [AskMode, ...AskMode[]]).catch(DEFAULT_CLI_SETTINGS.ask[command]);

/** Each choice is checked on its own, so one bad value does not reset the others. */
const sectionSchema = z.object({
  version: z.number().int().min(1),
  enabled: z.boolean().catch(DEFAULT_CLI_SETTINGS.enabled),
  // A name this version does not know (a command a newer one added) is dropped; the rest is kept.
  disabled: z
    .array(z.unknown())
    .catch([])
    .transform((names) => names.filter((name): name is (typeof CLI_COMMAND_IDS)[number] => CLI_COMMAND_IDS.includes(name as never))),
  ask: z
    .object(Object.fromEntries(ASK_COMMANDS.map((command) => [command, askMode(command)])) as Record<AskCommand, ReturnType<typeof askMode>>)
    // Like every choice here, one that is not readable goes back to its default; only the value is replaced, the rest is kept.
    .catch(structuredClone(DEFAULT_CLI_SETTINGS.ask)),
  allowedRecipients: z
    .array(z.unknown())
    .catch([])
    .transform((entries) =>
      entries.flatMap((entry) => {
        const result = typeof entry === "string" ? normalizeAllowedRecipient(entry) : { error: "" };
        return "value" in result ? [result.value] : [];
      }),
    ),
  hideLinks: z.boolean().catch(DEFAULT_CLI_SETTINGS.hideLinks),
  pathLink: z.boolean().catch(DEFAULT_CLI_SETTINGS.pathLink),
  skillTargets: z
    .array(z.unknown())
    .catch([])
    .transform((names) => names.filter((name): name is (typeof SKILL_TARGET_IDS)[number] => SKILL_TARGET_IDS.includes(name as never))),
});

function defaults(): CliSettings {
  return structuredClone(DEFAULT_CLI_SETTINGS);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function clean(settings: CliSettings): CliSettings {
  return {
    ...settings,
    disabled: unique(settings.disabled),
    skillTargets: unique(settings.skillTargets),
    allowedRecipients: unique(settings.allowedRecipients).slice(0, MAX_ALLOWED_RECIPIENTS),
  };
}

/**
 * What the person allowed the CLI to do, kept in the `cli` section of `settings.json` (no mail data and
 * no secrets). A section that is missing, which is every file written before the CLI existed, means
 * the defaults: off. An older section is upgraded step by step when it is read (version 1 to 2 adds the
 * ask-first choices, 2 to 3 the link for the terminal). A section saved by a newer version of the app is left as it is: the defaults are
 * used, and changes are refused instead of overwriting it.
 */
export class CliSettingsStore {
  private value: CliSettings = defaults();
  private newer = false;

  constructor(private readonly section: SettingsSection) {
    const raw = section.read();
    if (raw === undefined) return;
    try {
      const version = z.object({ version: z.number().int().min(1) }).parse(raw).version;
      if (version > CLI_SETTINGS_VERSION) {
        this.newer = true;
        reportError("storage", "The CLI settings were saved by a newer version of MiniMail; they are left untouched and the CLI stays off");
        return;
      }
      const upgraded = migrate(raw, version, CLI_SETTINGS_VERSION, STEPS);
      const { version: _version, ...saved } = sectionSchema.parse({ ...(upgraded as object), version: CLI_SETTINGS_VERSION });
      this.value = clean(saved);
    } catch (error) {
      reportError("storage", "Could not read the CLI settings; the CLI is off", error);
    }
  }

  get(): CliSettings {
    return structuredClone(this.value);
  }

  set(next: CliSettings): CliSettings {
    if (this.newer) throw new Error("The CLI settings were saved by a newer version of MiniMail, so this change was not saved");
    const stored = clean(next);
    this.section.write({ version: CLI_SETTINGS_VERSION, ...stored });
    this.value = stored;
    return this.get();
  }
}
