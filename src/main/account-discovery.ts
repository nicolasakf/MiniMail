import { Resolver } from "node:dns/promises";
import { SaxesParser } from "saxes";

import { providerForEmailDomain } from "@shared/accounts";
import { imapSettingsSchema, zohoSettings, type ImapSettings } from "@shared/imap-settings";
import type { Provider } from "@shared/types";

import { safeFetch } from "./logos/net-guard";

const resolver = new Resolver({ timeout: 1200, tries: 1 });
const ZOHO_REGION = /^(?:zoho|zohomail)\.(com|eu|in|com\.au|jp|sa|uk)$/i;
const ZOHO_MX = /^mx[23]?\.(?:zoho|zohomail)\.(com|eu|in|com\.au|jp|sa|uk)\.?$/i;

/** Only the domain is sent to DNS. MX is a hint since some mailboxes sit behind a gateway. */
export async function discoverAccountProvider(email: string): Promise<Provider | null> {
  const preset = providerForEmailDomain(email);
  if (preset) return preset;

  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  // expected: a domain without an MX record is the usual answer, not a failure.
  const records = await resolver.resolveMx(domain).catch(() => []);
  const providers = new Set<Provider>();
  for (const { exchange } of records) {
    if (/\.protection\.outlook\.com\.?$/i.test(exchange)) providers.add("outlook");
    if (/^(?:aspmx\.l\.google\.com|alt[1-4]\.aspmx\.l\.google\.com|smtp\.google\.com)\.?$/i.test(exchange)) {
      providers.add("gmail");
    }
  }
  return providers.size === 1 ? [...providers][0] : null;
}

interface ConfigServer {
  type: string;
  fields: Map<string, string[]>;
}

/** Reads Thunderbird's password-capable IMAP and SMTP entries, in preference order. */
export function parseAutoconfig(xml: string, email: string): ImapSettings | null {
  const parser = new SaxesParser();
  const path: string[] = [];
  const servers: ConfigServer[] = [];
  let server: ConfigServer | undefined;
  let value = "";

  parser.on("doctype", () => { throw new Error("Unexpected document type."); });
  parser.on("opentag", ({ name, attributes }) => {
    path.push(name);
    if (path.length === 3 && path[0] === "clientConfig" && path[1] === "emailProvider") {
      if ((name === "incomingServer" && attributes.type === "imap") ||
          (name === "outgoingServer" && attributes.type === "smtp")) {
        server = { type: attributes.type, fields: new Map() };
        servers.push(server);
      }
    }
    if (server && path.length === 4) value = "";
  });
  parser.on("text", (chunk) => { if (server && path.length === 4) value += chunk; });
  parser.on("closetag", ({ name }) => {
    if (server && path.length === 4) {
      server.fields.set(name, [...(server.fields.get(name) ?? []), value.trim()]);
    }
    if (path.length === 3) server = undefined;
    path.pop();
  });
  try {
    parser.write(xml).close();
  } catch {
    // expected: a configuration file that is not valid XML just means no settings were found there.
    return null;
  }

  const at = email.lastIndexOf("@");
  const candidates = (type: "imap" | "smtp") => servers
    .filter((item) => item.type === type)
    .flatMap(({ fields }) => {
      if (!fields.get("authentication")?.includes("password-cleartext")) return [];
      const socket = fields.get("socketType")?.[0];
      if (socket !== "SSL" && socket !== "STARTTLS") return [];
      const template = fields.get("username")?.[0];
      if (!template) return [];
      const username = template
        .replaceAll("%EMAILADDRESS%", () => email)
        .replaceAll("%EMAILLOCALPART%", () => email.slice(0, at))
        .replaceAll("%EMAILDOMAIN%", () => email.slice(at + 1));
      if (/%[A-Z]+%/.test(template.replace(/%EMAIL(?:ADDRESS|LOCALPART|DOMAIN)%/g, ""))) return [];
      return [{
        host: fields.get("hostname")?.[0],
        port: Number(fields.get("port")?.[0]),
        security: socket === "SSL" ? "tls" : "starttls",
        username,
      }];
    });
  const incomingSchema = imapSettingsSchema.shape.incoming;
  const firstValid = (type: "imap" | "smtp") => {
    for (const candidate of candidates(type)) {
      const result = incomingSchema.safeParse(candidate);
      if (result.success) return result.data;
    }
    return undefined;
  };
  const incoming = firstValid("imap");
  const outgoing = firstValid("smtp");
  return incoming && outgoing ? { incoming, outgoing, serverSavesSent: false } : null;
}

export async function discoverImapSettings(email: string): Promise<ImapSettings | null> {
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  const knownZoho = ZOHO_REGION.exec(domain)?.[1];
  if (knownZoho) return zohoSettings(email, knownZoho, false);

  const fromThunderbird = (hostname: string) => `https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(hostname)}`;
  const readConfig = async (url: string) => {
    try {
      const response = await safeFetch(url, { timeoutMs: 2400, maxRedirects: 0 });
      return response.status === 200 ? parseAutoconfig(response.body.toString("utf8"), email) : null;
    } catch {
      // expected: most domains publish no autoconfig file; the answer is simply "none found".
      return null;
    }
  };
  const urls = [
    fromThunderbird(domain),
    `https://autoconfig.${domain}/mail/config-v1.1.xml`,
    `https://${domain}/.well-known/autoconfig/mail/config-v1.1.xml`,
  ];
  const [mx, ...configs] = await Promise.all([
    // expected: a domain without an MX record is the usual answer, not a failure.
    resolver.resolveMx(domain).catch(() => []),
    ...urls.map(readConfig),
  ]);
  const configured = configs.find((config) => config !== null);
  if (configured) return configured;

  const regions = new Set(mx.flatMap(({ exchange }) => {
    const region = ZOHO_MX.exec(exchange)?.[1]?.toLowerCase();
    return region ? [region] : [];
  }));
  const [region] = regions;
  if (regions.size === 1 && region) return zohoSettings(email, region, true);

  // Some hosted domains publish no client settings of their own. The ISP database
  // may recognize their mail host or its immediate parent.
  const primary = mx.sort((a, b) => a.priority - b.priority)[0]?.exchange.toLowerCase().replace(/\.$/, "");
  if (!primary || !primary.includes(".")) return null;
  const candidates = [primary, primary.slice(primary.indexOf(".") + 1)]
    .filter((host) => host !== domain && host.includes("."));
  const viaMx = await Promise.all(candidates.map((host) => readConfig(fromThunderbird(host))));
  return viaMx.find((config) => config !== null) ?? null;
}
