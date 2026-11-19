import { actsOnMany, type BlockChoice } from "@/lib/blocklist";

/** The commands that ask which senders or domains to act on, before acting on several at once. */
export type TargetsCommand = "Block" | "Mute" | "Priority";

/** What the dialog asks: the addresses or domains a choice would act on, and what to do with the ones left ticked. */
export interface TargetsAsk {
  command: TargetsCommand;
  kind: "senders" | "domains";
  values: string[];
  /** The values that are already blocked (muted, marked). */
  active: string[];
  /** Every value is already on, so confirming takes the command back (Unblock, Unmute, Unmark). */
  on: boolean;
  /** Called with the values the user left ticked. */
  onConfirm: (values: string[]) => void;
}

/** The ask for a menu choice, or null when it acts on one sender or domain (or conversations) and needs no dialog. */
export function targetsAsk(
  command: TargetsCommand,
  choice: Pick<BlockChoice<string>, "kind" | "values" | "active" | "on">,
  onConfirm: (values: string[]) => void,
): TargetsAsk | null {
  if (
    !actsOnMany(choice) ||
    (choice.kind !== "senders" && choice.kind !== "domains")
  )
    return null;
  return {
    command,
    kind: choice.kind,
    values: choice.values,
    active: choice.active,
    on: choice.on,
    onConfirm,
  };
}

/** A sender or domain as the dialog lists it. */
export function targetLabel(
  kind: "senders" | "domains",
  value: string,
): string {
  return kind === "domains" ? `@${value}` : value;
}

/** "a sender", "3 domains". */
function counted(kind: "senders" | "domains", count: number): string {
  const noun = kind === "domains" ? "domain" : "sender";
  return count === 1 ? `a ${noun}` : `${count} ${noun}s`;
}

/** The values to act on: the ones ticked, leaving out those already in the wanted state (so Block never unblocks one). */
export function valuesToApply(
  ask: Pick<TargetsAsk, "values" | "active" | "on">,
  ticked: ReadonlySet<string>,
): string[] {
  return ask.values.filter(
    (value) => ticked.has(value) && (ask.on || !ask.active.includes(value)),
  );
}

const VERBS: Record<TargetsCommand, { on: string; off: string }> = {
  Block: { on: "Block", off: "Unblock" },
  Mute: { on: "Mute", off: "Unmute" },
  Priority: { on: "Mark", off: "Unmark" },
};

const EFFECTS: Record<TargetsCommand, { on: string; off: string }> = {
  Block: {
    on: "Their mail goes to the Trash.",
    off: "Their mail is no longer sent to the Trash.",
  },
  Mute: {
    on: "You won't be notified about their new mail.",
    off: "You will be notified about their new mail again.",
  },
  Priority: {
    on: "Their mail shows up under Priority.",
    off: "Their mail no longer shows up under Priority.",
  },
};

/** The wording of the dialog; `count` is how many are ticked (the confirm button names it). */
export function targetsConfirm(
  ask: Pick<TargetsAsk, "command" | "kind" | "values" | "on">,
  count: number,
) {
  const verb = ask.on ? VERBS[ask.command].off : VERBS[ask.command].on;
  const suffix = ask.command === "Priority" ? " as priority" : "";
  return {
    title: `${verb} ${counted(ask.kind, ask.values.length)}${suffix}?`,
    description: `Untick the ones to leave out. ${ask.on ? EFFECTS[ask.command].off : EFFECTS[ask.command].on}`,
    confirmLabel: count === 0 ? verb : `${verb} ${counted(ask.kind, count)}`,
    alreadyOn:
      ask.command === "Block"
        ? "already blocked"
        : ask.command === "Mute"
          ? "already muted"
          : "already marked",
  };
}
