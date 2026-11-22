import { isFreemail } from "./logos";

/**
 * The MiniMail CLI: what it can do, what the person allowed, and how the page and the main process
 * talk about it. The command list lives here once, so the CLI's `help`, the CLI tab in Settings and
 * the skill that is installed for AI agents all say the same thing.
 */

/** Bumped when a request or an answer changes in a way an older `minimail` script could not read. */
export const CLI_PROTOCOL = 1;

export type CliGroup = "basics" | "read" | "organize" | "drafts" | "ask";

export interface CliGroupDef {
  id: CliGroup;
  title: string;
  description: string;
}

export const CLI_GROUPS: readonly CliGroupDef[] = [
  { id: "basics", title: "Always available", description: "Needed to use the CLI at all. They cannot be turned off." },
  {
    id: "read",
    title: "Read",
    description: "Look at your mail. Nothing changes on screen, and nothing is marked as read.",
  },
  {
    id: "organize",
    title: "Organize",
    description: "Change your mail. Each change is recorded in the Log as \"via CLI\" and can be undone there or with ⌘Z.",
  },
  {
    id: "drafts",
    title: "Drafts",
    description: "Write drafts for you to look over in Drafts. Nothing is sent, and the CLI only changes drafts it wrote itself.",
  },
  {
    id: "ask",
    title: "Ask first",
    description: "These cannot be taken back, so MiniMail asks you before each one with a card in the app. You can turn one off, or allow it without asking.",
  },
];

export interface CliCommandDef {
  id: string;
  group: CliGroup;
  /** How it is typed; `<x>` is required, `[x]` optional. */
  usage: string;
  summary: string;
  /** Cannot be switched off (the CLI would be useless or locked out). */
  always?: boolean;
  /** The `--options` it takes. Anything else is refused, so a typo is not silently ignored. */
  options?: readonly string[];
  /** Options that stand alone (`--unread`) and do not take the word after them as a value. */
  switches?: readonly string[];
  /** Cannot be undone: it is on, off or asks first (`CliSettings.ask`), instead of having a plain switch. */
  ask?: boolean;
}

export const CLI_COMMANDS = [
  { id: "status", group: "basics", always: true, usage: "status", summary: "Whether MiniMail is running, the connected accounts and what this CLI may do." },
  { id: "help", group: "basics", always: true, usage: "help", summary: "This list." },
  { id: "open", group: "basics", always: true, usage: "open <message-id>", summary: "Shows that conversation in the MiniMail window, for the person to read." },
  { id: "undo", group: "basics", always: true, usage: "undo [ref]", summary: "Takes back one of the changes the CLI made (the ref is in its answer); without a ref, the latest." },
  { id: "accounts", group: "read", usage: "accounts", summary: "The connected accounts: address, alias and provider (never a password)." },
  { id: "list", group: "read", options: ["limit", "account", "unread"], switches: ["unread"], usage: "list <folder> [--limit 25] [--account <email>] [--unread]", summary: "Mail in Inbox, Archive, Trash, Spam, Sent, Drafts or Pinned, read from the server." },
  { id: "search", group: "read", options: ["folder", "limit"], usage: "search <query> [--folder inbox,archive] [--limit 25]", summary: "The search box's syntax: from:, to:, subject:, is:, has:, in:, category:, account:, after:, before:." },
  { id: "show", group: "read", options: ["full", "headers"], switches: ["full", "headers"], usage: "show <message-id>... [--full | --headers]", summary: "A message as plain text, shortened unless --full. --headers gives who it is from, the reply-to, whether the sender was verified and the ids, without the text. Marked as untrusted." },
  { id: "refresh", group: "read", usage: "refresh [folder]", summary: "Asks the servers for new mail now and returns what arrived." },
  { id: "wait", group: "read", options: ["folder", "timeout"], usage: "wait <query> [--folder inbox] [--timeout 5m]", summary: "Returns as soon as new mail matches the search, or when the time is up." },
  { id: "categories", group: "read", usage: "categories", summary: "The categories mail is sorted into, with their descriptions." },
  { id: "contacts", group: "read", options: ["limit"], usage: "contacts [text] [--limit 50]", summary: "People you have written to or heard from." },
  { id: "pin", group: "organize", usage: "pin <message-id>...", summary: "Pins the messages to the top of the list." },
  { id: "unpin", group: "organize", usage: "unpin <message-id>...", summary: "Takes the pin off." },
  { id: "mark-read", group: "organize", usage: "mark-read <message-id>...", summary: "Marks the messages as read." },
  { id: "mark-unread", group: "organize", usage: "mark-unread <message-id>...", summary: "Marks the messages as unread." },
  { id: "category", group: "organize", usage: "category <name|none> <message-id>...", summary: "Files the conversations under a category, or under none." },
  { id: "priority", group: "organize", options: ["remove", "thread"], switches: ["remove", "thread"], usage: "priority <address|@domain>... [--remove]   or   priority --thread <message-id>... [--remove]", summary: "Marks senders, domains or conversations as priority, or takes the mark off." },
  { id: "mute", group: "organize", options: ["remove", "thread", "account"], switches: ["remove", "thread"], usage: "mute <address|@domain>... [--account <email>] [--remove]   or   mute --thread <message-id>... [--remove]", summary: "Silences notifications from senders, domains or conversations. The mail is filed as before." },
  { id: "block", group: "organize", options: ["remove"], switches: ["remove"], usage: "block <address|@domain>... [--remove]", summary: "Blocks senders or domains: their mail goes to the Trash. Names each one; never a group." },
  { id: "inbox", group: "organize", usage: "inbox <message-id>...", summary: "Moves the messages to the Inbox." },
  { id: "archive", group: "organize", usage: "archive <message-id>...", summary: "Moves the messages to the Archive." },
  { id: "trash", group: "organize", usage: "trash <message-id>...", summary: "Moves the messages to the Trash." },
  { id: "spam", group: "organize", usage: "spam <message-id>...", summary: "Reports the messages as spam and moves them to Spam." },
  { id: "draft new", group: "drafts", options: ["account", "to", "cc", "bcc", "subject", "body", "attach"], usage: "draft new [--account <email>] [--to a,b] [--cc ..] [--bcc ..] [--subject ..] [--body .. | --body -] [--attach <path>]...", summary: "Starts a message in Drafts. `--body -` reads the text from standard input." },
  { id: "draft reply", group: "drafts", options: ["body", "cc", "bcc", "attach"], usage: "draft reply <message-id> [--body ..] [--cc ..] [--bcc ..] [--attach <path>]...", summary: "Starts a reply to the sender, with the original quoted." },
  { id: "draft reply-all", group: "drafts", options: ["body", "cc", "bcc", "attach"], usage: "draft reply-all <message-id> [--body ..] [--cc ..] [--bcc ..] [--attach <path>]...", summary: "Starts a reply to everyone on the message." },
  { id: "draft forward", group: "drafts", options: ["to", "cc", "bcc", "body", "attach"], usage: "draft forward <message-id> --to a,b [--cc ..] [--bcc ..] [--body ..] [--attach <path>]...", summary: "Starts a forward, with the original below what you write." },
  { id: "draft edit", group: "drafts", options: ["to", "cc", "bcc", "subject", "body", "attach"], usage: "draft edit <draft-id> [--to ..] [--cc ..] [--bcc ..] [--subject ..] [--body ..] [--attach <path>]...", summary: "Changes a draft the CLI wrote: what is given replaces what was there, files are added." },
  { id: "draft delete", group: "drafts", usage: "draft delete <draft-id>", summary: "Deletes a draft the CLI wrote." },
  { id: "draft list", group: "drafts", usage: "draft list", summary: "The drafts the CLI wrote since MiniMail started: id, recipients, subject." },
  { id: "send", group: "ask", ask: true, options: ["at"], usage: "send <draft-id> [--at <time>]", summary: "Sends a draft the CLI wrote, or schedules it (--at 2026-11-22T09:00, or 30m, 2h, 1d). The person is asked first, unless every recipient is on their allowed list." },
  { id: "unsubscribe", group: "ask", ask: true, usage: "unsubscribe <message-id>...", summary: "Unsubscribes from the mailing lists behind the messages. It cannot be undone." },
  { id: "invitation", group: "ask", ask: true, usage: "invitation <message-id> accept|maybe|decline", summary: "Answers a calendar invitation. The organizer is told." },
] as const satisfies readonly CliCommandDef[];

export type CliCommandId = (typeof CLI_COMMANDS)[number]["id"];

export const CLI_COMMAND_IDS = CLI_COMMANDS.map((command) => command.id) as unknown as readonly [CliCommandId, ...CliCommandId[]];

export function cliCommand(id: string): CliCommandDef | undefined {
  return (CLI_COMMANDS as readonly CliCommandDef[]).find((command) => command.id === id);
}

/**
 * Where a skill can be installed for an AI agent. `~/.agents/skills` is a folder that Codex, Cursor, Gemini CLI and
 * GitHub Copilot all document reading (each also has a folder of its own, which would only make a second copy),
 * so one place covers them. Claude Code reads its own.
 */
export const SKILL_TARGETS = [
  { id: "agents", label: "Codex, Cursor, Gemini CLI, Copilot and other agents", folder: "~/.agents/skills", detect: [".agents", ".codex", ".cursor", ".gemini", ".copilot"] },
  { id: "claude", label: "Claude Code", folder: "~/.claude/skills", detect: [".claude"] },
] as const;

export type SkillTargetId = (typeof SKILL_TARGETS)[number]["id"];

export const SKILL_TARGET_IDS = SKILL_TARGETS.map((target) => target.id) as unknown as readonly [SkillTargetId, ...SkillTargetId[]];

/** What happens when the CLI runs a command that cannot be undone: it is refused, asks first, or goes ahead. */
export type AskMode = "off" | "ask" | "always";

export const ASK_COMMANDS = ["send", "unsubscribe", "invitation"] as const;
export type AskCommand = (typeof ASK_COMMANDS)[number];

export const ASK_MODES: readonly AskMode[] = ["off", "ask", "always"];

/** The most addresses and domains the person can allow for sending. */
export const MAX_ALLOWED_RECIPIENTS = 200;

/**
 * An entry of the allowed recipients, in the form it is kept: an address, or `@domain` for everyone at a
 * domain. A public mail domain (gmail.com, outlook.com...) is refused as a domain, since that would allow
 * almost anyone; its addresses can be added one by one.
 */
export function normalizeAllowedRecipient(text: string): { value: string } | { error: string } {
  const value = text.trim().toLowerCase();
  if (value.startsWith("@")) {
    const domain = value.slice(1);
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(domain)) return { error: `"${text.trim()}" is not a domain. Write it like @example.com` };
    if (isFreemail(domain)) return { error: `${domain} is a public mail service, so allowing all of it would allow almost anyone. Add the addresses one by one.` };
    return { value };
  }
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(value)) return { error: `"${text.trim()}" is not an address. Write it like anna@example.com, or @example.com for a domain` };
  return { value };
}

/** Whether mail to this address may go out without asking: the address is on the list, or so is its domain. */
export function recipientAllowed(allowed: readonly string[], email: string): boolean {
  const address = email.trim().toLowerCase();
  return allowed.includes(address) || allowed.includes(`@${address.split("@")[1] ?? ""}`);
}

export interface CliSettings {
  /** The master switch. Off: nothing listens, nothing is installed. */
  enabled: boolean;
  /** Commands the person turned off. A command that is not listed is on. (The ask-first ones use `ask`.) */
  disabled: CliCommandId[];
  /** For each command that cannot be undone: off, ask first (the default), or always allow. For `send`, "always" means to anyone. */
  ask: Record<AskCommand, AskMode>;
  /** Addresses and `@domains` the CLI may send to without asking (when `ask.send` is "ask"). */
  allowedRecipients: string[];
  /** Show every link in mail as `[link host]`, so a reset or sign-in link never reaches the agent. */
  hideLinks: boolean;
  /** Keep a link at `~/.local/bin/minimail` while the CLI is on, so `minimail` works in a terminal. On unless the person turns it off. */
  pathLink: boolean;
  /** The agents the skill is installed for while the CLI is on. */
  skillTargets: SkillTargetId[];
}

export const DEFAULT_CLI_SETTINGS: CliSettings = {
  enabled: false,
  disabled: [],
  ask: { send: "ask", unsubscribe: "ask", invitation: "ask" },
  allowedRecipients: [],
  hideLinks: true,
  pathLink: true,
  skillTargets: [],
};

/** Whether a command may run: the CLI is on, and the command was not turned off (or cannot be). */
export function cliCommandAllowed(settings: CliSettings, id: string): boolean {
  const command = cliCommand(id);
  if (!command || !settings.enabled) return false;
  if (command.ask === true) return settings.ask[command.id as AskCommand] !== "off";
  return command.always === true || !settings.disabled.includes(command.id as CliCommandId);
}

/** One place the skill can go, as the page shows it. */
export interface SkillTargetStatus {
  id: SkillTargetId;
  label: string;
  folder: string;
  /** The agent's folder exists on this computer. */
  detected: boolean;
  /** The skill file is there now. */
  installed: boolean;
}

export interface CliState {
  settings: CliSettings;
  /** The command to run, or null while the CLI is off. */
  launcher: string | null;
  /** The CLI is listening right now. */
  running: boolean;
  skills: SkillTargetStatus[];
  /** The link that lets the person type `minimail` in their own terminal: where it goes, and whether it is there now. */
  pathLink: { path: string; installed: boolean };
}

/** Why a message is not given to the CLI, worded the same way in the CLI's answer, the skill and Settings. */
export const WITHHELD_REASON =
  "This message contains a sign-in code. MiniMail never gives sign-in codes to the CLI: anyone can email you instructions that ask an agent to pass a code on, and a code is enough to take over an account. Do not try to get the code another way. Tell the user, and offer `minimail open <message-id>` so they can read it themselves.";

/** What the CLI cannot do at all, for the bottom of the CLI tab. */
export const CLI_NEVER: readonly { title: string; why: string }[] = [
  { title: "Messages with sign-in codes", why: "One code can be enough to take over an account, and anyone can email an agent instructions to pass it on." },
  { title: "Attachments", why: "Opening or saving a file could run something on this computer." },
  { title: "Accounts, AI keys and settings", why: "These stay in MiniMail." },
  { title: "Delete forever", why: "It cannot be taken back." },
];
