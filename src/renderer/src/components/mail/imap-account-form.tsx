import { useEffect, useState } from "react";

import { ArrowLeft, Loader2 } from "lucide-react";

import { imapSettingsSchema, type ImapSettings, type MailServer } from "@shared/imap-settings";
import { accountEmailSchema } from "@shared/schemas";
import type { Account } from "@shared/types";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";

import { SettingsPageHeader } from "../settings/fields";

function emptySettings(email: string): ImapSettings {
  return {
    incoming: { host: "", port: 993, security: "tls", username: email },
    outgoing: { host: "", port: 587, security: "starttls", username: email },
    serverSavesSent: false,
  };
}

export function ImapAccountForm({
  initialEmail,
  onBack,
  onAdded,
}: {
  initialEmail: string;
  onBack: () => void;
  onAdded: (account: Account) => void;
}) {
  const [email, setEmail] = useState(initialEmail.trim());
  const [password, setPassword] = useState("");
  const [lookup, setLookup] = useState(() => accountEmailSchema.safeParse(initialEmail).data);
  const [settings, setSettings] = useState(() => emptySettings(initialEmail.trim()));
  const [finding, setFinding] = useState(Boolean(lookup));
  const [manual, setManual] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lookup) return;
    let current = true;
    void api.accounts.discoverImap(lookup).catch(() => null).then((found) => {
      if (!current) return;
      setSettings(found ?? emptySettings(lookup));
      setManual(!found);
      setFinding(false);
    });
    return () => { current = false; };
  }, [lookup]);

  const validEmail = accountEmailSchema.safeParse(email).data;
  const parsedSettings = imapSettingsSchema.safeParse(settings);
  const ready = Boolean(validEmail && validEmail === lookup && !finding);
  const zohoRegion = /^(?:imap|imappro)\.zoho\.(com|eu|in|com\.au|jp|sa|uk)$/i.exec(settings.incoming.host)?.[1];

  const connect = async () => {
    if (!ready || !validEmail || !password || !parsedSettings.success || connecting) return;
    setConnecting(true);
    setError(null);
    try {
      onAdded(await api.accounts.add({
        kind: "password",
        provider: "imap",
        email: validEmail,
        password,
        imapSettings: parsedSettings.data,
      }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setManual(true);
      setConnecting(false);
    }
  };

  return (
    <>
      <SettingsPageHeader title="Other email" description="Connect an account that supports IMAP and SMTP." />
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) {
            void connect();
          } else if (validEmail && !finding) {
            setError(null);
            setFinding(true);
            setLookup(validEmail);
          }
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="imap-email">Email address</Label>
          <Input
            id="imap-email"
            type="email"
            autoComplete="email"
            value={email}
            disabled={finding || connecting}
            onChange={(event) => {
              setEmail(event.target.value);
              setPassword("");
              setError(null);
            }}
          />
        </div>
        {ready && (
          <>
            <div className="space-y-2">
              <Label htmlFor="imap-password">Password or app password</Label>
              <Input
                id="imap-password"
                type="password"
                autoComplete="off"
                value={password}
                disabled={connecting}
                onChange={(event) => setPassword(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {zohoRegion
                  ? <>Enable IMAP in Zoho Mail. If you use two-factor authentication, create an app password in <a className="underline" href={`https://accounts.zoho.${zohoRegion}/`} target="_blank" rel="noreferrer">Zoho Accounts</a>.</>
                  : "Use an app password if your provider requires one for email clients."}
              </p>
              {!manual && <p className="text-xs text-muted-foreground">Servers: {settings.incoming.host} and {settings.outgoing.host}</p>}
            </div>
            <Button
              type="button"
              variant="ghost"
              className="justify-self-start"
              aria-expanded={manual}
              disabled={connecting}
              onClick={() => setManual(!manual)}
            >
              {manual ? "Hide server settings" : "Manual setup"}
            </Button>
            {manual && (
              <div className="space-y-4">
                <ServerFields
                  label="Incoming mail (IMAP)"
                  server={settings.incoming}
                  disabled={connecting}
                  onChange={(incoming) => setSettings((previous) => ({ ...previous, incoming }))}
                />
                <ServerFields
                  label="Outgoing mail (SMTP)"
                  server={settings.outgoing}
                  disabled={connecting}
                  onChange={(outgoing) => setSettings((previous) => ({ ...previous, outgoing }))}
                />
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="imap-server-saves-sent"
                    checked={settings.serverSavesSent}
                    disabled={connecting}
                    onCheckedChange={(checked) =>
                      setSettings((previous) => ({ ...previous, serverSavesSent: checked === true }))
                    }
                  />
                  <Label htmlFor="imap-server-saves-sent">My provider saves a copy of sent mail</Label>
                </div>
              </div>
            )}
          </>
        )}
        {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
        <Button
          type="submit"
          disabled={!validEmail || finding || connecting || (ready && (!parsedSettings.success || !password))}
        >
          {(finding || connecting) && <Loader2 className="animate-spin" />}
          {finding ? "Finding mail settings…" : connecting ? "Checking your connection…" : ready ? "Connect" : "Find settings"}
        </Button>
      </form>
      <Button variant="ghost" className="justify-self-start" disabled={connecting} onClick={onBack}>
        <ArrowLeft /> Back
      </Button>
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
