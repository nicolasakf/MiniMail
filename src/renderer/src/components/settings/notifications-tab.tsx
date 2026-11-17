import { useState } from "react";

import { BellRing, Plus, X } from "lucide-react";
import { toast } from "@/lib/toast";

import { accountLabel } from "@shared/accounts";
import { iconFor } from "@shared/categories";
import {
  MAX_MUTED_SENDERS,
  NO_CATEGORY,
  normalizeMutedSender,
  settingsForAccount,
  type AccountNotificationSettings,
  type AccountSettingKey,
  type CategoryFilterMode,
  type NotificationContent,
  type NotifyFolder,
} from "@shared/notifications";
import type { Account, Category } from "@shared/types";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useNotificationSettings } from "@/hooks/use-notification-settings";
import { api } from "@/lib/api";
import { FOLDER_STYLE } from "@/lib/folder-style";
import { cn } from "@/lib/utils";

import { AccountSwitcher } from "../mail/list-header";
import { CategoryIcon } from "../mail/category-icon";

import {
  SettingsLabel,
  SettingsPageHeader,
  SettingsRow,
  SettingsSectionTitle,
  SettingsSegmentedField,
  SettingsSwitchField,
} from "./fields";
import { SettingsMultiTileField } from "./visual-fields";

const FOLDER_OPTIONS: { folder: NotifyFolder; label: string; description: string }[] = [
  { folder: "inbox", label: "Inbox", description: "Mail that arrives in your Inbox." },
  { folder: "archive", label: "Archive", description: "Mail your own filters file straight into Archive." },
  { folder: "spam", label: "Spam", description: "Junk mail. Off unless you want to watch for false positives." },
  { folder: "trash", label: "Trash", description: "Mail that lands in Trash. Off by default." },
];

const CATEGORY_MODES: { value: CategoryFilterMode; label: string }[] = [
  { value: "all", label: "All categories" },
  { value: "only", label: "Only these" },
  { value: "except", label: "All except these" },
];

const CONTENT_OPTIONS: { value: NotificationContent; label: string }[] = [
  { value: "full", label: "Sender and subject" },
  { value: "sender", label: "Sender only" },
  { value: "hidden", label: "Hide details" },
];

const CONTENT_HELP: Record<NotificationContent, string> = {
  full: "Shows who it is from, the subject and the first words of the message.",
  sender: "Shows who it is from and nothing of what they wrote.",
  hidden: "Just says there is new mail, so nothing shows on a shared screen.",
};

function CheckRow({
  id,
  checked,
  disabled,
  onCheckedChange,
  children,
  description,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: React.ReactNode;
  description?: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "corner-squircle flex cursor-pointer items-center gap-3 rounded-md border p-3 transition-colors hover:bg-accent/40",
        disabled && "pointer-events-none opacity-60",
      )}
    >
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(value) => onCheckedChange(value === true)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium">{children}</div>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
    </label>
  );
}

function toggled<T>(list: readonly T[], value: T, on: boolean): T[] {
  const without = list.filter((item) => item !== value);
  return on ? [...without, value] : without;
}

function MutedSenders({
  senders,
  disabled,
  onChange,
}: {
  senders: readonly string[];
  disabled: boolean;
  onChange: (senders: string[]) => void;
}) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const add = () => {
    const sender = normalizeMutedSender(text);
    if (!sender) {
      setProblem("Enter an address like news@example.com, or a whole domain like @example.com.");
      return;
    }
    if (senders.includes(sender)) {
      setProblem("That sender is already muted.");
      return;
    }
    if (senders.length >= MAX_MUTED_SENDERS) {
      setProblem(`You can mute up to ${MAX_MUTED_SENDERS} senders.`);
      return;
    }
    onChange([...senders, sender]);
    setText("");
    setProblem(null);
  };

  return (
    <div className="space-y-3">
      <form
        className="flex max-w-xl items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <Input
          id="notify-muted-sender"
          value={text}
          disabled={disabled}
          placeholder="news@example.com or @example.com"
          aria-label="Sender to mute"
          aria-invalid={problem !== null}
          onChange={(event) => {
            setText(event.target.value);
            setProblem(null);
          }}
        />
        <Button type="submit" variant="outline" disabled={disabled || text.trim() === ""}>
          <Plus /> Mute
        </Button>
      </form>
      {problem && (
        <p role="alert" className="text-xs text-red-300">
          {problem}
        </p>
      )}
      {senders.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Muted senders">
          {senders.map((sender) => (
            <li
              key={sender}
              className="corner-squircle flex items-center gap-1 rounded-md border bg-muted/40 py-1 pl-2.5 pr-1 text-xs"
            >
              <span className="max-w-[16rem] truncate">{sender}</span>
              <button
                type="button"
                aria-label={`Stop muting ${sender}`}
                disabled={disabled}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onChange(senders.filter((item) => item !== sender))}
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface NotificationsTabProps {
  accounts: readonly Account[];
  categories: readonly Category[];
}

/** Scope value for the choices every account follows unless it says otherwise. */
const ALL_ACCOUNTS = "all";

/**
 * Under a setting while one account is selected: says whether it follows the defaults for all
 * accounts or has its own value, and lets the user drop back to the defaults.
 */
function InheritNote({
  overridden,
  onReset,
  className,
}: {
  overridden: boolean;
  onReset: () => void;
  className?: string;
}) {
  return (
    <p className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
      {overridden ? (
        <>
          <span className="font-medium text-foreground">Custom for this account</span>
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onReset}>
            Use the default
          </Button>
        </>
      ) : (
        "Same as all accounts"
      )}
    </p>
  );
}

/**
 * Which new mail interrupts you, and how: by folder, account, category and sender, plus how it looks
 * and when it stays quiet. The account menu at the top picks whose choices the page edits: the
 * defaults for all accounts, or one account's own, which replace the defaults only where set.
 */
export function NotificationsTab({ accounts, categories }: NotificationsTabProps) {
  const { settings, update } = useNotificationSettings();
  const [scope, setScope] = useState(ALL_ACCOUNTS);

  if (!settings) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <SettingsPageHeader title="Notifications" description="Choose which new mail interrupts you." />
      </div>
    );
  }

  const account = accounts.find((candidate) => candidate.id === scope);
  const accountId = account?.id ?? null;
  const view: AccountNotificationSettings = accountId ? settingsForAccount(settings, accountId) : settings;
  const own = accountId && Object.hasOwn(settings.accounts, accountId) ? settings.accounts[accountId] : undefined;
  const isOverridden = (...keys: AccountSettingKey[]) => !!accountId && keys.some((key) => own?.[key] !== undefined);

  const off = !view.enabled;
  const change = (patch: Partial<AccountNotificationSettings>) =>
    void update((current) => {
      if (!accountId) return { ...current, ...patch };
      const existing = Object.hasOwn(current.accounts, accountId) ? current.accounts[accountId] : {};
      return { ...current, accounts: { ...current.accounts, [accountId]: { ...existing, ...patch } } };
    });
  const reset = (...keys: AccountSettingKey[]) =>
    void update((current) => {
      if (!accountId || !Object.hasOwn(current.accounts, accountId)) return current;
      const next = { ...current.accounts[accountId] };
      for (const key of keys) delete next[key];
      const { [accountId]: _dropped, ...others } = current.accounts;
      return { ...current, accounts: Object.keys(next).length > 0 ? { ...others, [accountId]: next } : others };
    });
  const inherit = (...keys: AccountSettingKey[]) =>
    accountId ? <InheritNote overridden={isOverridden(...keys)} onReset={() => reset(...keys)} /> : null;

  const sendTest = async () => {
    try {
      await api.notifications.test();
      toast.success("Test notification sent", {
        description: "If nothing appeared, allow MiniMail in System Settings → Notifications.",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const categoryChoices = [
    ...categories.map((category) => ({ id: category.id, name: category.name, category })),
    { id: NO_CATEGORY, name: "No category", category: null },
  ];
  const filtering = view.categories.mode !== "all";
  const customCount = (id: string) =>
    Object.hasOwn(settings.accounts, id)
      ? Object.values(settings.accounts[id]).filter((value) => value !== undefined).length
      : 0;

  return (
    <div className="flex flex-col gap-6 p-6">
      <SettingsPageHeader
        title="Notifications"
        description={
          account
            ? `Choices for ${accountLabel(account)}. Anything you leave alone follows all accounts.`
            : "Choose which new mail interrupts you, and what the notification shows."
        }
        action={
          accounts.length > 1 ? (
            <AccountSwitcher
              accounts={accounts}
              scope={account ? account.id : ALL_ACCOUNTS}
              onScopeChange={setScope}
              menuAlign="end"
              detail={(candidate) => {
                const custom = customCount(candidate.id);
                return custom > 0 ? `${custom} custom ${custom === 1 ? "setting" : "settings"}` : undefined;
              }}
            />
          ) : undefined
        }
      />

      <div className="max-w-2xl space-y-3">
        <SettingsSwitchField
          id="notify-enabled"
          label={account ? "Notify me about this account" : "Notify me about new mail"}
          description={
            account
              ? "Off means nothing from this account notifies, plays a sound or counts toward the Dock badge."
              : "The master switch. Off means no notifications, sound or Dock badge, except for accounts that turn it back on."
          }
          checked={view.enabled}
          onCheckedChange={(enabled) => change({ enabled })}
        />
        {inherit("enabled")}
        {!account && (
          <Button type="button" variant="outline" size="sm" disabled={off} onClick={() => void sendTest()}>
            <BellRing /> Send a test notification
          </Button>
        )}
      </div>

      <div className={cn("space-y-6", off && "pointer-events-none opacity-50")} aria-disabled={off}>
        <Separator />

        <section className="max-w-2xl">
          <SettingsRow
            label="Folders"
            info="Notify for mail that arrives in the highlighted folders. Mail you move yourself never notifies in its new folder."
          >
            <div className="space-y-2">
              <SettingsMultiTileField
                ariaLabel="Folders that notify"
                values={view.folders}
                disabled={off}
                options={FOLDER_OPTIONS.map(({ folder, description }) => {
                  const { label, icon: Icon, active } = FOLDER_STYLE[folder];
                  return {
                    value: folder,
                    label,
                    description,
                    activeClassName: active,
                    content: <Icon aria-hidden="true" className="size-6" />,
                  };
                })}
                onToggle={(folder, on) => change({ folders: toggled(view.folders, folder, on) })}
              />
              {inherit("folders")}
            </div>
          </SettingsRow>
        </section>

        <Separator />

        <section className="max-w-2xl space-y-3">
          <SettingsSectionTitle
            title="Categories"
            info="Filter by the category MiniMail sorted the conversation into. With AI sorting on, a new message waits a few seconds to be sorted first."
          />
          {inherit("categories")}
          <SettingsSegmentedField
            ariaLabel="Category filter"
            value={view.categories.mode}
            options={CATEGORY_MODES}
            disabled={off}
            onValueChange={(mode) => change({ categories: { ...view.categories, mode } })}
          />
          {filtering && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {view.categories.mode === "only"
                  ? "Notify only for mail in the checked categories."
                  : "Notify for everything except mail in the checked categories."}
              </p>
              {categoryChoices.map(({ id, name, category }) => (
                <CheckRow
                  key={id}
                  id={`notify-category-${id}`}
                  checked={view.categories.ids.includes(id)}
                  disabled={off}
                  onCheckedChange={(on) =>
                    change({ categories: { ...view.categories, ids: toggled(view.categories.ids, id, on) } })
                  }
                >
                  {category ? (
                    <span
                      aria-hidden="true"
                      className="corner-squircle flex size-6 shrink-0 items-center justify-center rounded-md"
                      style={{
                        background: `hsl(${category.hue} 70% 55% / 0.16)`,
                        color: `hsl(${category.hue} 70% 62%)`,
                      }}
                    >
                      <CategoryIcon icon={iconFor(category)} className="size-3.5" />
                    </span>
                  ) : null}
                  {name}
                </CheckRow>
              ))}
              {view.categories.mode === "only" && view.categories.ids.length === 0 && (
                <p className="text-xs text-amber-400">Nothing is checked, so no mail will notify.</p>
              )}
            </div>
          )}
        </section>

        <Separator />

        <section className="max-w-2xl space-y-3">
          <SettingsSectionTitle
            title="Muted senders"
            info={
              account
                ? "Mail from these addresses or domains never notifies for this account. This list replaces the one for all accounts."
                : "Mail from these addresses or domains never notifies. Add a whole company with @company.com."
            }
          />
          {inherit("mutedSenders")}
          <MutedSenders
            senders={view.mutedSenders}
            disabled={off}
            onChange={(mutedSenders) => change({ mutedSenders })}
          />
        </section>

        <Separator />

        <section className="max-w-2xl space-y-3">
          <SettingsSectionTitle title="What a notification shows" />
          <div className="space-y-2">
            <SettingsLabel label="Details" />
            <SettingsSegmentedField
              ariaLabel="Notification details"
              value={view.content}
              options={CONTENT_OPTIONS}
              disabled={off}
              onValueChange={(content) => change({ content })}
            />
            <p className="text-xs text-muted-foreground">{CONTENT_HELP[view.content]}</p>
            {inherit("content")}
          </div>
        </section>

        <Separator />

        <section className="max-w-2xl space-y-3 pb-2">
          <SettingsSectionTitle title="Delivery" />
          <SettingsSwitchField
            id="notify-sound"
            label="Play a sound"
            description="Uses the system notification sound."
            checked={view.sound}
            disabled={off}
            onCheckedChange={(sound) => change({ sound })}
          />
          {inherit("sound")}
          <SettingsSwitchField
            id="notify-focused"
            label="Stay quiet while MiniMail is open"
            description="No notification when MiniMail is the window in front."
            checked={view.muteWhenFocused}
            disabled={off}
            onCheckedChange={(muteWhenFocused) => change({ muteWhenFocused })}
          />
          {inherit("muteWhenFocused")}
          {account ? (
            <p className="text-xs text-muted-foreground">
              The Dock badge and combining bursts apply to every account. Choose All accounts to change them.
            </p>
          ) : (
            <>
              <SettingsSwitchField
                id="notify-badge"
                label="Unread count on the Dock icon"
                description="Counts unread Inbox mail from accounts that are not silenced."
                checked={settings.dockBadge}
                disabled={off}
                onCheckedChange={(dockBadge) => update((current) => ({ ...current, dockBadge }))}
              />
              <SettingsSwitchField
                id="notify-group"
                label="Combine bursts into one notification"
                description="Several messages arriving together show as a single notification."
                checked={settings.groupBursts}
                disabled={off}
                onCheckedChange={(groupBursts) => update((current) => ({ ...current, groupBursts }))}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
