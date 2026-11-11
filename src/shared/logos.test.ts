import { describe, expect, it } from "vitest";

import {
  accountLogoRequest,
  firstHeader,
  isAuthenticated,
  isFreemail,
  isPlausibleDomain,
  isSendingService,
  logoKey,
  logoRequestFor,
} from "./logos";
import type { MessageSummary } from "./types";

const message = (
  email: string,
  signal: MessageSummary["signal"],
  authenticated: boolean | undefined,
): Pick<MessageSummary, "from" | "signal" | "authenticated"> => ({
  from: { name: "", email },
  signal,
  authenticated,
});

describe("isFreemail / isSendingService / isPlausibleDomain", () => {
  it("recognises mailbox providers, including regional variants", () => {
    for (const domain of ["gmail.com", "outlook.com", "hotmail.com", "hotmail.co.uk", "outlook.com.br", "live.fr", "yahoo.co.jp", "icloud.com", "zoho.com"]) {
      expect(isFreemail(domain)).toBe(true);
    }
    for (const domain of ["amazon.com", "university.edu", "acme.co.uk", "outlook-tips.com"]) {
      expect(isFreemail(domain)).toBe(false);
    }
  });

  it("recognises services that send on behalf of other companies", () => {
    expect(isSendingService("sendgrid.net")).toBe(true);
    expect(isSendingService("amazonses.com")).toBe(true);
    expect(isSendingService("amazon.com")).toBe(false);
  });

  it("accepts only plausible public host names", () => {
    expect(isPlausibleDomain("acme.co.uk")).toBe(true);
    for (const bad of ["localhost", "10.0.0.1", "a b.com", "evil.com/x", "-a.com", "a..com", "exa_mple.com", ""]) {
      expect(isPlausibleDomain(bad)).toBe(false);
    }
  });
});

describe("logoRequestFor", () => {
  it("asks for a company logo for authenticated automated and bulk mail", () => {
    expect(logoRequestFor(message("no-reply@amazon.com", "notification", true))).toEqual({ kind: "brand", domain: "amazon.com" });
    expect(logoRequestFor(message("crew@news.morningbrew.com", "newsletter", true))).toEqual({ kind: "brand", domain: "morningbrew.com" });
  });

  it("never shows anything for mail that did not pass authentication", () => {
    expect(logoRequestFor(message("no-reply@paypal.com", "notification", false))).toBeNull();
    expect(logoRequestFor(message("no-reply@paypal.com", "notification", undefined))).toBeNull();
    expect(logoRequestFor(message("ann@gmail.com", "person", false))).toBeNull();
  });

  it("looks for a person's photo on mailbox providers and for people at companies", () => {
    expect(logoRequestFor(message("Ann@Gmail.com", "person", true))).toEqual({ kind: "person", email: "ann@gmail.com" });
    expect(logoRequestFor(message("ann@acme.com", "person", true))).toEqual({ kind: "person", email: "ann@acme.com" });
    // A "newsletter" from a Gmail address is still a person, not Google.
    expect(logoRequestFor(message("someone@gmail.com", "newsletter", true))).toEqual({ kind: "person", email: "someone@gmail.com" });
  });

  it("gives sending services initials instead of their own logo", () => {
    expect(logoRequestFor(message("bounce@sendgrid.net", "newsletter", true))).toBeNull();
  });

  it("rejects malformed senders", () => {
    expect(logoRequestFor(message("nobody", "notification", true))).toBeNull();
    expect(logoRequestFor(message("x@localhost", "notification", true))).toBeNull();
  });
});

describe("accountLogoRequest and logoKey", () => {
  it("looks up the site behind an account only when it is not on a mailbox provider", () => {
    expect(accountLogoRequest({ email: "me@orion-agent.ai" })).toEqual({ kind: "own", domain: "orion-agent.ai" });
    expect(accountLogoRequest({ email: "me@student.uni.edu.br" })?.kind).toBe("own");
    expect(accountLogoRequest({ email: "me@gmail.com" })).toBeNull();
    expect(accountLogoRequest({ email: "me@hotmail.com" })).toBeNull();
  });

  it("keeps a brand and one of the user's own accounts on the same site apart", () => {
    expect(logoKey({ kind: "brand", domain: "Acme.com" })).toBe("brand:acme.com");
    expect(logoKey({ kind: "own", domain: "acme.com" })).toBe("own:acme.com");
    expect(logoKey({ kind: "person", email: " Ann@X.com " })).toBe("person:ann@x.com");
  });
});

describe("isAuthenticated", () => {
  it("trusts a DMARC pass", () => {
    expect(isAuthenticated("mx.google.com; dkim=pass header.i=@x.com; spf=pass; dmarc=pass (p=NONE) header.from=x.com", "a@x.com")).toBe(true);
  });

  it("trusts a DKIM pass for the sender's own domain when DMARC is absent", () => {
    expect(isAuthenticated("mx; dkim=pass header.d=mail.acme.com; spf=none", "a@acme.com")).toBe(true);
  });

  it("does not trust a DKIM pass for some other domain", () => {
    expect(isAuthenticated("mx; dkim=pass header.d=evil.example; spf=pass", "ceo@paypal.com")).toBe(false);
  });

  it("does not trust failures, missing results or look-alike text", () => {
    expect(isAuthenticated("mx; dmarc=fail header.from=x.com", "a@x.com")).toBe(false);
    expect(isAuthenticated("mx; dmarc=none", "a@x.com")).toBe(false);
    expect(isAuthenticated(undefined, "a@x.com")).toBe(false);
    expect(isAuthenticated("mx; x-dmarc=passed", "a@x.com")).toBe(false);
  });
});

describe("firstHeader", () => {
  const raw = [
    "Received: from a",
    "Authentication-Results: mx.receiver.example;",
    "\tdmarc=fail header.from=x.com",
    "Authentication-Results: planted; dmarc=pass",
    "Subject: hi",
    "",
    "Authentication-Results: in the body; dmarc=pass",
  ].join("\r\n");

  it("returns the topmost occurrence, unfolded, and ignores the body", () => {
    expect(firstHeader(raw, "authentication-results")).toBe("mx.receiver.example; dmarc=fail header.from=x.com");
  });

  it("is case-insensitive about the name and returns undefined when absent", () => {
    expect(firstHeader(raw, "SUBJECT")).toBe("hi");
    expect(firstHeader("Subject: x\r\n\r\nbody", "authentication-results")).toBeUndefined();
  });

  it("makes a planted header below the real one harmless", () => {
    expect(isAuthenticated(firstHeader(raw, "authentication-results"), "a@x.com")).toBe(false);
  });
});
