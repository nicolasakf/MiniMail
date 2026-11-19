import { useState } from "react";

import { ChevronRight, Loader2 } from "lucide-react";

import { imapSettingsSchema, zohoSettings, type ImapSettings, type MailServer } from "@shared/imap-settings";
import { accountEmailSchema } from "@shared/schemas";
import type { Account } from "@shared/types";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

import { ProviderFormHeader } from "./add-account-shared";
import { noteShownError } from "@/lib/events";

function emptySettings(email: string): ImapSettings {
  return {
    incoming: { host: "", port: 993, security: "tls", username: email },
    outgoing: { host: "", port: 587, security: "starttls", username: email },
    serverSavesSent: false,
  };
}

/** Moves the sign-in names along with the address, but only where the user has not changed them. */
function followEmail(settings: ImapSettings, previous: string, next: string): ImapSettings {
  const follow = (server: MailServer): MailServer =>
    server.username === previous ? { ...server, username: next } : server;
  return { ...settings, incoming: follow(settings.incoming), outgoing: follow(settings.outgoing) };
}

const SERVER_HELP = "We couldn't find the mail servers for this address. Enter them under Advanced settings.";

/**
 * Sets up a password account. The mail servers are looked up from the address when the user
 * connects; they only appear, editable, under Advanced settings.
 */
export function ImapAccountForm({
  provider,
  onBack,
  onAdded,
}: {
  provider: "imap" | "zoho";
  onBack: () => void;
  onAdded: (account: Account) => void;
}) {
  const zoho = provider === "zoho";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [settings, setSettings] = useState<ImapSettings>(() => emptySettings(""));
  /** Whether `settings` came from a lookup or an edit, rather than still being blank. */
  const [filled, setFilled] = useState(false);
  const [busy, setBusy] = useState<"finding" | "connecting" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validEmail = accountEmailSchema.safeParse(email).data;
  const parsedSettings = imapSettingsSchema.safeParse(settings);
  const working = busy !== null;
  const zohoRegion = /^(?:imap|imappro)\.zoho\.(com|eu|in|com\.au|jp|sa|uk)$/i.exec(settings.incoming.host)?.[1];

  /** The servers for this address: the provider's own configuration, or Zoho's when that was chosen. */
  const lookUp = async (address: string): Promise<ImapSettings | null> => {
    // expected: a failed lookup was recorded by the main process; the form falls back to manual settings.
    const found = await api.accounts.discoverImap(address).catch(() => null);
    return found ?? (zoho ? zohoSettings(address, "com", false) : null);
  };

  const changeEmail = (value: string) => {
    setSettings((previous) => followEmail(previous, email.trim(), value.trim()));
    setEmail(value);
    setError(null);
  };

  const toggleAdvanced = async () => {
    const opening = !advanced;
    setAdvanced(opening);
    if (!opening || filled || !validEmail) return;
    setBusy("finding");
    const found = await lookUp(validEmail);
    if (found) {
      setSettings(found);
      setFilled(true);
    }
    setBusy(null);
  };

  const connect = async () => {
    if (!validEmail || !password || working) return;
    setError(null);
    let chosen = settings;
    if (!advanced) {
      setBusy("finding");
      const found = await lookUp(validEmail);
      if (!found) {
        setSettings(emptySettings(validEmail));
        setFilled(true);
        setAdvanced(true);
        setError(SERVER_HELP);
        setBusy(null);
        return;
      }
      chosen = found;
      setSettings(found);
      setFilled(true);
    }
    const checked = imapSettingsSchema.safeParse(chosen);
    if (!checked.success) {
      setError("Check the server settings.");
      setBusy(null);
      return;
    }
    setBusy("connecting");
    try {
      onAdded(await api.accounts.add({
        kind: "password",
        provider: "imap",
        email: validEmail,
        password,
        imapSettings: checked.data,
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      noteShownError("Could not add the account", reason);
      setBusy(null);
    }
  };

  return (
    <>
      <ProviderFormHeader
        provider={provider}
        title={zoho ? "Connect Zoho Mail" : "Connect another email account"}
        disabled={working}
        onBack={onBack}
      />
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="imap-email">Email address</Label>
          <Input
            id="imap-email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@example.com"
            value={email}
            disabled={working}
            onChange={(event) => changeEmail(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="imap-password">{zoho ? "App password" : "Password or app password"}</Label>
          <Input
            id="imap-password"
            type="password"
            autoComplete="off"
            value={password}
            disabled={working}
            onChange={(event) => setPassword(event.target.value)}
          />
          <div className="text-xs text-muted-foreground">
            {zoho ? (
              <ol className="list-decimal space-y-1 pl-4">
                <li>Enable IMAP access in Zoho Mail (Settings → Mail Accounts → IMAP Access).</li>
                <li>
                  <a
                    className="text-sidebar-ring underline underline-offset-2"
                    href={`https://accounts.zoho.${zohoRegion ?? "com"}/home#multiTFA/modes`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Turn on two-factor authentication
                  </a>{" "}
                  for this Zoho account.
                </li>
                <li>
                  <a
                    className="text-sidebar-ring underline underline-offset-2"
                    href={`https://accounts.zoho.${zohoRegion ?? "com"}/home#security/app_password`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Create an app password
                  </a>{" "}
                  and paste it above.
                </li>
              </ol>
            ) : (
              <p>Use an app password if your provider requires one for email clients.</p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <button
            type="button"
            aria-expanded={advanced}
            aria-controls="imap-advanced"
            disabled={working}
            onClick={() => void toggleAdvanced()}
            className="-ml-1 flex items-center gap-1 rounded-sm px-1 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            <ChevronRight className={cn("size-4 transition-transform", advanced && "rotate-90")} />
            Advanced settings
          </button>
          {advanced && (
            <div id="imap-advanced" className="space-y-4">
              {busy === "finding" ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Looking up mail servers…
                </p>
              ) : (
                <>
                  <ServerFields
                    label="Incoming mail (IMAP)"
                    server={settings.incoming}
                    disabled={working}
                    onChange={(incoming) => {
                      setFilled(true);
                      setSettings((previous) => ({ ...previous, incoming }));
                    }}
                  />
                  <ServerFields
                    label="Outgoing mail (SMTP)"
                    server={settings.outgoing}
                    disabled={working}
                    onChange={(outgoing) => {
                      setFilled(true);
                      setSettings((previous) => ({ ...previous, outgoing }));
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="imap-server-saves-sent"
                      checked={settings.serverSavesSent}
                      disabled={working}
                      onCheckedChange={(checked) => {
                        setFilled(true);
                        setSettings((previous) => ({ ...previous, serverSavesSent: checked === true }));
                      }}
                    />
                    <Label htmlFor="imap-server-saves-sent">My provider saves a copy of sent mail</Label>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="corner-squircle rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </p>
        )}
        <Button
          type="submit"
          disabled={!validEmail || !password || working || (advanced && !parsedSettings.success)}
        >
          {working && <Loader2 className="animate-spin" />}
          {busy === "finding" ? "Finding mail settings…" : busy === "connecting" ? "Checking your connection…" : "Connect"}
        </Button>
      </form>
    </>
  );
}

function ServerFields({
  label,
  server,
  disabled,
  onChange,
}: {
  label: string;
  server: MailServer;
  disabled: boolean;
  onChange: (server: MailServer) => void;
}) {
  return (
    <fieldset disabled={disabled} className="grid grid-cols-2 gap-2">
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <label className="col-span-2 grid gap-1 text-sm">
        Server hostname
        <Input value={server.host} placeholder="mail.example.com" onChange={(event) => onChange({ ...server, host: event.target.value })} />
      </label>
      <label className="grid gap-1 text-sm">
        Port
        <Input
          type="number"
          min={1}
          max={65535}
          value={server.port || ""}
          onChange={(event) => onChange({ ...server, port: Number(event.target.value) })}
        />
      </label>
      <div className="grid gap-1 text-sm">
        <span>Encryption</span>
        <Select
          value={server.security}
          disabled={disabled}
          onValueChange={(value) => onChange({ ...server, security: value === "tls" ? "tls" : "starttls" })}
        >
          <SelectTrigger aria-label={`${label} encryption`}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="tls">SSL/TLS</SelectItem>
            <SelectItem value="starttls">STARTTLS</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <label className="col-span-2 grid gap-1 text-sm">
        Username
        <Input value={server.username} onChange={(event) => onChange({ ...server, username: event.target.value })} />
      </label>
    </fieldset>
  );
}
