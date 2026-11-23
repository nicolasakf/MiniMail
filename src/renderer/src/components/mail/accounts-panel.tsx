import { useEffect, useRef, useState } from "react";

import { Check, ImageOff, ImagePlus, Loader2, MoreHorizontal, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "@/lib/toast";

import type { AccountCapabilities } from "@shared/api";
import { accountLabel, MAX_ALIAS_LENGTH } from "@shared/accounts";
import { accountEmailSchema, microsoftTenantSchema } from "@shared/schemas";
import type { Account, AddAccountInput, Provider } from "@shared/types";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { fileToAvatar } from "@/lib/avatar-image";
import { cn } from "@/lib/utils";

import { SettingsPageHeader } from "../settings/fields";

import { AccountMark } from "./account-mark";
import { ChooseProvider, ProviderFormHeader, type SetupProvider } from "./add-account-shared";
import { Label } from "@/components/ui/label";
import { InfoLabel } from "./info-label";
import { ImapAccountForm } from "./imap-account-form";
import { noteShownError } from "@/lib/events";

type View = { name: "list" } | { name: "choose" } | { name: "form"; provider: SetupProvider };

const PROVIDER_LABEL: Record<Provider, string> = {
  gmail: "Gmail",
  outlook: "Outlook",
  zoho: "Zoho Mail",
  imap: "Other email",
};

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
  const [reconnecting, setReconnecting] = useState<string | null>(null);
  /** Id of the account whose alias is being edited. */
  const [renaming, setRenaming] = useState<string | null>(null);
  /** The account whose picture is being chosen; the hidden file input reads it. */
  const pictureFor = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // expected: a failure was recorded by the main process; the sign-in options just stay hidden.
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
            <SettingsPageHeader title="Accounts" />
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
            <Button variant="outline" onClick={() => setView({ name: "choose" })}>
              <Plus /> Add account
            </Button>
          </>
        )}

        {view.name === "choose" && (
          <ChooseProvider
            canGoBack={accounts.length > 0}
            onBack={() => setView({ name: "list" })}
            onChoose={(provider) => setView({ name: "form", provider })}
          />
        )}

        {view.name === "form" && (
          view.provider === "imap" || view.provider === "zoho" ? (
            <ImapAccountForm provider={view.provider} onBack={() => setView({ name: "choose" })} onAdded={accountAdded} />
          ) : (
            <AddAccountForm
              provider={view.provider}
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

const FORM_TITLES: Record<"gmail" | "outlook", string> = {
  gmail: "Connect Gmail",
  outlook: "Connect Microsoft mail",
};

function AddAccountForm({
  provider,
  capabilities,
  onBack,
  onAdded,
}: {
  provider: "gmail" | "outlook";
  capabilities: AccountCapabilities;
  onBack: () => void;
  onAdded: (account: Account) => void;
}) {
  const [email, setEmail] = useState("");
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
      noteShownError("Could not add the account", reason);
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
  /** With browser sign-in the address is only a hint; an app password needs it. */
  const emailOptional = provider === "outlook" || !showGmailPassword;

  const oauthButton = (label: string, enabled: boolean, onClick: () => void) => (
    <Button disabled={!enabled || busy !== null} onClick={onClick}>
      {busy === "oauth" && <Loader2 className="animate-spin" />}
      {busy === "oauth" ? "Finish signing in in your browser…" : label}
    </Button>
  );

  return (
    <>
      <ProviderFormHeader
        provider={provider}
        title={FORM_TITLES[provider]}
        disabled={busy !== null}
        onBack={onBack}
      />

      <div className="space-y-4">
        <div className="space-y-2">
          <InfoLabel htmlFor="account-email" info="The email address of this account.">
            {emailOptional ? "Email (optional)" : "Email"}
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
                  hint={
                    <ol className="list-decimal space-y-1 pl-4">
                      <li>
                        <a
                          className="text-sidebar-ring underline underline-offset-2"
                          href="https://myaccount.google.com/signinoptions/twosv"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Turn on 2-Step Verification
                        </a>{" "}
                        for this Google account.
                      </li>
                      <li>
                        <a
                          className="text-sidebar-ring underline underline-offset-2"
                          href="https://myaccount.google.com/apppasswords"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Create an app password
                        </a>{" "}
                        and paste it above.
                      </li>
                    </ol>
                  }
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
                <InfoLabel htmlFor="account-tenant" info="The Microsoft tenant ID or domain given by your IT administrator.">
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
                {!validTenant && <p className="text-sm text-destructive">Enter an organization domain or tenant ID.</p>}
              </div>
            )}
          </>
        )}

        {error && (
          <div
            role="alert"
            className={cn(
              "corner-squircle rounded-lg bg-destructive/10 p-3 text-sm text-destructive",
            )}
          >
            {error}
          </div>
        )}
      </div>

    </>
  );
}

function PasswordFields({
  password,
  onPasswordChange,
  hint,
}: {
  password: string;
  onPasswordChange: (value: string) => void;
  hint: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="account-password">App password</Label>
      <Input
        id="account-password"
        type="password"
        autoComplete="off"
        value={password}
        onChange={(event) => onPasswordChange(event.target.value)}
      />
      <div className="text-xs text-muted-foreground">{hint}</div>
    </div>
  );
}
