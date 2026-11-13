import { useEffect, useRef, useState } from "react";

import { ArrowLeft, Check, ImageOff, ImagePlus, LayoutDashboard, Loader2, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import type { AccountCapabilities } from "@shared/api";
import { accountLabel, MAX_ALIAS_LENGTH, providerForEmailDomain } from "@shared/accounts";
import { accountEmailSchema, microsoftTenantSchema } from "@shared/schemas";
import type { Account, AddAccountInput, Provider } from "@shared/types";

import gmailLogo from "@/assets/providers/gmail.svg";
import outlookLogo from "@/assets/providers/outlook.svg";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { fileToAvatar } from "@/lib/avatar-image";
import { cn } from "@/lib/utils";

import { SettingsPageHeader } from "../settings/fields";

import { AccountMark } from "./account-mark";
import { InfoLabel } from "./info-label";
import { ImapAccountForm } from "./imap-account-form";

type SetupProvider = Exclude<Provider, "zoho">;
type View = { name: "list" } | { name: "choose" } | { name: "form"; provider: SetupProvider };

const PROVIDER_LABEL: Record<Provider, string> = {
  gmail: "Gmail",
  outlook: "Outlook",
  zoho: "Zoho Mail",
  imap: "Other email",
};

function ProviderBadge({ provider }: { provider: SetupProvider }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
      {provider === "imap" ? (
        <LayoutDashboard aria-hidden="true" className="size-5 text-muted-foreground" />
      ) : (
        <img src={provider === "gmail" ? gmailLogo : outlookLogo} alt="" className="size-6 object-contain" />
      )}
    </span>
  );
}

function describeAccount(account: Account): string {
  if (account.provider === "outlook") {
    if (account.tenant || account.outlookKind === "work-school") return "Work or school";
    return account.outlookKind === "personal" ? "Personal" : "Microsoft sign-in";
  }
  if (account.provider === "imap") return "IMAP / SMTP";
  return account.auth === "password" ? "App password" : "Google sign-in";
}

interface AccountsPanelProps {
  /** Open straight on the add-account picker instead of the list. */
  startAdding: boolean;
  accounts: readonly Account[];
  onChanged: () => void;
  /** Tells the dialog an alias is being edited, so Escape cancels the edit instead of closing it. */
  onRenamingChange?: (renaming: boolean) => void;
}

/** Lists connected accounts and handles account setup and browser reauthorization. */
export function AccountsPanel({ startAdding, accounts, onChanged, onRenamingChange }: AccountsPanelProps) {
  const [view, setView] = useState<View>(() =>
    startAdding || accounts.length === 0 ? { name: "choose" } : { name: "list" },
  );
  const [capabilities, setCapabilities] = useState<AccountCapabilities>({
    googleOAuth: false,
    microsoftOAuth: false,
  });
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [reconnecting, setReconnecting] = useState<string | null>(null);
  /** Id of the account whose alias is being edited. */
  const [renaming, setRenaming] = useState<string | null>(null);
  /** The account whose picture is being chosen; the hidden file input reads it. */
  const pictureFor = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.accounts.capabilities().then(setCapabilities).catch(() => undefined);
  }, []);

  useEffect(() => {
    onRenamingChange?.(renaming !== null);
    return () => onRenamingChange?.(false);
  }, [renaming, onRenamingChange]);

  const accountAdded = (account: Account) => {
    toast.success(`Connected ${accountLabel(account)}`);
    onChanged();
    setView({ name: "list" });
  };

  const choosePicture = async (file: File | undefined) => {
    const accountId = pictureFor.current;
    pictureFor.current = null;
    if (!file || !accountId) return;
    try {
      await api.accounts.setAvatar(accountId, await fileToAvatar(file));
      toast.success("Picture updated");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const removePicture = async (account: Account) => {
    try {
      await api.accounts.setAvatar(account.id, null);
      toast.success("Picture removed");
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const remove = async (account: Account) => {
    try {
      await api.accounts.remove(account.id);
      toast.success(`Removed ${accountLabel(account)}`);
      setConfirmRemove(null);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const reconnect = async (account: Account, calendarAccess = false) => {
    setReconnecting(account.id);
    try {
      await api.accounts.reconnect(account.id, calendarAccess);
      toast.success(calendarAccess ? "Calendar access enabled" : `Reconnected ${accountLabel(account)}`);
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setReconnecting(null);
    }
  };

  return (
    <div className="flex max-w-2xl flex-col gap-4 p-6">
        {view.name === "list" && (
          <>
            <SettingsPageHeader
              title="Accounts"
              description="Mail accounts connected to MiniMail. Give each an alias and a picture to tell them apart."
            />
            <ul className="space-y-2">
              {accounts.map((account) => (
                <li
                  key={account.id}
                  className="corner-squircle flex items-center gap-3 rounded-xl border border-border p-3"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center">
                    <AccountMark account={account} size={36} />
                  </span>
                  {renaming === account.id ? (
                    <AliasEditor
                      account={account}
                      onCancel={() => setRenaming(null)}
                      onSaved={() => {
                        setRenaming(null);
                        onChanged();
                      }}
                    />
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{accountLabel(account)}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {account.alias ? `${account.email} · ` : ""}
                          {PROVIDER_LABEL[account.provider]} · {describeAccount(account)}
                        </div>
                      </div>
                      {confirmRemove === account.id ? (
                        <div className="flex items-center gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(null)}>
                            Keep
                          </Button>
                          <Button size="sm" variant="destructive" onClick={() => void remove(account)}>
                            Remove
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center">
                          {account.auth === "oauth" && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  aria-label={`Connection options for ${accountLabel(account)}`}
                                  title={reconnecting === account.id ? "Finish signing in in your browser" : "Connection options"}
                                  className="size-8"
                                  disabled={reconnecting !== null}
                                >
                                  {reconnecting === account.id ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  disabled={account.provider === "gmail" ? !capabilities.googleOAuth : !capabilities.microsoftOAuth}
                                  onSelect={() => void reconnect(account)}
                                >
                                  Reconnect
                                </DropdownMenuItem>
                                {account.provider === "outlook" && (
                                  <DropdownMenuItem
                                    disabled={!capabilities.microsoftOAuth}
                                    onSelect={() => void reconnect(account, true)}
                                  >
                                    Allow calendar access
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Choose a picture for ${accountLabel(account)}`}
                            title="Choose a picture"
                            className="size-8"
                            onClick={() => {
                              pictureFor.current = account.id;
                              fileInput.current?.click();
                            }}
                          >
                            <ImagePlus />
                          </Button>
                          {account.avatar && (
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Remove the picture of ${accountLabel(account)}`}
                              title="Remove the picture"
                              className="size-8"
                              onClick={() => void removePicture(account)}
                            >
                              <ImageOff />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Rename ${accountLabel(account)}`}
                            className="size-8"
                            onClick={() => {
                              setConfirmRemove(null);
                              setRenaming(account.id);
                            }}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Remove ${accountLabel(account)}`}
                            className="size-8"
                            onClick={() => {
                              setRenaming(null);
                              setConfirmRemove(account.id);
                            }}
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                void choosePicture(file);
              }}
            />
            <Button variant="outline" onClick={() => {
              setEmail("");
              setView({ name: "choose" });
            }}>
              <Plus /> Add account
            </Button>
          </>
        )}

        {view.name === "choose" && (
          <ChooseProvider
            email={email}
            onEmailChange={setEmail}
            canGoBack={accounts.length > 0}
            onBack={() => setView({ name: "list" })}
            onChoose={(provider) => setView({ name: "form", provider: provider === "zoho" ? "imap" : provider })}
          />
        )}

        {view.name === "form" && (
          view.provider === "imap" ? (
            <ImapAccountForm initialEmail={email} onBack={() => setView({ name: "choose" })} onAdded={accountAdded} />
          ) : (
            <AddAccountForm
              provider={view.provider}
              initialEmail={email}
              capabilities={capabilities}
              onBack={() => setView({ name: "choose" })}
              onAdded={accountAdded}
            />
          )
        )}
    </div>
  );
}

/** Inline editor for an account's alias; blank clears it. Enter saves, Escape cancels. */
function AliasEditor({
  account,
  onCancel,
  onSaved,
}: {
  account: Account;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(account.alias ?? "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const updated = await api.accounts.setAlias(account.id, value);
      toast.success(updated.alias ? `Now called "${updated.alias}"` : "Alias removed");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
      setBusy(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Input
        autoFocus
        value={value}
        maxLength={MAX_ALIAS_LENGTH}
        placeholder={account.email}
        aria-label={`Alias for ${account.email}`}
        disabled={busy}
        className="h-8 min-w-0 flex-1"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void save();
          } else if (event.key === "Escape") {
            onCancel(); // The settings dialog sees the same key and stays open while an alias is edited.
          }
        }}
      />
      <Button
        size="icon"
        variant="ghost"
        aria-label="Save alias"
        className="size-8"
        disabled={busy}
        onClick={() => void save()}
      >
        {busy ? <Loader2 className="animate-spin" /> : <Check />}
      </Button>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Cancel rename"
        className="size-8"
        disabled={busy}
        onClick={onCancel}
      >
        <X />
      </Button>
    </div>
  );
}

const CHOICES: { provider: SetupProvider; title: string; subtitle: string }[] = [
  { provider: "gmail", title: "Google", subtitle: "Gmail and Google Workspace" },
  { provider: "outlook", title: "Microsoft", subtitle: "Outlook and Microsoft 365" },
  { provider: "imap", title: "Other email", subtitle: "Zoho, iCloud, and other IMAP accounts" },
];

function ChooseProvider({
  email,
  onEmailChange,
  canGoBack,
  onBack,
  onChoose,
}: {
  email: string;
  onEmailChange: (value: string) => void;
  canGoBack: boolean;
  onBack: () => void;
  onChoose: (provider: Provider) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [showProviders, setShowProviders] = useState(false);

  const discover = async () => {
    setBusy(true);
    try {
      const provider = await api.accounts.discover(email.trim()).catch(() => providerForEmailDomain(email));
      onChoose(provider ?? "imap");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SettingsPageHeader title="Add an account" description="Enter the email address you want to connect." />
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy && accountEmailSchema.safeParse(email).success) void discover();
        }}
      >
        <Label htmlFor="discover-email">Email address</Label>
        <Input
          id="discover-email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          disabled={busy}
          onChange={(event) => onEmailChange(event.target.value)}
        />
        <Button type="submit" disabled={busy || !accountEmailSchema.safeParse(email).success}>
          {busy && <Loader2 className="animate-spin" />}
          {busy ? "Finding your provider…" : "Continue"}
        </Button>
      </form>
      {!showProviders && (
        <Button variant="ghost" disabled={busy} onClick={() => setShowProviders(true)}>
          Choose a provider
        </Button>
      )}
      {showProviders && (
        <div className="grid gap-2">
          {CHOICES.map(({ provider, title, subtitle }) => (
            <button
              key={provider}
              type="button"
              disabled={busy}
              onClick={() => onChoose(provider)}
              className="corner-squircle flex items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-accent/50"
            >
              <ProviderBadge provider={provider} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{title}</span>
                <span className="block text-xs text-muted-foreground">{subtitle}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      {canGoBack && (
        <Button variant="ghost" className="justify-self-start" disabled={busy} onClick={onBack}>
          <ArrowLeft /> Back to accounts
        </Button>
      )}
    </>
  );
}

const FORM_TITLES: Record<"gmail" | "outlook", string> = {
  gmail: "Connect Gmail",
  outlook: "Connect Microsoft mail",
};

function AddAccountForm({
  provider,
  initialEmail,
  capabilities,
  onBack,
  onAdded,
}: {
  provider: "gmail" | "outlook";
  initialEmail: string;
  capabilities: AccountCapabilities;
  onBack: () => void;
  onAdded: (account: Account) => void;
}) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [tenant, setTenant] = useState("");
  const [busy, setBusy] = useState<"oauth" | "password" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualGmail, setManualGmail] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  const submit = async (input: AddAccountInput, mode: "oauth" | "password") => {
    setBusy(mode);
    setError(null);
    try {
      onAdded(await api.accounts.add(input));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(null);
    }
  };

  const hint = email.trim() || undefined;
  const validEmail = accountEmailSchema.safeParse(email).success;
  const validHint = !hint || validEmail;
  const tenantOverride = tenant.trim() || undefined;
  const validTenant = !tenantOverride || microsoftTenantSchema.safeParse(tenantOverride).success;
  const canSubmitPassword = validEmail && password.length > 0 && busy === null;
  const showGmailPassword = manualGmail || !capabilities.googleOAuth;

  const oauthButton = (label: string, enabled: boolean, onClick: () => void) => (
    <Button disabled={!enabled || busy !== null} onClick={onClick}>
      {busy === "oauth" && <Loader2 className="animate-spin" />}
      {busy === "oauth" ? "Finish signing in in your browser…" : label}
    </Button>
  );

  return (
    <>
      <SettingsPageHeader
        title={FORM_TITLES[provider]}
        description="Sign in to give MiniMail access to your mail."
      />

      <div className="space-y-4">
        <div className="space-y-2">
          <InfoLabel htmlFor="account-email" info="Your provider uses this address to find your account.">
            Email
          </InfoLabel>
          <Input
            id="account-email"
            type="email"
            autoComplete="email"
            value={email}
            placeholder="you@example.com"
            disabled={busy !== null}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        {provider === "gmail" && (
          <>
            {capabilities.googleOAuth && oauthButton("Continue with Google", validHint, () =>
              void submit({ kind: "oauth", provider: "gmail", email: hint }, "oauth"),
            )}
            {!capabilities.googleOAuth && (
              <p className="text-xs text-muted-foreground">
                Google browser sign-in is unavailable in this build. You can connect with an app password.
              </p>
            )}
            {capabilities.googleOAuth && (
              <Button variant="ghost" aria-expanded={manualGmail} disabled={busy !== null} onClick={() => setManualGmail(!manualGmail)}>
                {manualGmail ? "Hide app password setup" : "Use an app password"}
              </Button>
            )}
            {showGmailPassword && (
              <>
                <PasswordFields
                  password={password}
                  onPasswordChange={setPassword}
                  info="Enable 2-Step Verification, then create an app password at myaccount.google.com/apppasswords."
                />
                <Button
                  variant="secondary"
                  disabled={!canSubmitPassword}
                  onClick={() =>
                    void submit({ kind: "password", provider: "gmail", email: email.trim(), password }, "password")
                  }
                >
                  {busy === "password" && <Loader2 className="animate-spin" />}
                  Add with app password
                </Button>
              </>
            )}
          </>
        )}

        {provider === "outlook" && (
          <>
            {oauthButton("Continue with Microsoft", capabilities.microsoftOAuth && validHint && validTenant, () =>
              void submit(
                {
                  kind: "oauth",
                  provider: "outlook",
                  tenant: tenantOverride,
                  email: hint,
                },
                "oauth",
              ),
            )}
            {!capabilities.microsoftOAuth && (
              <p className="text-xs text-muted-foreground">
                Microsoft browser sign-in is unavailable in this build.
              </p>
            )}
            {capabilities.microsoftOAuth && (
              <Button variant="ghost" aria-expanded={advanced} disabled={busy !== null} onClick={() => setAdvanced(!advanced)}>
                {advanced ? "Hide advanced settings" : "Advanced settings"}
              </Button>
            )}
            {advanced && (
              <div className="space-y-2">
                <InfoLabel htmlFor="account-tenant" info="Enter a tenant ID or domain if your IT administrator gave you one.">
                  Organization (optional)
                </InfoLabel>
                <Input
                  id="account-tenant"
                  value={tenant}
                  placeholder="university.edu"
                  disabled={busy !== null}
                  aria-invalid={!validTenant}
                  onChange={(event) => setTenant(event.target.value)}
                />
                {!validTenant && <p className="text-sm text-red-400">Enter an organization domain or tenant ID.</p>}
              </div>
            )}
          </>
        )}

        {error && (
          <div
            role="alert"
            className={cn(
              "corner-squircle rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300",
            )}
          >
            {error}
          </div>
        )}
      </div>

      <Button
        variant="ghost"
        className="justify-self-start"
        disabled={busy !== null}
        onClick={onBack}
      >
        <ArrowLeft /> Back
      </Button>
    </>
  );
}

function PasswordFields({
  password,
  onPasswordChange,
  info,
}: {
  password: string;
  onPasswordChange: (value: string) => void;
  info: string;
}) {
  return (
    <div className="space-y-2">
      <InfoLabel htmlFor="account-password" info={info}>
        App password
      </InfoLabel>
      <Input
        id="account-password"
        type="password"
        autoComplete="off"
        value={password}
        onChange={(event) => onPasswordChange(event.target.value)}
      />
    </div>
  );
}
