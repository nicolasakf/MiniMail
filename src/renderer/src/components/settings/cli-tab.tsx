import { useRef, useState } from "react";

import { X } from "lucide-react";

import {
  CLI_COMMANDS,
  CLI_GROUPS,
  MAX_ALLOWED_RECIPIENTS,
  SKILL_TARGET_IDS,
  SKILL_TARGETS,
  normalizeAllowedRecipient,
  type AskCommand,
  type AskMode,
  type CliCommandDef,
  type CliCommandId,
  type CliGroupDef,
  type CliSettings,
  type CliState,
  type SkillTargetId,
} from "@shared/cli";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useCli } from "@/hooks/use-cli";
import { cn } from "@/lib/utils";

import { SettingsPageHeader, SettingsSectionTitle, SettingsSegmentedField, SettingsSwitchField } from "./fields";

type Change = (change: (settings: CliSettings) => CliSettings) => Promise<void>;

/**
 * The switch that allows the CLI. Turning it on asks, next to the switch, whether the skill (a short
 * file that teaches an agent to use the command and to treat mail as untrusted) may also be installed
 * for all the agents MiniMail knows: `~/.agents/skills` (Codex, Cursor, Gemini CLI, Copilot and others)
 * and `~/.claude/skills`. Turning it on starts with no skill; "Install" adds both, and the skill goes
 * with the CLI when it is turned off. Settings and the setup guide share it.
 */
export function CliAllowField({ id, state, update }: { id: string; state: CliState | null; update: Change }) {
  const [asking, setAsking] = useState(false);
  return (
    <Popover open={asking} onOpenChange={setAsking}>
      <PopoverAnchor asChild>
        <div>
          <SettingsSwitchField
            id={id}
            label="Allow the MiniMail CLI"
            description="Off: nothing listens and nothing is installed. On: any program running as you can use the command."
            checked={state?.settings.enabled ?? false}
            disabled={state === null}
            onCheckedChange={(enabled) => {
              void update((current) => ({ ...current, enabled, skillTargets: enabled ? [] : current.skillTargets }));
              setAsking(enabled);
            }}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent align="end" side="bottom" className="w-72 space-y-3 p-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold">Also install the skill for all your agents?</p>
          <p className="text-xs text-muted-foreground">
            Writes a skill file for Claude Code, Codex, Cursor and others in {SKILL_TARGETS.map((target) => target.folder).join(" and ")}. MiniMail only changes files it wrote.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setAsking(false)}>
            Not now
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              void update((current) => ({ ...current, skillTargets: [...SKILL_TARGET_IDS] }));
              setAsking(false);
            }}
          >
            Install
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function CommandRow({ command, on, onChange }: { command: CliCommandDef; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className={cn("flex items-center justify-between gap-4 py-2", !on && "opacity-60")}>
      <div className="min-w-0 space-y-0.5">
        <code className="block truncate font-mono text-xs font-medium">{command.usage}</code>
        <p className="text-xs text-muted-foreground">{command.summary}</p>
      </div>
      <Switch
        aria-label={`Allow ${command.id}`}
        checked={on}
        disabled={command.always === true}
        onCheckedChange={onChange}
      />
    </div>
  );
}

/** The people the CLI may send to without asking: addresses, and `@domain` for everyone at a domain. */
function AllowedRecipients({ settings, update }: { settings: CliSettings; update: Change }) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const anyone = settings.ask.send === "always";
  const add = () => {
    if (!text.trim()) return;
    const result = normalizeAllowedRecipient(text);
    if ("error" in result) return setProblem(result.error);
    if (settings.allowedRecipients.length >= MAX_ALLOWED_RECIPIENTS) return setProblem(`Up to ${MAX_ALLOWED_RECIPIENTS} people or domains can be allowed.`);
    setProblem(null);
    setText("");
    if (!settings.allowedRecipients.includes(result.value)) void update((current) => ({ ...current, allowedRecipients: [...current.allowedRecipients, result.value] }));
  };
  return (
    <div className={cn("space-y-2 py-3", anyone && "opacity-60")}>
      <div className="space-y-0.5">
        <p className="text-sm font-medium">Send without asking to</p>
        <p className="text-xs text-muted-foreground">
          Sends without asking only when everyone on the message, Cc and Bcc included, is on this list. Drafts with files the agent attached always ask.
          {anyone && " Not used while sending to anyone is allowed."}
        </p>
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <Input
          aria-label="Add an address or domain"
          placeholder="anna@example.com or @example.com"
          className="h-9"
          value={text}
          disabled={anyone}
          onChange={(event) => {
            setText(event.target.value);
            setProblem(null);
          }}
        />
        <Button type="submit" variant="outline" size="sm" disabled={anyone || !text.trim()}>
          Add
        </Button>
      </form>
      {problem && (
        <p role="alert" className="text-xs text-red-500">
          {problem}
        </p>
      )}
      {settings.allowedRecipients.length === 0 ? (
        <p className="text-xs text-muted-foreground">No one yet, so every send asks first.</p>
      ) : (
        <ul aria-label="People allowed" className="flex flex-wrap gap-1.5">
          {settings.allowedRecipients.map((entry) => (
            <li key={entry} className="corner-squircle flex items-center gap-1 rounded-md border bg-muted/40 py-0.5 pl-2 pr-0.5 text-xs">
              <span className="font-mono">{entry}</span>
              <button
                type="button"
                aria-label={`Remove ${entry}`}
                disabled={anyone}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:pointer-events-none"
                onClick={() => void update((current) => ({ ...current, allowedRecipients: current.allowedRecipients.filter((candidate) => candidate !== entry) }))}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Asked before sending to anyone is allowed: the safer answer is the one that has the focus. */
function AnyoneDialog({ open, onChosen, onAnyone }: { open: boolean; onChosen: () => void; onAnyone: () => void }) {
  const safe = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onChosen()}>
      {/* The dialog would focus the first button, which is the risky one: the safe one gets the focus. */}
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          safe.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Let the CLI send to anyone without asking?</DialogTitle>
          <DialogDescription>
            If an email tricks your agent, it could send your mail or files to a stranger, and a sent message can&apos;t be taken back. Allowing only the people you choose is safer.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={onAnyone}>
            Allow anyone
          </Button>
          <Button ref={safe} type="button" onClick={onChosen}>
            Allow only chosen people
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ASK_OPTIONS: Record<AskCommand, readonly { value: AskMode; label: string }[]> = {
  send: [{ value: "off", label: "Off" }, { value: "ask", label: "Ask" }, { value: "always", label: "Anyone" }],
  unsubscribe: [{ value: "off", label: "Off" }, { value: "ask", label: "Ask" }, { value: "always", label: "Always" }],
  invitation: [{ value: "off", label: "Off" }, { value: "ask", label: "Ask" }, { value: "always", label: "Always" }],
};

/** The commands that cannot be undone: each is off, asks first (the default), or goes ahead. Sending also has the list of people it may go to. */
function AskGroup({ group, settings, update }: { group: CliGroupDef; settings: CliSettings; update: Change }) {
  const [askAnyone, setAskAnyone] = useState(false);
  const commands = (CLI_COMMANDS as readonly CliCommandDef[]).filter((command) => command.group === group.id);
  const set = (command: AskCommand, mode: AskMode) => update((current) => ({ ...current, ask: { ...current.ask, [command]: mode } }));
  return (
    <section className="space-y-1">
      <div className="space-y-0.5">
        <SettingsSectionTitle title={group.title} />
        <p className="text-xs text-muted-foreground">{group.description}</p>
      </div>
      <div className="divide-y">
        {commands.map((entry) => {
          const command = entry.id as AskCommand;
          return (
            <div key={command}>
              <div className="flex items-center justify-between gap-4 py-2">
                <div className="min-w-0 space-y-0.5">
                  <code className="block truncate font-mono text-xs font-medium">{entry.usage}</code>
                  <p className="text-xs text-muted-foreground">{entry.summary}</p>
                  {command === "send" && settings.ask.send === "always" && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">Sending to anyone is allowed without asking.</p>
                  )}
                </div>
                <div className="w-56 shrink-0">
                  <SettingsSegmentedField
                    ariaLabel={`When the CLI uses ${command}`}
                    value={settings.ask[command]}
                    options={ASK_OPTIONS[command]}
                    onValueChange={(mode) => (command === "send" && mode === "always" ? setAskAnyone(true) : void set(command, mode))}
                  />
                </div>
              </div>
              {command === "send" && settings.ask.send !== "off" && <AllowedRecipients settings={settings} update={update} />}
            </div>
          );
        })}
      </div>
      <AnyoneDialog
        open={askAnyone}
        onChosen={() => {
          setAskAnyone(false);
          if (settings.ask.send === "always") void set("send", "ask");
        }}
        onAnyone={() => {
          setAskAnyone(false);
          void set("send", "always");
        }}
      />
    </section>
  );
}

function Group({ group, settings, update }: { group: CliGroupDef; settings: CliSettings; update: Change }) {
  if (group.id === "ask") return <AskGroup group={group} settings={settings} update={update} />;
  const commands = (CLI_COMMANDS as readonly CliCommandDef[]).filter((command) => command.group === group.id);
  const switchable = commands.filter((command) => command.always !== true);
  const isOn = (command: CliCommandDef) => command.always === true || !settings.disabled.includes(command.id as CliCommandId);
  const allOn = switchable.every(isOn);
  const setCommand = (command: CliCommandDef, on: boolean) =>
    update((current) => ({
      ...current,
      disabled: on ? current.disabled.filter((id) => id !== command.id) : [...current.disabled, command.id as CliCommandId],
    }));
  const setGroup = (on: boolean) =>
    update((current) => ({
      ...current,
      disabled: on
        ? current.disabled.filter((id) => !switchable.some((command) => command.id === id))
        : [...new Set([...current.disabled, ...switchable.map((command) => command.id as CliCommandId)])],
    }));
  return (
    <section className="space-y-1">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <SettingsSectionTitle title={group.title} />
          <p className="text-xs text-muted-foreground">{group.description}</p>
        </div>
        {switchable.length > 0 && (
          <Switch aria-label={`Allow every ${group.title.toLowerCase()} command`} checked={allOn} onCheckedChange={setGroup} />
        )}
      </div>
      <div className="divide-y">
        {commands.map((command) => (
          <CommandRow key={command.id} command={command} on={isOn(command)} onChange={(on) => void setCommand(command, on)} />
        ))}
      </div>
    </section>
  );
}

/** Asked before links are shown in full: the safer answer is the one that has the focus. */
function FullLinksDialog({ open, onKeep, onShow }: { open: boolean; onKeep: () => void; onShow: () => void }) {
  const safe = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onKeep()}>
      {/* The dialog would focus the first button, which is the risky one: the safe one gets the focus. */}
      <DialogContent
        className="max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          safe.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Show full links to the CLI?</DialogTitle>
          <DialogDescription>
            Password reset and sign-in links let anyone who has them into your accounts. With full links, your agent decides on its own which links are safe, and an email written to trick it can make it open one.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={onShow}>
            Show full links
          </Button>
          <Button ref={safe} type="button" onClick={onKeep}>
            Keep links hidden
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The CLI page: whether AI agents on this computer may read mail through the `minimail` command, which
 * commands they have, and the skill that teaches them to use it. Everything is checked by MiniMail
 * itself when a command arrives; this page only chooses what it allows.
 */
export function CliTab() {
  const { state, update } = useCli();
  const [askLinks, setAskLinks] = useState(false);
  if (!state) return <SettingsPageHeader title="CLI" />;
  const { settings } = state;
  const off = !settings.enabled;

  return (
    <div className="space-y-6">
      <SettingsPageHeader title="CLI" />
      <p className="max-w-2xl text-sm text-muted-foreground">
        AI agents on this computer, such as Claude Code or Codex, can use the <code className="font-mono text-xs">minimail</code> command. They can only do what is switched on here. Messages with sign-in codes are withheld.
      </p>

      <div className="max-w-2xl space-y-3">
        <CliAllowField id="cli-enabled" state={state} update={update} />
      </div>

      <div className={cn("max-w-2xl space-y-6", off && "pointer-events-none opacity-50")} aria-disabled={off}>
        <SettingsSwitchField
          id="cli-path"
          label="Use minimail in your terminal"
          description={`Adds a link at ${state.pathLink.path}, which must be on your PATH.`}
          checked={settings.pathLink}
          onCheckedChange={(pathLink) => void update((current) => ({ ...current, pathLink }))}
        />
        {settings.enabled && settings.pathLink && !state.pathLink.installed && (
          <p role="alert" className="-mt-3 text-xs text-red-500">
            The link was not added. The Log says why (a file of your own may already be there).
          </p>
        )}
        <Separator />
        {CLI_GROUPS.map((group) => (
          <Group key={group.id} group={group} settings={settings} update={update} />
        ))}

        <SettingsSwitchField
          id="cli-hide-links"
          label="Hide links in mail"
          description="Shows each link as [link host]."
          checked={settings.hideLinks}
          onCheckedChange={(hide) => (hide ? void update((current) => ({ ...current, hideLinks: true })) : setAskLinks(true))}
        />
        {!settings.hideLinks && (
          <p className="-mt-3 text-xs text-amber-600 dark:text-amber-400">
            Full links are shown to the agent.
          </p>
        )}

      </div>

      <FullLinksDialog
        open={askLinks}
        onKeep={() => setAskLinks(false)}
        onShow={() => {
          setAskLinks(false);
          void update((current) => ({ ...current, hideLinks: false }));
        }}
      />
    </div>
  );
}
