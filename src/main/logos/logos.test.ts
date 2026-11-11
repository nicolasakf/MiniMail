import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { brandFallbackFor, type LogoSettings } from "@shared/logos";

import type { Cipher } from "../category-store";
import {
  findGravatar,
  findSiteIcon,
  parseBimi,
  personHash,
  pickIconLinks,
  sniffImage,
  type FinderDeps,
} from "./icon-finder";
import { LogoCache } from "./logo-cache";
import { LogoService } from "./logo-service";
import { BlockedDestinationError, isPublicAddress, safeFetch, type FetchedResource } from "./net-guard";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fake-png-body")]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');

describe("isPublicAddress", () => {
  it("rejects loopback, private, link-local, metadata and special ranges", () => {
    for (const address of [
      "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
      "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fc00::1",
      "fd12:3456::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::7f00:1", "2002:7f00:1::",
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it("accepts public addresses", () => {
    for (const address of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "93.184.216.34", "2606:4700:4700::1111"]) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });

  it("rejects anything that is not an address", () => {
    for (const bad of ["localhost", "", "example.com", "999.1.1.1"]) expect(isPublicAddress(bad)).toBe(false);
  });
});

describe("safeFetch", () => {
  let server: Server;
  let port: number;
  const hits: string[] = [];

  beforeEach(async () => {
    hits.length = 0;
    server = createServer((req, res) => {
      hits.push(req.url ?? "");
      if (req.url === "/redirect") {
        res.writeHead(302, { Location: "/final" }).end();
      } else if (req.url === "/loop") {
        res.writeHead(302, { Location: "/loop" }).end();
      } else if (req.url === "/big") {
        res.writeHead(200, { "Content-Type": "image/png" }).end(Buffer.alloc(100_000));
      } else if (req.url === "/page") {
        res.writeHead(200, { "Content-Type": "text/html" }).end(`<head><link rel="icon" href="/i.png"></head>${"x".repeat(300_000)}`);
      } else if (req.url === "/slow") {
        // Never answers.
      } else {
        res.writeHead(200, { "Content-Type": "image/png" }).end(PNG);
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });
  afterEach(() => {
    server.closeAllConnections();
    server.close();
  });

  // The server is on loopback, which the guard rightly refuses, so tests opt in explicitly.
  const local = { allowHttp: true, isAllowedAddress: () => true, lookup: (_: string, cb: (e: null, a: { address: string; family: 4 }[]) => void) => cb(null, [{ address: "127.0.0.1", family: 4 }]) };

  it("fetches a body, follows redirects and reports the content type", async () => {
    const result = await safeFetch(`http://icons.test:${port}/redirect`, local);
    expect(result.status).toBe(200);
    expect(result.contentType).toBe("image/png");
    expect(result.body.equals(PNG)).toBe(true);
    expect(hits).toEqual(["/redirect", "/final"]);
  });

  it("stops at the size cap, on redirect loops and on silence", async () => {
    await expect(safeFetch(`http://icons.test:${port}/big`, { ...local, maxBytes: 1000 })).rejects.toThrow(/large/i);
    await expect(safeFetch(`http://icons.test:${port}/loop`, local)).rejects.toThrow(/redirects/i);
    await expect(safeFetch(`http://icons.test:${port}/slow`, { ...local, timeoutMs: 150 })).rejects.toThrow(/timed out/i);
  });

  it("can keep just the start of a page that is far larger than it needs", async () => {
    const page = await safeFetch(`http://icons.test:${port}/page`, { ...local, maxBytes: 4096, truncate: true });
    expect(page.status).toBe(200);
    expect(page.body.length).toBe(4096);
    expect(page.body.toString("utf8")).toContain('<link rel="icon" href="/i.png">');
    // The server was stopped early, not read to the end.
    await expect(safeFetch(`http://icons.test:${port}/page`, { ...local, maxBytes: 4096 })).rejects.toThrow(/large/i);
  });

  it("refuses to connect to a host that resolves to a private address", async () => {
    const privateLookup = { allowHttp: true, lookup: local.lookup };
    await expect(safeFetch(`http://icons.test:${port}/x`, privateLookup)).rejects.toBeInstanceOf(BlockedDestinationError);
    expect(hits).toEqual([]);
  });

  it("refuses a public name when even one of its addresses is private (DNS tricks)", async () => {
    const mixed = {
      allowHttp: true,
      lookup: (_: string, cb: (e: null, a: { address: string; family: 4 }[]) => void) =>
        cb(null, [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]),
    };
    await expect(safeFetch(`http://icons.test:${port}/x`, mixed)).rejects.toBeInstanceOf(BlockedDestinationError);
  });

  it("refuses plain http, other ports, embedded credentials and literal private addresses", async () => {
    await expect(safeFetch("http://example.com/")).rejects.toBeInstanceOf(BlockedDestinationError);
    await expect(safeFetch("https://example.com:8443/")).rejects.toBeInstanceOf(BlockedDestinationError);
    await expect(safeFetch("https://user:pw@example.com/")).rejects.toBeInstanceOf(BlockedDestinationError);
    await expect(safeFetch("https://127.0.0.1/")).rejects.toBeInstanceOf(BlockedDestinationError);
    await expect(safeFetch("https://[::1]/")).rejects.toBeInstanceOf(BlockedDestinationError);
    await expect(safeFetch("https://[::ffff:127.0.0.1]/")).rejects.toBeInstanceOf(BlockedDestinationError);
    await expect(safeFetch("https://2130706433/")).rejects.toBeInstanceOf(BlockedDestinationError);
    await expect(safeFetch("https://localhost/")).rejects.toThrow();
  });

  it("does not follow a redirect to a host that resolves to a private address", async () => {
    const redirecting = createServer((_, res) =>
      res.writeHead(302, { Location: `http://second.test:${port}/secret` }).end(),
    );
    await new Promise<void>((resolve) => redirecting.listen(0, "127.0.0.1", resolve));
    const redirectPort = (redirecting.address() as { port: number }).port;
    // first.test is acceptable (it is our own server); second.test resolves somewhere that is not.
    const guarded = {
      allowHttp: true,
      isAllowedAddress: (address: string) => address === "127.0.0.1",
      lookup: (host: string, cb: (e: null, a: { address: string; family: 4 }[]) => void) =>
        cb(null, [{ address: host === "first.test" ? "127.0.0.1" : "127.0.0.2", family: 4 }]),
    };
    await expect(safeFetch(`http://first.test:${redirectPort}/`, guarded)).rejects.toBeInstanceOf(BlockedDestinationError);
    expect(hits).not.toContain("/secret");
    redirecting.close();
  });
});

describe("sniffImage", () => {
  it("identifies images by content, not by what the server says", () => {
    expect(sniffImage(PNG)?.mime).toBe("image/png");
    expect(sniffImage(SVG)?.mime).toBe("image/svg+xml");
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0]))?.mime).toBe("image/jpeg");
    expect(sniffImage(Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0]))?.mime).toBe("image/x-icon");
  });

  it("refuses HTML, scripts and text pretending to be an icon", () => {
    expect(sniffImage(Buffer.from("<html><body>Not found</body></html>"))).toBeNull();
    expect(sniffImage(Buffer.from("<script>alert(1)</script>"))).toBeNull();
    expect(sniffImage(Buffer.from("tiny"))).toBeNull();
  });
});

describe("parseBimi", () => {
  it("reads the logo address from a BIMI record, https only", () => {
    expect(parseBimi(["v=BIMI1; l=https://cdn.acme.com/logo.svg; a=https://cdn.acme.com/vmc.pem"])).toBe("https://cdn.acme.com/logo.svg");
    expect(parseBimi(["v=BIMI1;l=http://insecure.example/logo.svg"])).toBeUndefined();
    expect(parseBimi(["v=spf1 -all"])).toBeUndefined();
    expect(parseBimi([])).toBeUndefined();
  });
});

describe("pickIconLinks", () => {
  const html = `
    <html><head>
      <link rel="stylesheet" href="/a.css">
      <link rel="icon" href="/favicon-16.png" sizes="16x16">
      <link rel="shortcut icon" href="/favicon.ico">
      <link rel="apple-touch-icon" sizes="180x180" href="/apple.png">
      <link rel='icon' type='image/svg+xml' href='https://cdn.example.com/logo.svg'>
      <link rel="icon" href="http://insecure.example/x.png">
      <link rel="icon" href="data:image/png;base64,AAAA">
    </head></html>`;

  it("prefers touch icons and vector logos, ignores insecure or inline ones and resolves relative paths", () => {
    const links = pickIconLinks(html, "https://acme.com/");
    const urls = links.map((link) => link.url);
    expect(urls[0]).toBe("https://acme.com/apple.png");
    expect(urls).toContain("https://cdn.example.com/logo.svg");
    expect(urls).not.toContain("http://insecure.example/x.png");
    expect(urls.some((url) => url.startsWith("data:"))).toBe(false);
    expect(urls.indexOf("https://acme.com/favicon-16.png")).toBeGreaterThan(urls.indexOf("https://acme.com/apple.png"));
  });

  it("returns nothing for a page without icons", () => {
    expect(pickIconLinks("<html><head></head></html>", "https://acme.com/")).toEqual([]);
  });
});

/** A fake internet: url -> response. */
function fakeWeb(routes: Record<string, { status?: number; type?: string; body: Buffer | string } | "fail">) {
  const calls: string[] = [];
  const fetch = async (url: string): Promise<FetchedResource> => {
    calls.push(url);
    const route = routes[url];
    if (route === "fail") throw new Error("connect ECONNREFUSED");
    if (!route) return { status: 404, contentType: "text/html", body: Buffer.from("nope"), url };
    return {
      status: route.status ?? 200,
      contentType: route.type ?? "image/png",
      body: Buffer.isBuffer(route.body) ? route.body : Buffer.from(route.body),
      url,
    };
  };
  return { calls, fetch };
}
const noDns = async (): Promise<string[][]> => {
  throw new Error("ENODATA");
};

describe("findSiteIcon", () => {
  it("prefers the BIMI logo", async () => {
    const web = fakeWeb({ "https://cdn.acme.com/logo.svg": { body: SVG, type: "image/svg+xml" } });
    const deps: FinderDeps = { fetch: web.fetch, resolveTxt: async () => [["v=BIMI1; l=https://cdn.acme.com/logo.svg"]] };
    const result = await findSiteIcon("acme.com", deps);
    expect(result.icon?.mime).toBe("image/svg+xml");
    expect(web.calls).toEqual(["https://cdn.acme.com/logo.svg"]);
  });

  it("falls back to the icon the homepage declares", async () => {
    const web = fakeWeb({
      "https://acme.com/": { body: '<link rel="apple-touch-icon" href="/touch.png">', type: "text/html" },
      "https://acme.com/touch.png": { body: PNG },
    });
    const result = await findSiteIcon("acme.com", { fetch: web.fetch, resolveTxt: noDns });
    expect(result).toMatchObject({ icon: { mime: "image/png" }, definitive: true });
  });

  it("tries www and then /favicon.ico", async () => {
    const web = fakeWeb({
      "https://acme.com/": "fail",
      "https://www.acme.com/": { body: "<html></html>", type: "text/html" },
      "https://www.acme.com/favicon.ico": { body: Buffer.from([0, 0, 1, 0, 1, 0, 16, 16, 0, 0]) },
    });
    const result = await findSiteIcon("acme.com", { fetch: web.fetch, resolveTxt: noDns });
    expect(result.icon?.mime).toBe("image/x-icon");
  });

  it("skips a declared icon that is really an HTML error page", async () => {
    const web = fakeWeb({
      "https://acme.com/": { body: '<link rel="icon" href="/missing.png">', type: "text/html" },
      "https://acme.com/missing.png": { body: "<html>soft 404</html>", type: "image/png" },
      "https://acme.com/favicon.ico": { body: PNG },
    });
    const result = await findSiteIcon("acme.com", { fetch: web.fetch, resolveTxt: noDns });
    expect(result.icon?.mime).toBe("image/png");
    expect(web.calls).toContain("https://acme.com/favicon.ico");
  });

  it("reports a definitive 'none' when the site answered but has no icon", async () => {
    const web = fakeWeb({ "https://acme.com/": { body: "<html></html>", type: "text/html" } });
    expect(await findSiteIcon("acme.com", { fetch: web.fetch, resolveTxt: noDns })).toEqual({ icon: null, definitive: true });
  });

  it("reports a non-definitive none when nothing could be reached", async () => {
    const web = fakeWeb({ "https://acme.com/": "fail", "https://www.acme.com/": "fail", "https://acme.com/favicon.ico": "fail" });
    expect(await findSiteIcon("acme.com", { fetch: web.fetch, resolveTxt: noDns })).toEqual({ icon: null, definitive: false });
  });
});

describe("findGravatar", () => {
  it("asks for the hash of the address, never the address", async () => {
    const web = fakeWeb({});
    await findGravatar("Ann@Example.com", { fetch: web.fetch });
    expect(web.calls).toHaveLength(1);
    expect(web.calls[0]).toContain(personHash("ann@example.com"));
    expect(web.calls[0]).toContain("d=404");
    expect(web.calls[0]).not.toContain("example.com");
  });

  it("returns the photo when there is one and a definitive none on 404", async () => {
    const hash = personHash("ann@example.com");
    const withPhoto = fakeWeb({ [`https://gravatar.com/avatar/${hash}?s=128&d=404`]: { body: PNG } });
    expect((await findGravatar("ann@example.com", withPhoto)).icon?.mime).toBe("image/png");
    expect(await findGravatar("ann@example.com", fakeWeb({}))).toEqual({ icon: null, definitive: true });
  });
});

describe("LogoService", () => {
  const settings: LogoSettings = { companyLogos: true, personPhotos: false };
  const entries = new Map<string, { dataUrl: string | null; expires: number }>();
  const cache = {
    get: (key: string, now: number) => {
      const entry = entries.get(key);
      return entry && entry.expires > now ? entry : undefined;
    },
    set: (key: string, entry: { dataUrl: string | null; expires: number }) => void entries.set(key, entry),
  };
  let now = 1_000_000;
  const site = vi.fn(async (_domain: string) => ({ icon: { mime: "image/png", data: PNG }, definitive: true }));
  const person = vi.fn(async (_email: string) => ({ icon: { mime: "image/png", data: PNG }, definitive: true }));
  const make = (extra: Partial<ConstructorParameters<typeof LogoService>[0]> = {}) =>
    new LogoService({
      cache,
      settings: { get: () => settings },
      accountDomains: () => new Set(["orion-agent.ai"]),
      findSite: site,
      findPerson: person,
      now: () => now,
      ...extra,
    });

  beforeEach(() => {
    entries.clear();
    site.mockClear();
    person.mockClear();
    now = 1_000_000;
    settings.companyLogos = true;
    settings.personPhotos = false;
  });

  it("returns a data URL for a brand and looks each site up once", async () => {
    const service = make();
    const first = await service.get([{ kind: "brand", domain: "amazon.com" }]);
    expect(first["brand:amazon.com"]).toMatch(/^data:image\/png;base64,/);
    await service.get([{ kind: "brand", domain: "amazon.com" }]);
    expect(site).toHaveBeenCalledTimes(1);
  });

  it("shares overlapping requests", async () => {
    const service = make();
    await Promise.all([
      service.get([{ kind: "brand", domain: "amazon.com" }]),
      service.get([{ kind: "brand", domain: "amazon.com" }, { kind: "brand", domain: "amazon.com" }]),
    ]);
    expect(site).toHaveBeenCalledTimes(1);
  });

  it("respects the company switch without looking anything up", async () => {
    settings.companyLogos = false;
    expect(await make().get([{ kind: "brand", domain: "amazon.com" }])).toEqual({ "brand:amazon.com": null });
    expect(site).not.toHaveBeenCalled();
  });

  it("keeps people's photos off until the user turns them on", async () => {
    const service = make();
    expect(await service.get([{ kind: "person", email: "ann@acme.com" }])).toEqual({ "person:ann@acme.com": null });
    expect(person).not.toHaveBeenCalled();

    settings.personPhotos = true;
    const result = await service.get([{ kind: "person", email: "ann@acme.com" }]);
    expect(result["person:ann@acme.com"]).toMatch(/^data:image/);
    expect([...entries.keys()]).toEqual([`person:${personHash("ann@acme.com")}`]);
  });

  it("refuses requests the page should never make", async () => {
    settings.personPhotos = true;
    const result = await make().get([
      { kind: "brand", domain: "gmail.com" }, // a mailbox provider
      { kind: "brand", domain: "sendgrid.net" }, // a sending service
      { kind: "brand", domain: "localhost" },
      { kind: "brand", domain: "10.0.0.1" },
      { kind: "brand", domain: "evil.com/path" },
      { kind: "own", domain: "not-my-account.com" }, // not one of the user's accounts
      { kind: "own", domain: "gmail.com" },
      { kind: "person", email: "not-an-address" },
    ]);
    expect(Object.values(result).every((value) => value === null)).toBe(true);
    expect(site).not.toHaveBeenCalled();
    expect(person).not.toHaveBeenCalled();
  });

  it("looks up the site behind the user's own accounts regardless of the company switch", async () => {
    settings.companyLogos = false;
    const result = await make().get([{ kind: "own", domain: "orion-agent.ai" }]);
    expect(result["own:orion-agent.ai"]).toMatch(/^data:image/);
  });

  it("remembers 'none' for a week, but a failed attempt is retried soon and never saved", async () => {
    const none = vi.fn(async () => ({ icon: null, definitive: true }));
    const failed = vi.fn(async () => ({ icon: null, definitive: false }));
    const service = make({ findSite: failed });
    await make({ findSite: none }).get([{ kind: "brand", domain: "a.com" }]);
    await service.get([{ kind: "brand", domain: "b.com" }]);
    // The failure is not in the (persisted) cache at all.
    expect([...entries.keys()]).toEqual(["site:a.com"]);

    await service.get([{ kind: "brand", domain: "b.com" }]); // right away: not hammered
    expect(failed).toHaveBeenCalledTimes(1);

    now += 3 * 60 * 1000; // three minutes later
    await make({ findSite: none }).get([{ kind: "brand", domain: "a.com" }]);
    await service.get([{ kind: "brand", domain: "b.com" }]);
    expect(none).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledTimes(2);
  });

  it("answers null instead of failing when a lookup throws", async () => {
    const result = await make({ findSite: async () => { throw new Error("boom"); } }).get([{ kind: "brand", domain: "a.com" }]);
    expect(result).toEqual({ "brand:a.com": null });
  });

  it("runs only a few lookups at once", async () => {
    let active = 0;
    let peak = 0;
    const slow = async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return { icon: null, definitive: true };
    };
    await make({ findSite: slow, concurrency: 2 }).get(
      Array.from({ length: 8 }, (_, index) => ({ kind: "brand" as const, domain: `site${index}.com` })),
    );
    expect(peak).toBe(2);
  });
});

describe("brandFallbackFor", () => {
  it("offers the company logo for a person at a company, and nothing else", () => {
    expect(brandFallbackFor({ kind: "person", email: "todomundo@nubank.com.br" })).toEqual({
      kind: "brand",
      domain: "nubank.com.br",
    });
    expect(brandFallbackFor({ kind: "person", email: "ann@gmail.com" })).toBeNull();
    expect(brandFallbackFor({ kind: "person", email: "x@sendgrid.net" })).toBeNull();
    expect(brandFallbackFor({ kind: "brand", domain: "acme.com" })).toBeNull();
    expect(brandFallbackFor(null)).toBeNull();
  });
});

describe("LogoCache", () => {
  let dir: string;
  const cipher: Cipher = {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => Buffer.from(plain, "utf8").reverse(),
    decryptString: (data) => Buffer.from(data).reverse().toString("utf8"),
  };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "minimail-logos-"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps entries between launches, encrypted, and drops stale ones", () => {
    const file = join(dir, "logos.json");
    const cache = new LogoCache(file, cipher);
    cache.set("site:acme.com", { dataUrl: "data:image/png;base64,AAAA", expires: 5000 });
    cache.set("site:none.com", { dataUrl: null, expires: 5000 });
    cache.flush();

    expect(readFileSync(file, "utf8")).not.toContain("acme.com");
    const reloaded = new LogoCache(file, cipher);
    expect(reloaded.get("site:acme.com", 1000)?.dataUrl).toBe("data:image/png;base64,AAAA");
    expect(reloaded.get("site:none.com", 1000)?.dataUrl).toBeNull();
    expect(reloaded.get("site:acme.com", 6000)).toBeUndefined();
  });

  it("ignores a cache that holds anything but images", () => {
    const file = join(dir, "logos.json");
    const bad = new LogoCache(file, cipher);
    bad.set("site:x.com", { dataUrl: "javascript:alert(1)", expires: 5000 });
    bad.flush();
    expect(new LogoCache(file, cipher).get("site:x.com", 0)).toBeUndefined();
  });

  it("writes nothing without a keychain", () => {
    const file = join(dir, "logos.json");
    const cache = new LogoCache(file, { ...cipher, isEncryptionAvailable: () => false });
    cache.set("site:a.com", { dataUrl: null, expires: 5000 });
    cache.flush();
    expect(() => readFileSync(file)).toThrow();
  });
});
