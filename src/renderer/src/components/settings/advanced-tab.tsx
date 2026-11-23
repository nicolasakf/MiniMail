import { useEffect, useState } from "react";

import { MAIL_WINDOW } from "@shared/mail-window";
import {
  DAYS_LIMIT_CEILING_BYTES,
  DEFAULT_OFFLINE_SETTINGS,
  MAX_LOOKBACK_DAYS,
  MAX_MEGABYTES,
  MIN_LOOKBACK_DAYS,
  MIN_MEGABYTES,
  OFFLINE_FOLDERS,
  type OfflineFolder,
  type OfflineLimit,
  type OfflineSettings,
} from "@shared/offline";

import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { FOLDER_STYLE, raisedActive } from "@/lib/folder-style";
import { toast } from "@/lib/toast";

import { SettingsPageHeader, SettingsRow, SettingsSectionTitle, SettingsSegmentedField, SettingsSwitchField } from "./fields";
import { SettingsMultiTileField } from "./visual-fields";

/** A whole number typed in a box, within `min` to `max`; null when it is not one. */
function parseWhole(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const value = Number(text);
  return value >= min && value <= max ? value : null;
}

const LIMITS: readonly { value: OfflineLimit; label: string }[] = [
  { value: "days", label: "Days" },
  { value: "size", label: "Disk space" },
  { value: "unlimited", label: "Unlimited" },
];

const gigabytes = DAYS_LIMIT_CEILING_BYTES / (1024 * 1024 * 1024);

/** A box for a whole number that saves when it is left, and goes back to the saved value when it is not a valid one. */
function NumberBox({
  label,
  saved,
  min,
  max,
  disabled,
  onCommit,
}: {
  label: string;
  saved: number;
  min: number;
  max: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(String(saved));
  useEffect(() => setText(String(saved)), [saved]);

  const commit = (): void => {
    const parsed = parseWhole(text, min, max);
    // Not a number in range: put back what is saved instead of guessing what was meant.
    if (parsed === null || parsed === saved) setText(String(saved));
    else onCommit(parsed);
  };

  return (
    <Input
      aria-label={label}
      inputMode="numeric"
      className="w-24"
      value={text}
      disabled={disabled}
      aria-invalid={parseWhole(text, min, max) === null}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

/** Choices most people never change: for now, how much mail is kept ready on this computer. */
export function AdvancedTab() {
  const [settings, setSettings] = useState<OfflineSettings | null>(null);

  useEffect(() => {
    api.offline
      .settings()
      .then(setSettings)
      .catch(() => undefined); // expected: recorded by the main process
  }, []);

  /** Saves a change at once; if it fails the saved value comes back and a toast says why. */
  const save = async (next: OfflineSettings): Promise<void> => {
    const before = settings;
    setSettings(next);
    try {
      setSettings(await api.offline.setSettings(next));
    } catch (error) {
      setSettings(before);
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const current = settings ?? DEFAULT_OFFLINE_SETTINGS;
  const ready = settings !== null;

  const toggleFolder = (folder: OfflineFolder, on: boolean): void => {
    if (!settings) return;
    const folders = OFFLINE_FOLDERS.filter((name) => (name === folder ? on : settings.folders.includes(name)));
    // At least one folder stays: to download nothing, turn the switch off.
    if (folders.length > 0) void save({ ...settings, folders });
  };

  return (
    <div className="space-y-6">
      <SettingsPageHeader title="Advanced" />
      <section className="space-y-3">
        <SettingsSectionTitle
          title="Offline mail"
          info="Opened messages are stored on this computer, encrypted with the system keychain."
        />
        <SettingsSwitchField
          id="prefetch"
          label="Download mail ahead of time"
          description="Downloads the text of new mail as it arrives. Attachments and embedded images download when opened."
          checked={current.prefetch}
          disabled={!ready}
          onCheckedChange={(prefetch) => settings && void save({ ...settings, prefetch })}
        />

        <SettingsRow label="Folders" description={`The newest ${MAIL_WINDOW} messages of each.`}>
          <SettingsMultiTileField
            ariaLabel="Folders downloaded ahead of time"
            values={current.folders}
            disabled={!ready || !current.prefetch}
            options={OFFLINE_FOLDERS.map((folder) => {
              const { label, icon: Icon } = FOLDER_STYLE[folder];
              return {
                value: folder,
                label,
                activeClassName: raisedActive(folder),
                content: <Icon aria-hidden="true" className="size-6" />,
              };
            })}
            onToggle={toggleFolder}
          />
        </SettingsRow>

        <SettingsRow label="Keep" description="What limits the saved mail.">
          <div className="space-y-2">
            <SettingsSegmentedField
              ariaLabel="What limits the mail kept on this computer"
              value={current.limit}
              options={LIMITS}
              disabled={!ready}
              onValueChange={(limit) => settings && void save({ ...settings, limit })}
            />

            {current.limit === "days" && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Mail from the last</span>
                  <NumberBox
                    label="Days of mail to download ahead of time"
                    saved={current.lookbackDays}
                    min={MIN_LOOKBACK_DAYS}
                    max={MAX_LOOKBACK_DAYS}
                    disabled={!ready || !current.prefetch}
                    onCommit={(lookbackDays) => settings && void save({ ...settings, lookbackDays })}
                  />
                  <span className="text-sm text-muted-foreground">
                    days ({MIN_LOOKBACK_DAYS} to {MAX_LOOKBACK_DAYS})
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Messages you open are kept too. Past {gigabytes} GB, the mail read longest ago is dropped.
                </p>
              </div>
            )}

            {current.limit === "size" && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Newest first, up to</span>
                  <NumberBox
                    label="Megabytes of disk space for saved mail"
                    saved={current.maxMegabytes}
                    min={MIN_MEGABYTES}
                    max={MAX_MEGABYTES}
                    disabled={!ready}
                    onCommit={(maxMegabytes) => settings && void save({ ...settings, maxMegabytes })}
                  />
                  <span className="text-sm text-muted-foreground">
                    MB ({MIN_MEGABYTES} to {MAX_MEGABYTES})
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  When it is full, the mail read longest ago is dropped to make room. A lower number drops mail at once.
                </p>
              </div>
            )}

            {current.limit === "unlimited" && (
              <p role="status" className="text-xs text-amber">
                Nothing saved is ever dropped to make room, so the mail kept on this computer only grows. Newsletters and long
                messages can take a lot of disk space over time.
              </p>
            )}
          </div>
        </SettingsRow>
      </section>
    </div>
  );
}
