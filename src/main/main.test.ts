import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  actionSchema,
  addAccountSchema,
  draftSchema,
  idsSchema,
  listQuerySchema,
} from "@shared/schemas";
import type { Account, MessageSummary } from "@shared/types";

import {
  microsoftAuthority,
  oauthCapabilities,
  OAuthNotConfiguredError,
  refreshAccessToken,
  signInWithGoogle,
  signInWithMicrosoft,
} from "./oauth";
import { GraphProvider } from "./providers/graph";
import { endpointsFor } from "./providers/imap";

const realFetch = globalThis.fetch;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** Replaces fetch with a handler and records every call it receives. */
function stubFetch(handler: (call: RecordedCall) => Response | Promise<Response>): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const call: RecordedCall = {
        url: String(input),
        method: init?.method ?? "GET",
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body === undefined ? undefined : String(init.body),
      };
      calls.push(call);
      return handler(call);
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const outlookAccount: Account = {
  id: "acc",
  provider: "outlook",
  email: "me@university.edu",
  displayName: "Me",
  auth: "oauth",
  hue: 10,
  outlookKind: "work-school",
};

describe("GraphProvider", () => {
  const provider = () => new GraphProvider(outlookAccount, async () => "tok");

  const graphMessage = {
    id: "AAMk-1=",
    conversationId: "conv-1",
    subject: "Invitation: Sync @ Tue 3pm",
    from: { emailAddress: { name: "Priya", address: "priya@university.edu" } },
    toRecipients: [{ emailAddress: { name: "Me", address: "me@university.edu" } }],
    receivedDateTime: "2026-11-09T12:00:00Z",
    bodyPreview: "Hello   world\n\n> quoted",
    isRead: false,
    hasAttachments: true,
    flag: { flagStatus: "flagged" },
    internetMessageHeaders: [{ name: "List-Unsubscribe", value: "<mailto:u@x.com>" }],
  };

  it("records sender authentication from the topmost Authentication-Results header", async () => {
    const withAuth = (id: string, headers: { name: string; value: string }[] | undefined) => ({
      ...graphMessage,
      id,
      conversationId: id,
      from: { emailAddress: { name: "Acme", address: "no-reply@acme.com" } },
      internetMessageHeaders: headers,
    });
    stubFetch(() =>
      json({
        value: [
          withAuth("a", [{ name: "Authentication-Results", value: "spf=pass; dmarc=pass header.from=acme.com" }]),
          withAuth("b", [
            { name: "Authentication-Results", value: "dmarc=fail header.from=acme.com" },
            { name: "Authentication-Results", value: "planted; dmarc=pass" },
          ]),
          withAuth("c", [{ name: "Subject", value: "x" }]),
          withAuth("d", undefined),
        ],
      }),
    );

    const byId = new Map((await provider().list("inbox", 50)).map((m) => [m.threadId, m.authenticated]));
    expect(byId.get("a")).toBe(true);
    expect(byId.get("b")).toBe(false);
    expect(byId.get("c")).toBe(false);
    expect(byId.get("d")).toBeUndefined();
  });

  it("pages past Graph's 100-message limit up to the window, following only Graph's own links", async () => {
    const page = (from: number, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        ...graphMessage,
        id: `m${from + index}`,
        conversationId: `c${from + index}`,
      }));
    const calls = stubFetch((call) => {
      if (call.url.includes("skip=100")) {
        return json({ value: page(100, 100), "@odata.nextLink": "https://evil.example/steal?skip=200" });
      }
      return json({
        value: page(0, 100),
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skip=100",
      });
    });

    expect(await provider().list("inbox", 150)).toHaveLength(150);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("$top=100");

    // A link that leaves Graph is never followed with the token.
    const all = await provider().list("inbox", 500);
    expect(all).toHaveLength(200);
    expect(calls.some((call) => call.url.includes("evil.example"))).toBe(false);
  });

  it("maps Graph messages to summaries and classifies them", async () => {
    const calls = stubFetch(() =>
      json({
        value: [
          graphMessage,
          {
            ...graphMessage,
            id: "AAMk-2=",
            conversationId: "conv-2",
            subject: "Build failed",
            from: { emailAddress: { name: "GitHub", address: "notifications@github.com" } },
            isRead: true,
            hasAttachments: false,
            flag: { flagStatus: "notFlagged" },
            receivedDateTime: "2026-11-08T12:00:00Z",
          },
        ],
      }),
    );

    const messages = await provider().list("inbox", 50);

    expect(calls[0].url).toContain("/me/mailFolders/inbox/messages?$top=50");
    expect(calls[0].headers.authorization).toBe("Bearer tok");
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      id: "acc|inbox|AAMk-1=",
      threadId: "conv-1",
      subject: "Invitation: Sync @ Tue 3pm",
      from: { name: "Priya", email: "priya@university.edu" },
      snippet: "Hello world",
      unread: true,
      pinned: true,
      hasAttachments: true,
      signal: "invitation",
      categoryId: null,
      answered: false,
    });
    expect(messages[1]).toMatchObject({ unread: false, pinned: false, signal: "notification" });
  });

  it("reads Outlook's last-verb property to know a message was replied to", async () => {
    const calls = stubFetch(() =>
      json({
        value: [
          {
            id: "r1",
            subject: "Re: plans",
            from: { emailAddress: { name: "Sam", address: "sam@x.com" } },
            receivedDateTime: "2026-11-08T12:00:00Z",
            singleValueExtendedProperties: [{ id: "Integer 0x1081", value: "102" }],
          },
          {
            id: "r2",
            subject: "FYI",
            from: { emailAddress: { name: "Sam", address: "sam@x.com" } },
            receivedDateTime: "2026-11-07T12:00:00Z",
            singleValueExtendedProperties: [{ id: "Integer 0x1081", value: "104" }],
          },
        ],
      }),
    );
    const messages = await provider().list("inbox", 10);
    expect(decodeURIComponent(calls[0].url)).toContain("singleValueExtendedProperties($filter=id eq 'Integer 0x1081')");
    expect(messages.map((m) => m.answered)).toEqual([true, false]);
  });

  it("filters the pinned view on the server instead of ordering", async () => {
    const calls = stubFetch(() => json({ value: [] }));
    await provider().list("pinned", 25);
    expect(calls[0].url).toContain("/me/mailFolders/inbox/messages");
    expect(decodeURIComponent(calls[0].url)).toContain("flag/flagStatus eq 'flagged'");
    expect(calls[0].url).not.toContain("orderby");
  });

  it("caps a page at 100 messages, the Graph maximum for this query", async () => {
    const calls = stubFetch(() => json({ value: [] }));
    await provider().list("inbox", 500);
    expect(calls[0].url).toContain("$top=100");
  });

  it("sends the right request for each action", async () => {
    const calls = stubFetch(() => new Response(null, { status: 204 }));
    const p = provider();
    await p.act("markRead", "inbox", ["id/1"]);
    await p.act("pin", "inbox", ["id/1"]);
    await p.act("archive", "inbox", ["id/1"]);
    await p.act("trash", "inbox", ["id/1"]);
    await p.act("spam", "inbox", ["id/1"]);
    await p.act("deleteForever", "trash", ["id/1"]);

    expect(calls.map((c) => `${c.method} ${c.url.replace("https://graph.microsoft.com/v1.0", "")}`)).toEqual([
      "PATCH /me/messages/id%2F1",
      "PATCH /me/messages/id%2F1",
      "POST /me/messages/id%2F1/move",
      "POST /me/messages/id%2F1/move",
      "POST /me/messages/id%2F1/move",
      "DELETE /me/messages/id%2F1",
    ]);
    expect(JSON.parse(calls[0].body ?? "")).toEqual({ isRead: true });
    expect(JSON.parse(calls[1].body ?? "")).toEqual({ flag: { flagStatus: "flagged" } });
    expect(JSON.parse(calls[2].body ?? "")).toEqual({ destinationId: "archive" });
    expect(JSON.parse(calls[3].body ?? "")).toEqual({ destinationId: "deleteditems" });
    expect(JSON.parse(calls[4].body ?? "")).toEqual({ destinationId: "junkemail" });
  });

  it("fetches full messages with html bodies and skips inline attachments", async () => {
    const calls = stubFetch(() =>
      json({
        ...graphMessage,
        body: { contentType: "html", content: "<p>Hi</p>" },
        ccRecipients: [{ emailAddress: { name: "Lee", address: "lee@x.com" } }],
        internetMessageId: "<abc@mail>",
        internetMessageHeaders: [{ name: "References", value: "<r1@x> <r2@x>" }],
        attachments: [
          { name: "notes.pdf", contentType: "application/pdf", size: 10, isInline: false },
          { name: "logo.png", contentType: "image/png", size: 3, isInline: true },
        ],
      }),
    );
    const [detail] = await provider().get("inbox", ["AAMk-1="]);

    expect(calls[0].headers.Prefer).toBe('outlook.body-content-type="html"');
    expect(detail).toMatchObject({
      html: "<p>Hi</p>",
      text: null,
      messageId: "<abc@mail>",
      references: ["<r1@x>", "<r2@x>"],
      cc: [{ name: "Lee", email: "lee@x.com" }],
      attachments: [{ filename: "notes.pdf", contentType: "application/pdf", size: 10 }],
    });
  });

  it("sends mail and saves a copy to Sent Items", async () => {
    const calls = stubFetch(() => new Response(null, { status: 202 }));
    await provider().send({
      accountId: "acc",
      to: [{ name: "Sam", email: "sam@x.com" }],
      cc: [],
      bcc: [{ name: "", email: "hidden@x.com" }],
      subject: "Hi",
      text: "Body",
    });
    expect(calls[0].url).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    const payload = JSON.parse(calls[0].body ?? "");
    expect(payload.saveToSentItems).toBe(true);
    expect(payload.message.toRecipients).toEqual([{ emailAddress: { name: "Sam", address: "sam@x.com" } }]);
    expect(payload.message.bccRecipients[0].emailAddress.address).toBe("hidden@x.com");
  });

  const replyDraft = (mode: "reply" | "replyAll" | "forward") => ({
    accountId: "acc",
    to: [{ name: "Priya", email: "priya@university.edu" }],
    cc: [],
    bcc: [],
    subject: "Re: Hi",
    text: "Sure.\n\n> Hi",
    inReplyTo: { messageId: "<abc@mail>", nativeId: "acc|inbox|AAMk-1=", references: [], mode },
  });
  const path = (call: RecordedCall) =>
    `${call.method} ${call.url.replace("https://graph.microsoft.com/v1.0", "")}`;

  it("sends a reply through a reply draft so Outlook threads it and marks the original", async () => {
    const calls = stubFetch((call) =>
      call.url.endsWith("/createReplyAll") ? json({ id: "draft/1" }, 201) : new Response(null, { status: 202 }),
    );
    await provider().send(replyDraft("replyAll"));
    expect(calls.map(path)).toEqual([
      "POST /me/messages/AAMk-1%3D/createReplyAll",
      "PATCH /me/messages/draft%2F1",
      "POST /me/messages/draft%2F1/send",
    ]);
    const patch = JSON.parse(calls[1].body ?? "");
    expect(patch.body).toEqual({ contentType: "Text", content: "Sure.\n\n> Hi" });
    expect(patch.toRecipients[0].emailAddress.address).toBe("priya@university.edu");
  });

  it("forwards through a forward draft", async () => {
    const calls = stubFetch((call) =>
      call.url.endsWith("/createForward") ? json({ id: "d2" }, 201) : new Response(null, { status: 202 }),
    );
    await provider().send(replyDraft("forward"));
    expect(path(calls[0])).toBe("POST /me/messages/AAMk-1%3D/createForward");
  });

  it("sends a reply as a new message when the original is gone", async () => {
    const calls = stubFetch((call) =>
      call.url.endsWith("/createReply")
        ? json({ error: { code: "ErrorItemNotFound", message: "Gone." } }, 404)
        : new Response(null, { status: 202 }),
    );
    await provider().send(replyDraft("reply"));
    expect(calls.map(path)).toEqual(["POST /me/messages/AAMk-1%3D/createReply", "POST /me/sendMail"]);
  });

  it("removes the reply draft when sending it fails", async () => {
    const calls = stubFetch((call) => {
      if (call.url.endsWith("/createReply")) return json({ id: "d3" }, 201);
      if (call.url.endsWith("/send")) return json({ error: { code: "ErrorSendAsDenied", message: "No." } }, 400);
      return new Response(null, { status: 204 });
    });
    await expect(provider().send(replyDraft("reply"))).rejects.toThrow("ErrorSendAsDenied: No.");
    expect(path(calls[calls.length - 1])).toBe("DELETE /me/messages/d3");
  });

  it("keeps the last list for startup and patches it after actions and replies", async () => {
    const saved = new Map<string, { uidValidity: string; messages: MessageSummary[] }>();
    const store = {
      load: (folder: string) => saved.get(folder),
      save: (folder: string, value: { uidValidity: string; messages: MessageSummary[] }) => {
        saved.set(folder, value);
      },
    };
    stubFetch((call) => {
      if (call.method === "GET") return json({ value: [graphMessage, { ...graphMessage, id: "B", conversationId: "c2" }] });
      if (call.url.endsWith("/createReply")) return json({ id: "d4" }, 201);
      return new Response(null, { status: 202 });
    });
    const first = new GraphProvider(outlookAccount, async () => "tok", store);
    expect(first.cached("inbox")).toEqual([]);
    await first.list("inbox", 50);
    expect(first.cached("inbox")).toHaveLength(2);

    await first.send(replyDraft("reply"));
    expect(first.cached("inbox").find((m) => m.id === "acc|inbox|AAMk-1=")?.answered).toBe(true);

    await first.act("archive", "inbox", ["B"]);
    // A later launch starts from the saved copy, without the archived message.
    const second = new GraphProvider(outlookAccount, async () => "tok", store);
    expect(second.cached("inbox").map((m) => m.id)).toEqual(["acc|inbox|AAMk-1="]);
  });

  it("waits and retries when Graph throttles, honouring Retry-After", async () => {
    const waits: number[] = [];
    let attempts = 0;
    stubFetch(() => {
      attempts += 1;
      return attempts < 3
        ? new Response(JSON.stringify({ error: { code: "TooManyRequests" } }), {
            status: 429,
            headers: { "retry-after": attempts === 1 ? "2" : "600" },
          })
        : json({ value: [] });
    });
    const throttled = new GraphProvider(outlookAccount, async () => "tok", undefined, async (ms) => {
      waits.push(ms);
    });
    await expect(throttled.list("inbox", 10)).resolves.toEqual([]);
    expect(waits).toEqual([2000, 8000]);
  });

  it("never has more than a few writes in flight, however many messages are acted on", async () => {
    let inFlight = 0;
    let peak = 0;
    vi.stubGlobal("fetch", async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return new Response(null, { status: 200 });
    });
    const ids = Array.from({ length: 50 }, (_, i) => `m${i}`);
    await provider().act("markRead", "inbox", ids);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("does not repeat a write after a server error", async () => {
    const calls = stubFetch(() => json({ error: { code: "ServiceUnavailable" } }, 503));
    const p = new GraphProvider(outlookAccount, async () => "tok", undefined, async () => undefined);
    await expect(p.act("markRead", "inbox", ["x"])).rejects.toThrow("ServiceUnavailable");
    expect(calls).toHaveLength(1);
  });

  it("explains access-denied errors for university tenants", async () => {
    stubFetch(() =>
      json({ error: { code: "ErrorAccessDenied", message: "Access is denied." } }, 403),
    );
    await expect(provider().verify()).rejects.toThrow(/ask IT/);
  });

  it("surfaces the Graph error code and message otherwise", async () => {
    stubFetch(() => json({ error: { code: "InvalidAuthenticationToken", message: "Expired." } }, 401));
    await expect(provider().list("inbox", 10)).rejects.toThrow("InvalidAuthenticationToken: Expired.");
  });
});

describe("OAuth helpers", () => {
  it("picks the Microsoft login authority from the account type", () => {
    expect(microsoftAuthority({ outlookKind: "personal" })).toBe("consumers");
    expect(microsoftAuthority({ outlookKind: "work-school" })).toBe("organizations");
    expect(microsoftAuthority({ outlookKind: "work-school", tenant: " university.edu " })).toBe(
      "university.edu",
    );
  });

  it("reports which sign-in methods are configured", () => {
    expect(oauthCapabilities({})).toEqual({ googleOAuth: false, microsoftOAuth: false });
    expect(
      oauthCapabilities({ googleClientId: "a", googleClientSecret: "b", microsoftClientId: "c" }),
    ).toEqual({ googleOAuth: true, microsoftOAuth: true });
    // Google needs both halves of the credential pair.
    expect(oauthCapabilities({ googleClientId: "a" }).googleOAuth).toBe(false);
  });

  it("refuses to start sign-in without a client id", async () => {
    await expect(signInWithGoogle({}, async () => undefined)).rejects.toBeInstanceOf(
      OAuthNotConfiguredError,
    );
    await expect(
      signInWithMicrosoft({}, async () => undefined, { outlookKind: "personal" }),
    ).rejects.toBeInstanceOf(OAuthNotConfiguredError);
  });
});

describe("OAuth sign-in flows (real loopback server, stubbed providers)", () => {
  /** Routes loopback redirects to the real network and everything else to `remote`. */
  function routeFetch(remote: (call: RecordedCall) => Response): RecordedCall[] {
    const remoteCalls: RecordedCall[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (/^http:\/\/(127\.0\.0\.1|localhost):\d+/.test(url)) return realFetch(input, init);
        const call: RecordedCall = {
          url,
          method: init?.method ?? "GET",
          headers: (init?.headers ?? {}) as Record<string, string>,
          body: init?.body === undefined ? undefined : String(init.body),
        };
        remoteCalls.push(call);
        return remote(call);
      }),
    );
    return remoteCalls;
  }

  /** Plays the browser: reads the auth URL, then hits the redirect URI with a code. */
  function browserApproves(options: { state?: "echo" | string } = {}) {
    const seen: { authUrl?: URL } = {};
    const openExternal = async (url: string) => {
      const authUrl = new URL(url);
      seen.authUrl = authUrl;
      const redirect = authUrl.searchParams.get("redirect_uri") ?? "";
      const state = options.state === undefined || options.state === "echo"
        ? (authUrl.searchParams.get("state") ?? "")
        : options.state;
      // Fire and forget: the flow resolves once the loopback server sees this request.
      void realFetch(`${redirect}/?code=auth-code&state=${encodeURIComponent(state)}`);
    };
    return { seen, openExternal };
  }

  beforeEach(() => {
    vi.useRealTimers();
  });

  it("completes Google sign-in with PKCE and returns the account identity", async () => {
    const remote = routeFetch((call) => {
      if (call.url.includes("oauth2.googleapis.com/token")) {
        return json({ access_token: "g-access", refresh_token: "g-refresh", expires_in: 3600 });
      }
      return json({ email: "me@gmail.com", name: "Me Gmail" });
    });
    const browser = browserApproves();

    const identity = await signInWithGoogle(
      { googleClientId: "gid", googleClientSecret: "gsecret" },
      browser.openExternal,
      "me@gmail.com",
    );

    const auth = browser.seen.authUrl as URL;
    expect(auth.origin + auth.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(auth.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.searchParams.get("scope")).toContain("https://mail.google.com/");
    expect(auth.searchParams.get("access_type")).toBe("offline");
    expect(auth.searchParams.get("login_hint")).toBe("me@gmail.com");

    // The verifier sent to the token endpoint must hash to the challenge sent to the browser.
    const tokenCall = remote.find((c) => c.url.includes("oauth2.googleapis.com/token"));
    const form = new URLSearchParams(tokenCall?.body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("auth-code");
    expect(form.get("client_secret")).toBe("gsecret");
    expect(createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url")).toBe(
      auth.searchParams.get("code_challenge"),
    );

    expect(identity).toMatchObject({ email: "me@gmail.com", name: "Me Gmail" });
    expect(identity.tokens).toMatchObject({ accessToken: "g-access", refreshToken: "g-refresh" });
    expect(identity.tokens.expiresAt).toBeGreaterThan(Date.now());
  });

  it("rejects a redirect whose state does not match", async () => {
    routeFetch(() => json({}));
    const browser = browserApproves({ state: "forged" });
    await expect(
      signInWithGoogle({ googleClientId: "gid", googleClientSecret: "s" }, browser.openExternal),
    ).rejects.toThrow(/did not match/);
  });

  it("signs a personal Outlook account in against the consumers authority", async () => {
    routeFetch((call) =>
      call.url.includes("/token")
        ? json({ access_token: "m-access", refresh_token: "m-refresh", expires_in: 3600 })
        : json({ mail: "me@outlook.com", displayName: "Me Outlook" }),
    );
    const browser = browserApproves();

    const identity = await signInWithMicrosoft(
      { microsoftClientId: "mid" },
      browser.openExternal,
      { outlookKind: "personal" },
    );

    const auth = browser.seen.authUrl as URL;
    expect(auth.pathname).toBe("/consumers/oauth2/v2.0/authorize");
    expect(auth.searchParams.get("redirect_uri")).toMatch(/^http:\/\/localhost:\d+$/);
    expect(auth.searchParams.get("scope")).toContain("Mail.ReadWrite");
    expect(auth.searchParams.get("scope")).toContain("offline_access");
    expect(identity.email).toBe("me@outlook.com");
  });

  it("signs a university account in against its own tenant and falls back to the UPN", async () => {
    routeFetch((call) => {
      if (call.url.includes("/token")) {
        expect(call.url).toContain("/university.edu/oauth2/v2.0/token");
        return json({ access_token: "m-access", refresh_token: "m-refresh", expires_in: 3600 });
      }
      // Work/school mailboxes often have a null `mail`; the UPN is the address then.
      return json({ mail: null, userPrincipalName: "me@university.edu", displayName: "Me Student" });
    });
    const browser = browserApproves();

    const identity = await signInWithMicrosoft(
      { microsoftClientId: "mid" },
      browser.openExternal,
      { outlookKind: "work-school", tenant: "university.edu" },
      "me@university.edu",
    );

    const auth = browser.seen.authUrl as URL;
    expect(auth.pathname).toBe("/university.edu/oauth2/v2.0/authorize");
    expect(auth.searchParams.get("login_hint")).toBe("me@university.edu");
    expect(identity).toMatchObject({ email: "me@university.edu", name: "Me Student" });
  });

  it("surfaces the provider's reason when the tenant blocks consent", async () => {
    routeFetch(() => json({}));
    const openExternal = async (url: string) => {
      const redirect = new URL(url).searchParams.get("redirect_uri") ?? "";
      void realFetch(
        `${redirect}/?error=access_denied&error_description=${encodeURIComponent("AADSTS90094: admin consent required")}`,
      );
    };
    await expect(
      signInWithMicrosoft({ microsoftClientId: "mid" }, openExternal, { outlookKind: "work-school" }),
    ).rejects.toThrow("AADSTS90094: admin consent required");
  });

  it("refreshes tokens, keeping the old refresh token when none is rotated", async () => {
    const calls = stubFetch(() => json({ access_token: "new-access", expires_in: 60 }));

    const tokens = await refreshAccessToken(
      { microsoftClientId: "mid" },
      { provider: "outlook", outlookKind: "work-school", tenant: "university.edu" },
      "old-refresh",
    );

    expect(calls[0].url).toBe("https://login.microsoftonline.com/university.edu/oauth2/v2.0/token");
    const form = new URLSearchParams(calls[0].body);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("old-refresh");
    expect(tokens).toMatchObject({ accessToken: "new-access", refreshToken: "old-refresh" });
  });

  it("reports a failed token exchange with the provider's description", async () => {
    stubFetch(() => json({ error: "invalid_grant", error_description: "Token has been revoked." }, 400));
    await expect(
      refreshAccessToken(
        { googleClientId: "a", googleClientSecret: "b" },
        { provider: "gmail" },
        "revoked",
      ),
    ).rejects.toThrow("Token has been revoked.");
  });
});

describe("IMAP endpoints", () => {
  const base: Account = {
    id: "x",
    provider: "zoho",
    email: "a@b.com",
    displayName: "A",
    auth: "password",
    hue: 0,
  };

  it("uses Gmail's fixed hosts", () => {
    expect(endpointsFor({ ...base, provider: "gmail" })).toEqual({
      imapHost: "imap.gmail.com",
      smtpHost: "smtp.gmail.com",
    });
  });

  it("uses the pro hosts for Zoho custom domains and honors the region", () => {
    expect(endpointsFor({ ...base, zohoWorkplace: true, zohoRegion: "eu" })).toEqual({
      imapHost: "imappro.zoho.eu",
      smtpHost: "smtppro.zoho.eu",
    });
    expect(endpointsFor({ ...base, zohoWorkplace: false })).toEqual({
      imapHost: "imap.zoho.com",
      smtpHost: "smtp.zoho.com",
    });
    expect(endpointsFor({ ...base, zohoWorkplace: true, zohoRegion: "com.au" }).imapHost).toBe(
      "imappro.zoho.com.au",
    );
  });

  it("refuses providers that are not IMAP", () => {
    expect(() => endpointsFor({ ...base, provider: "outlook" })).toThrow();
  });
});

describe("IPC schemas", () => {
  it("accepts each sign-in shape and rejects malformed ones", () => {
    expect(
      addAccountSchema.safeParse({ kind: "oauth", provider: "outlook", outlookKind: "work-school", tenant: "uni.edu" })
        .success,
    ).toBe(true);
    expect(addAccountSchema.safeParse({ kind: "oauth", provider: "gmail" }).success).toBe(true);
    expect(
      addAccountSchema.safeParse({
        kind: "password",
        provider: "zoho",
        email: "a@b.com",
        password: "x",
        zohoRegion: "eu",
        zohoWorkplace: true,
      }).success,
    ).toBe(true);

    expect(addAccountSchema.safeParse({ kind: "password", provider: "zoho", email: "nope", password: "x" }).success).toBe(false);
    expect(addAccountSchema.safeParse({ kind: "password", provider: "zoho", email: "a@b.com", password: "" }).success).toBe(false);
    // Outlook has no password mode: Microsoft removed basic auth.
    expect(addAccountSchema.safeParse({ kind: "password", provider: "outlook", email: "a@b.com", password: "x" }).success).toBe(false);
    expect(addAccountSchema.safeParse({ kind: "oauth", provider: "outlook" }).success).toBe(false);
  });

  it("bounds list queries, actions and id batches", () => {
    expect(listQuerySchema.safeParse({ folder: "inbox", limit: 100 }).success).toBe(true);
    expect(listQuerySchema.safeParse({ folder: "inbox", limit: 100000 }).success).toBe(false);
    expect(listQuerySchema.safeParse({ folder: "everything" }).success).toBe(false);
    expect(actionSchema.safeParse("rm -rf").success).toBe(false);
    expect(idsSchema.safeParse([]).success).toBe(false);
    expect(idsSchema.safeParse(Array.from({ length: 501 }, (_, i) => String(i))).success).toBe(false);
  });

  it("requires a recipient and valid addresses on drafts", () => {
    const draft = { accountId: "a", to: [], cc: [], bcc: [], subject: "s", text: "t" };
    expect(draftSchema.safeParse(draft).success).toBe(false);
    expect(draftSchema.safeParse({ ...draft, to: [{ name: "", email: "not-an-email" }] }).success).toBe(false);
    expect(draftSchema.safeParse({ ...draft, to: [{ name: "", email: "ok@x.com" }] }).success).toBe(true);
  });
});
