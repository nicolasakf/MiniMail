import { describe, expect, it } from "vitest";

import { discoverImapSettings, parseAutoconfig } from "./account-discovery";

const config = (socket = "SSL", authentication = "password-cleartext") => `
<clientConfig version="1.1">
  <emailProvider id="example.com">
    <incomingServer type="imap">
      <hostname>imap.example.com</hostname><port>993</port><socketType>${socket}</socketType>
      <username>%EMAILLOCALPART%</username><authentication>OAuth2</authentication>
      <authentication>${authentication}</authentication>
    </incomingServer>
    <outgoingServer type="smtp">
      <hostname>smtp.example.com</hostname><port>587</port><socketType>STARTTLS</socketType>
      <username>%EMAILADDRESS%</username><authentication>password-cleartext</authentication>
    </outgoingServer>
  </emailProvider>
</clientConfig>`;

describe("IMAP account discovery", () => {
  it("fills separate usernames and preserves the outgoing STARTTLS settings", () => {
    expect(parseAutoconfig(config(), "user@example.com")).toEqual({
      incoming: { host: "imap.example.com", port: 993, security: "tls", username: "user" },
      outgoing: { host: "smtp.example.com", port: 587, security: "starttls", username: "user@example.com" },
      serverSavesSent: false,
    });
  });

  it("leaves OAuth-only, plaintext and malformed configurations for manual setup", () => {
    expect(parseAutoconfig(config("plain"), "user@example.com")).toBeNull();
    expect(parseAutoconfig(config("SSL", "OAuth2"), "user@example.com")).toBeNull();
    expect(parseAutoconfig("<clientConfig>", "user@example.com")).toBeNull();
  });

  it("uses the regional Zoho endpoints for a known personal address", async () => {
    expect(await discoverImapSettings("user@zoho.eu")).toMatchObject({
      incoming: { host: "imap.zoho.eu" },
      outgoing: { host: "smtp.zoho.eu" },
      serverSavesSent: true,
    });
  });
});
