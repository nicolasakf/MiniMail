import { useEffect, useRef, useState } from "react";

import { ArrowLeft, Check, ImageOff, ImagePlus, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import type { AccountCapabilities } from "@shared/api";
import { accountLabel, MAX_ALIAS_LENGTH } from "@shared/accounts";
import type { Account, AddAccountInput, Provider, ZohoRegion } from "@shared/types";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { fileToAvatar } from "@/lib/avatar-image";
import { cn } from "@/lib/utils";

import { AccountMark } from "./account-mark";
import { InfoLabel } from "./info-label";

type Choice = "gmail" | "outlook-personal" | "outlook-work" | "zoho";
type View = { name: "list" } | { name: "choose" } | { name: "form"; choice: Choice };

const PROVIDER_STYLE: Record<Provider, { label: string; hue: number }> = {
  gmail: { label: "Gmail", hue: 4 },
  outlook: { label: "Outlook", hue: 210 },
  zoho: { label: "Zoho Mail", hue: 40 },
};

const ZOHO_REGIONS: { value: ZohoRegion; label: string }[] = [
  { value: "com", label: "United States (.com)" },
  { value: "eu", label: "Europe (.eu)" },
  { value: "in", label: "India (.in)" },
  { value: "com.au", label: "Australia (.com.au)" },
  { value: "jp", label: "Japan (.jp)" },
];

/** Colored letter tile standing in for a provider logo. */
function ProviderBadge({ provider }: { provider: Provider }) {
  const { label, hue } = PROVIDER_STYLE[provider];
  return (
    <span
      className="flex size-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
      style={{ background: `hsl(${hue} 70% 50% / 0.18)`, color: `hsl(${hue} 85% 66%)` }}
    >
      {label[0]}
    </span>
  );
}

function describeAccount(account: Account): string {
  if (account.provider === "outlook") {
    return account.outlookKind === "work-school" ? "Work or school" : "Personal";
  }
  return account.auth === "password" ? "App password" : "Google sign-in";
}

interface AccountsDialogProps {
  open: boolean;
  /** Open straight on the add-account picker instead of the list. */
  startAdding: boolean;
  accounts: readonly Account[];
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

/** Lists connected accounts and walks through adding Gmail, Outlook (personal or school) or Zoho. */
export function AccountsDialog({
  open,
  startAdding,
  accounts,
  onOpenChange,
  onChanged,
}: AccountsDialogProps) {
  const [view, setView] = useState<View>({ name: "list" });
  const [capabilities, setCapabilities] = useState<AccountCapabilities>({
    googleOAuth: false,
    microsoftOAuth: false,
  });
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  /** Id of the account whose alias is being edited. */
  const [renaming, setRenaming] = useState<string | null>(null);
  /** The account whose picture is being chosen; the hidden file input reads it. */
  const pictureFor = useRef<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setView(startAdding || accounts.length === 0 ? { name: "choose" } : { name: "list" });
    setConfirmRemove(null);
    setRenaming(null);
    api.accounts.capabilities().then(setCapabilities).catch(() => undefined);
    // Only re-seed the view when the dialog opens, not whenever the account list refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startAdding]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl"
        onEscapeKeyDown={(event) => {
          // Escape while renaming cancels the rename; the dialog stays open.
          if (renaming) {
            event.preventDefault();
            setRenaming(null);
          }
        }}
      >
        {view.name === "list" && (
          <>
            <DialogHeader>
              <DialogTitle>Accounts</DialogTitle>
              <DialogDescription>
                Mail accounts connected to MiniMail. Give each an alias and a picture to tell them apart.
              </DialogDescription>
            </DialogHeader>
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
                          {PROVIDER_STYLE[account.provider].label} · {describeAccount(account)}
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
            onChoose={(choice) => setView({ name: "form", choice })}
          />
        )}

        {view.name === "form" && (
          <AddAccountForm
            choice={view.choice}
            capabilities={capabilities}
            onBack={() => setView({ name: "choose" })}
            onAdded={(account) => {
              toast.success(`Connected ${accountLabel(account)}`);
              onChanged();
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
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

/** Optional alias field shown while adding an account. */
function AliasField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-2">
      <InfoLabel
        htmlFor="account-alias"
        info="A short name for this account, like Work or Uni. It replaces the address in MiniMail's account menu and lists. Only you see it, it is never sent in mail, and you can change it later in Manage accounts."
      >
        Alias (optional)
      </InfoLabel>
      <Input
        id="account-alias"
        value={value}
        maxLength={MAX_ALIAS_LENGTH}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

const CHOICES: { choice: Choice; provider: Provider; title: string; subtitle: string }[] =
  [
    { choice: "gmail", provider: "gmail", title: "Gmail", subtitle: "Google account" },
    {
      choice: "outlook-personal",
      provider: "outlook",
      title: "Outlook",
      subtitle: "Personal (outlook.com, hotmail, live)",
    },
    {
      choice: "outlook-work",
      provider: "outlook",
      title: "Outlook for work or school",
      subtitle: "University or company Microsoft 365",
    },
    { choice: "zoho", provider: "zoho", title: "Zoho Mail", subtitle: "Personal or custom domain" },
  ];

function ChooseProvider({
  canGoBack,
  onBack,
  onChoose,
}: {
  canGoBack: boolean;
  onBack: () => void;
  onChoose: (choice: Choice) => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Add an account</DialogTitle>
        <DialogDescription>Choose where your mail lives.</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        {CHOICES.map(({ choice, provider, title, subtitle }) => (
          <button
            key={choice}
            type="button"
            onClick={() => onChoose(choice)}
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
      {canGoBack && (
        <Button variant="ghost" className="justify-self-start" onClick={onBack}>
          <ArrowLeft /> Back to accounts
        </Button>
      )}
    </>
  );
}

const FORM_TITLES: Record<Choice, string> = {
  gmail: "Connect Gmail",
  "outlook-personal": "Connect Outlook",
  "outlook-work": "Connect Outlook for work or school",
  zoho: "Connect Zoho Mail",
};

function AddAccountForm({
  choice,
  capabilities,
  onBack,
  onAdded,
}: {
  choice: Choice;
  capabilities: AccountCapabilities;
  onBack: () => void;
  onAdded: (account: Account) => void;
}) {
  const [email, setEmail] = useState("");
  const [alias, setAlias] = useState("");
  const [password, setPassword] = useState("");
  const [tenant, setTenant] = useState("");
  const [region, setRegion] = useState<ZohoRegion>("com");
  const [workplace, setWorkplace] = useState(true);
  const [busy, setBusy] = useState<"oauth" | "password" | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const aliasInput = alias.trim() || undefined;
  const canSubmitPassword = email.includes("@") && password.length > 0 && busy === null;

  const oauthButton = (label: string, enabled: boolean, onClick: () => void) => (
    <Button disabled={!enabled || busy !== null} onClick={onClick}>
      {busy === "oauth" && <Loader2 className="animate-spin" />}
      {busy === "oauth" ? "Finish signing in in your browser…" : label}
    </Button>
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>{FORM_TITLES[choice]}</DialogTitle>
        <DialogDescription className="sr-only">Sign in to add this account.</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {(choice === "gmail" || choice === "outlook-personal" || choice === "outlook-work") && (
          <div className="space-y-2">
            <InfoLabel
              htmlFor="account-email"
              info="Optional. Pre-fills the sign-in page so the right account is chosen."
            >
              Email
            </InfoLabel>
            <Input
              id="account-email"
              type="email"
              value={email}
              placeholder={choice === "outlook-work" ? "you@university.edu" : "you@example.com"}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
        )}

        {choice !== "zoho" && (
          <AliasField
            value={alias}
            onChange={setAlias}
            placeholder={choice === "outlook-work" ? "University" : "Personal"}
          />
        )}

        {choice === "outlook-work" && (
          <div className="space-y-2">
            <InfoLabel
              htmlFor="account-tenant"
              info="Only needed if sign-in fails. Use your organization's domain (for example university.edu) or its tenant id. Many universities require an IT administrator to approve new mail apps before you can sign in."
            >
              Organization (optional)
            </InfoLabel>
            <Input
              id="account-tenant"
              value={tenant}
              placeholder="university.edu"
              onChange={(event) => setTenant(event.target.value)}
            />
          </div>
        )}

        {choice === "gmail" && (
          <>
            {oauthButton("Sign in with Google", capabilities.googleOAuth, () =>
              void submit({ kind: "oauth", provider: "gmail", email: hint, alias: aliasInput }, "oauth"),
            )}
            {!capabilities.googleOAuth && (
              <p className="text-xs text-muted-foreground">
                Google sign-in needs an OAuth client id in this build (see the README). You can use
                an app password instead.
              </p>
            )}
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or use an app password
              <span className="h-px flex-1 bg-border" />
            </div>
            <PasswordFields
              password={password}
              onPasswordChange={setPassword}
              info="Requires 2-Step Verification on the Google account. Create one at myaccount.google.com/apppasswords. Your normal password will not work."
            />
            <Button
              variant="secondary"
              disabled={!canSubmitPassword}
              onClick={() =>
                void submit(
                  { kind: "password", provider: "gmail", email: email.trim(), password, alias: aliasInput },
                  "password",
                )
              }
            >
              {busy === "password" && <Loader2 className="animate-spin" />}
              Add with app password
            </Button>
          </>
        )}

        {(choice === "outlook-personal" || choice === "outlook-work") && (
          <>
            {oauthButton("Sign in with Microsoft", capabilities.microsoftOAuth, () =>
              void submit(
                {
                  kind: "oauth",
                  provider: "outlook",
                  outlookKind: choice === "outlook-work" ? "work-school" : "personal",
                  tenant: choice === "outlook-work" ? tenant.trim() || undefined : undefined,
                  email: hint,
                  alias: aliasInput,
                },
                "oauth",
              ),
            )}
            {!capabilities.microsoftOAuth && (
              <p className="text-xs text-muted-foreground">
                Microsoft sign-in needs an Azure app client id in this build (see the README).
              </p>
            )}
          </>
        )}

        {choice === "zoho" && (
          <>
            <div className="space-y-2">
              <Label htmlFor="zoho-email">Email</Label>
              <Input
                id="zoho-email"
                type="email"
                value={email}
                placeholder="you@yourdomain.com"
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <AliasField value={alias} onChange={setAlias} placeholder="Work" />
            <PasswordFields
              password={password}
              onPasswordChange={setPassword}
              info="Enable IMAP in Zoho Mail (Settings, Mail Accounts, IMAP Access). If two-factor authentication is on, create an application-specific password under Zoho Accounts, Security, App Passwords."
            />
            <div className="space-y-2">
              <InfoLabel
                htmlFor="zoho-region"
                info="The data center your Zoho account lives in. Check the address you use to sign in to Zoho Mail (zoho.com, zoho.eu, ...)."
              >
                Region
              </InfoLabel>
              <Select value={region} onValueChange={(value) => setRegion(value as ZohoRegion)}>
                <SelectTrigger id="zoho-region">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ZOHO_REGIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="zoho-workplace"
                checked={workplace}
                onCheckedChange={(checked) => setWorkplace(checked === true)}
              />
              <InfoLabel
                htmlFor="zoho-workplace"
                info="Mailboxes on your own domain (paid Zoho plans) use the imappro/smtppro servers. Free @zoho.com mailboxes use imap/smtp. Untick this for a free @zoho.com address."
              >
                Custom domain (Zoho Workplace)
              </InfoLabel>
            </div>
            <Button
              disabled={!canSubmitPassword}
              onClick={() =>
                void submit(
                  {
                    kind: "password",
                    provider: "zoho",
                    email: email.trim(),
                    password,
                    alias: aliasInput,
                    zohoRegion: region,
                    zohoWorkplace: workplace,
                  },
                  "password",
                )
              }
            >
              {busy === "password" && <Loader2 className="animate-spin" />}
              {busy === "password" ? "Checking login…" : "Connect Zoho Mail"}
            </Button>
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
