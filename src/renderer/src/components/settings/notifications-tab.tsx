import { useState } from "react";

import { BellRing, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { accountLabel } from "@shared/accounts";
import { iconFor } from "@shared/categories";
import {
  MAX_MUTED_SENDERS,
  NO_CATEGORY,
  normalizeMutedSender,
  type CategoryFilterMode,
  type NotificationContent,
  type NotificationSettings,
  type NotifyFolder,
} from "@shared/notifications";
import type { Account, Category } from "@shared/types";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useNotificationSettings } from "@/hooks/use-notification-settings";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

import { AccountMark } from "../mail/account-mark";
import { CategoryIcon } from "../mail/category-icon";

import {
  SettingsLabel,
  SettingsPageHeader,
  SettingsSectionTitle,
  SettingsSegmentedField,
  SettingsSwitchField,
} from "./fields";

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

/** Which new mail interrupts you, and how: by folder, account, category and sender, plus how it looks and when it stays quiet. */
export function NotificationsTab({ accounts, categories }: NotificationsTabProps) {
  const { settings, update } = useNotificationSettings();

  if (!settings) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <SettingsPageHeader title="Notifications" description="Choose which new mail interrupts you." />
      </div>
    );
  }

  const off = !settings.enabled;
  const change = (patch: Partial<NotificationSettings>) => void update((current) => ({ ...current, ...patch }));
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
  const filtering = settings.categories.mode !== "all";

  return (
    <div className="flex flex-col gap-6 p-6">
      <SettingsPageHeader
        title="Notifications"
        description="Choose which new mail interrupts you, and what the notification shows."
      />

      <div className="max-w-2xl space-y-3">
        <SettingsSwitchField
          id="notify-enabled"
          label="Notify me about new mail"
          description="The master switch. Off means no notifications, sound or Dock badge."
          checked={settings.enabled}
          onCheckedChange={(enabled) => change({ enabled })}
        />
        <Button type="button" variant="outline" size="sm" disabled={off} onClick={() => void sendTest()}>
          <BellRing /> Send a test notification
        </Button>
      </div>

      <div className={cn("space-y-6", off && "pointer-events-none opacity-50")} aria-disabled={off}>
        <Separator />

        <section className="max-w-2xl space-y-3">
          <SettingsSectionTitle
            title="Folders"
            info="Notify for mail that arrives in these folders. Mail you move yourself never notifies in its new folder."
          />
          <div className="space-y-2">
            {FOLDER_OPTIONS.map(({ folder, label, description }) => (
              <CheckRow
                key={folder}
                id={`notify-folder-${folder}`}
                checked={settings.folders.includes(folder)}
                disabled={off}
                description={description}
                onCheckedChange={(on) => change({ folders: toggled(settings.folders, folder, on) })}
              >
                {label}
              </CheckRow>
            ))}
          </div>
        </section>

        <Separator />

        <section className="max-w-2xl space-y-3">
          <SettingsSectionTitle
            title="Categories"
            info="Filter by the category MiniMail sorted the conversation into. With AI sorting on, a new message waits a few seconds to be sorted first."
          />
          <SettingsSegmentedField
            ariaLabel="Category filter"
            value={settings.categories.mode}
            options={CATEGORY_MODES}
            disabled={off}
            onValueChange={(mode) => change({ categories: { ...settings.categories, mode } })}
          />
          {filtering && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {settings.categories.mode === "only"
                  ? "Notify only for mail in the checked categories."
                  : "Notify for everything except mail in the checked categories."}
              </p>
              {categoryChoices.map(({ id, name, category }) => (
                <CheckRow
                  key={id}
                  id={`notify-category-${id}`}
                  checked={settings.categories.ids.includes(id)}
                  disabled={off}
                  onCheckedChange={(on) =>
                    change({ categories: { ...settings.categories, ids: toggled(settings.categories.ids, id, on) } })
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
              {settings.categories.mode === "only" && settings.categories.ids.length === 0 && (
                <p className="text-xs text-amber-400">Nothing is checked, so no mail will notify.</p>
              )}
            </div>
          )}
        </section>

        {accounts.length > 1 && (
          <>
            <Separator />
            <section className="max-w-2xl space-y-3">
              <SettingsSectionTitle title="Accounts" info="Uncheck an account to silence it. Its mail still arrives as usual." />
              <div className="space-y-2">
                {accounts.map((account) => (
                  <CheckRow
                    key={account.id}
                    id={`notify-account-${account.id}`}
                    checked={!settings.mutedAccountIds.includes(account.id)}
                    disabled={off}
                    onCheckedChange={(on) =>
                      change({ mutedAccountIds: toggled(settings.mutedAccountIds, account.id, !on) })
                    }
                  >
                    <AccountMark account={account} size={20} />
                    <span className="truncate">{accountLabel(account)}</span>
                  </CheckRow>
                ))}
              </div>
            </section>
          </>
        )}

        <Separator />

        <section className="max-w-2xl space-y-3">
          <SettingsSectionTitle
            title="Muted senders"
            info="Mail from these addresses or domains never notifies. Add a whole company with @company.com."
          />
          <MutedSenders
            senders={settings.mutedSenders}
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
              value={settings.content}
              options={CONTENT_OPTIONS}
              disabled={off}
              onValueChange={(content) => change({ content })}
            />
            <p className="text-xs text-muted-foreground">{CONTENT_HELP[settings.content]}</p>
          </div>
        </section>

        <Separator />

        <section className="max-w-2xl space-y-3">
          <SettingsSectionTitle title="Delivery" />
          <SettingsSwitchField
            id="notify-sound"
            label="Play a sound"
            description="Uses the system notification sound."
            checked={settings.sound}
            disabled={off}
            onCheckedChange={(sound) => change({ sound })}
          />
          <SettingsSwitchField
            id="notify-badge"
            label="Unread count on the Dock icon"
            description="Counts unread Inbox mail from accounts that are not silenced."
            checked={settings.dockBadge}
            disabled={off}
            onCheckedChange={(dockBadge) => change({ dockBadge })}
          />
          <SettingsSwitchField
            id="notify-focused"
            label="Stay quiet while MiniMail is open"
            description="No notification when MiniMail is the window in front."
            checked={settings.muteWhenFocused}
            disabled={off}
            onCheckedChange={(muteWhenFocused) => change({ muteWhenFocused })}
          />
          <SettingsSwitchField
            id="notify-group"
            label="Combine bursts into one notification"
            description="Several messages arriving together show as a single notification."
            checked={settings.groupBursts}
            disabled={off}
            onCheckedChange={(groupBursts) => change({ groupBursts })}
          />
        </section>

        <Separator />

        <section className="max-w-2xl space-y-3 pb-2">
          <SettingsSectionTitle
            title="Quiet hours"
            info="No notifications in this window. The mail is still waiting in your Inbox afterwards."
          />
          <SettingsSwitchField
            id="notify-quiet"
            label="Pause notifications on a schedule"
            checked={settings.quietHours.enabled}
            disabled={off}
            onCheckedChange={(enabled) => change({ quietHours: { ...settings.quietHours, enabled } })}
          />
          {settings.quietHours.enabled && (
            <div className="grid max-w-sm grid-cols-2 gap-4">
              <div className="space-y-2">
                <SettingsLabel htmlFor="notify-quiet-start" label="From" />
                <Input
                  id="notify-quiet-start"
                  type="time"
                  value={settings.quietHours.start}
                  disabled={off}
                  onChange={(event) =>
                    event.target.value &&
                    change({ quietHours: { ...settings.quietHours, start: event.target.value } })
                  }
                />
              </div>
              <div className="space-y-2">
                <SettingsLabel htmlFor="notify-quiet-end" label="Until" />
                <Input
                  id="notify-quiet-end"
                  type="time"
                  value={settings.quietHours.end}
                  disabled={off}
                  onChange={(event) =>
                    event.target.value && change({ quietHours: { ...settings.quietHours, end: event.target.value } })
                  }
                />
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
