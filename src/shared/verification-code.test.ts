import { describe, expect, it } from "vitest";

import {
  confirmedCode,
  extractVerificationCode,
  htmlToText,
  isFreshForCode,
  maskLinks,
  textForModel,
} from "./verification-code";

const extract = (subject: string, text: string) => extractVerificationCode({ subject, text });

describe("extractVerificationCode", () => {
  it.each([
    ["Your Acme code", "Your verification code is 482913. It expires in 10 minutes.", "482913"],
    ["Sign in to Acme", "Use code 551203 to sign in.", "551203"],
    ["482913 is your Acme verification code", "Hello,\nWelcome back.", "482913"],
    ["Your Google verification code", "G-736201 is your Google verification code.", "736201"],
    ["Your code", "Your one-time code: 123-456", "123456"],
    ["Seu código de verificação", "Seu código é 903412. Não compartilhe.", "903412"],
    ["Confirm your email", "Enter this confirmation code:\n\n  77Q4ZK  \n\nThanks", "77Q4ZK"],
    ["Verify your login", "Here is your security code\n620417\nIt is valid for 15 minutes.", "620417"],
  ])("reads %s", (subject, text, expected) => {
    expect(extract(subject, text)).toBe(expected);
  });

  it("counts a code shown in both the subject and the body once", () => {
    expect(extract("Your code is 482913", "Enter the code 482913 to continue.")).toBe("482913");
  });

  it("ignores numbers inside links", () => {
    expect(
      extract("Verify your email", "Verification code 482913 or open https://acme.example/v/918273645?code=111222"),
    ).toBe("482913");
  });

  it.each([
    ["Your order has shipped", "Order #48291 ships on 12/03. Total $1234 for 3 items."],
    ["Your receipt", "Invoice 20481 for 2026. Call us at 555-123-4567."],
    ["Hello", "Lunch at 12:30? I will be there by 1530."],
    ["Verification", "Please verify your email by clicking the button below."],
  ])("finds nothing in %s", (subject, text) => {
    expect(extract(subject, text)).toBeNull();
  });

  it("does not take a time limit or a price for the code", () => {
    expect(extract("Your code", "Your code is 482913. It expires in 5000 minutes and costs 1999 USD.")).toBe("482913");
  });

  it("gives up when two different numbers look equally like the code", () => {
    expect(extract("Codes", "Your code is 111222. Your backup code is 333444.")).toBeNull();
  });
});

describe("htmlToText", () => {
  it("keeps each table cell on its own line and decodes entities", () => {
    const html =
      "<style>p{color:red}</style><table><tr><td>Your code</td></tr><tr><td><b>482&nbsp;913</b></td></tr></table><p>R&amp;D</p>";
    expect(htmlToText(html)).toBe("Your code\n482 913\nR&D");
  });

  it("lets the extractor read an HTML-only email", () => {
    const html = "<div>Your verification code</div><div style='font-size:32px'>604 812</div>";
    expect(extract("Welcome", htmlToText(html))).toBe("604812");
  });
});

describe("what a model is given", () => {
  it("masks link paths but keeps the host", () => {
    expect(maskLinks("Open https://acme.example/magic/abc123?t=secret now")).toBe("Open [link acme.example] now");
  });

  it("keeps digits, since the code is the point, and cuts long bodies", () => {
    const text = textForModel(`Code 482913 ${"x ".repeat(2000)}`);
    expect(text.startsWith("Code 482913")).toBe(true);
    expect(text.length).toBeLessThanOrEqual(1500);
  });
});

describe("confirmedCode", () => {
  const source = { subject: "Sign in", text: "Your code is 482 913. Do not share it." };

  it("accepts an answer that is in the email, ignoring spaces and hyphens", () => {
    expect(confirmedCode("482913", source)).toBe("482913");
    expect(confirmedCode("482-913", source)).toBe("482913");
  });

  it("drops an answer that is not in the email or does not look like a code", () => {
    expect(confirmedCode("482914", source)).toBeNull();
    expect(confirmedCode("sign in", source)).toBeNull();
    expect(confirmedCode("12", { subject: "", text: "12" })).toBeNull();
    expect(confirmedCode(null, source)).toBeNull();
  });
});

describe("isFreshForCode", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  it("accepts mail from the last hour only", () => {
    expect(isFreshForCode("2026-11-10T11:30:00Z", now)).toBe(true);
    expect(isFreshForCode("2026-11-10T10:30:00Z", now)).toBe(false);
    expect(isFreshForCode("not a date", now)).toBe(false);
  });
});
