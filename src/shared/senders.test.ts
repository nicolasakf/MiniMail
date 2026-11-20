import { describe, expect, it } from "vitest";

import { buildSenderRows, countSenderRows, filterSenderRows, parseSenderEntry, parseSenderList, senderLabel } from "./senders";

const none = { senders: [], domains: [] };

describe("parseSenderEntry", () => {
  it("reads an address and a whole domain", () => {
    expect(parseSenderEntry("  Ana@Example.com ")).toEqual({ kind: "senders", value: "ana@example.com" });
    expect(parseSenderEntry("@example.com")).toEqual({ kind: "domains", value: "example.com" });
  });

  it("names a host by its company domain", () => {
    expect(parseSenderEntry("@mail.acme.com")).toEqual({ kind: "domains", value: "acme.com" });
  });

  it("refuses text that is neither", () => {
    expect(parseSenderEntry("example.com")).toBeNull();
    expect(parseSenderEntry("ana@")).toBeNull();
    expect(parseSenderEntry("")).toBeNull();
  });
});

describe("parseSenderList", () => {
  const labels = (input: string) => parseSenderList(input).entries.map(senderLabel);

  it("reads addresses and domains separated by commas, semicolons, spaces or lines", () => {
    expect(labels("a@x.com, b@y.org; @z.net\nc@w.io d@v.io")).toEqual(["a@x.com", "b@y.org", "@z.net", "c@w.io", "d@v.io"]);
  });

  it("takes the address out of a name in angle brackets", () => {
    expect(labels('Ana Silva <ana@x.com>, "Bob, B." <bob@y.org>')).toEqual(["ana@x.com", "bob@y.org"]);
    expect(labels("<ana@x.com>")).toEqual(["ana@x.com"]);
  });

  it("does not mistake a bare address before a named one for a name", () => {
    expect(labels("a@x.com b@y.com Bob <c@z.com>")).toEqual(["a@x.com", "b@y.com", "c@z.com"]);
  });

  it("lists each entry once, whatever the case", () => {
    expect(labels("A@x.com a@x.com @X.com @x.com")).toEqual(["a@x.com", "@x.com"]);
  });

  it("hands back what is neither an address nor a domain", () => {
    expect(parseSenderList("ana@x.com, hello, example.com")).toEqual({
      entries: [{ kind: "senders", value: "ana@x.com" }],
      invalid: ["hello", "example.com"],
    });
  });

  it("keeps a few words that are no address together", () => {
    expect(parseSenderList("john smith").invalid).toEqual(["john smith"]);
    expect(parseSenderList("john, smith").invalid).toEqual(["john", "smith"]);
    expect(parseSenderList("john ana@x.com").invalid).toEqual(["john"]);
  });

  it("is empty for blank text", () => {
    expect(parseSenderList("  ,; \n")).toEqual({ entries: [], invalid: [] });
  });
});

describe("buildSenderRows", () => {
  it("lists someone on several lists once", () => {
    const rows = buildSenderRows({ senders: ["team@acme.com"], domains: [] }, none, ["team@acme.com"]);
    expect(rows).toEqual([
      { kind: "senders", value: "team@acme.com", label: "team@acme.com", priority: true, muted: true, blocked: false },
    ]);
  });

  it("keeps an address and its domain apart", () => {
    const rows = buildSenderRows(none, { senders: ["deals@shop.net"], domains: ["shop.net"] }, []);
    expect(rows.map((row) => row.label).sort()).toEqual(["@shop.net", "deals@shop.net"]);
    expect(rows.every((row) => row.blocked)).toBe(true);
  });

  it("sorts by domain, a domain's own row ahead of its addresses", () => {
    const rows = buildSenderRows(
      { senders: ["zed@acme.com", "ana@acme.com"], domains: ["bank.example"] },
      { senders: ["deals@shop.net"], domains: ["acme.com", "shop.net"] },
      ["@aaa.org"],
    );
    expect(rows.map((row) => row.label)).toEqual(["@aaa.org", "@acme.com", "ana@acme.com", "zed@acme.com", "@bank.example", "@shop.net", "deals@shop.net"]);
  });

  it("does not reorder when a row changes lists", () => {
    const before = buildSenderRows({ senders: ["a@x.com"], domains: [] }, { senders: ["b@x.com"], domains: [] }, []);
    const after = buildSenderRows({ senders: ["a@x.com", "b@x.com"], domains: [] }, { senders: [], domains: [] }, []);
    expect(after.map((row) => row.label)).toEqual(before.map((row) => row.label));
  });

  it("is empty when nothing is listed", () => {
    expect(buildSenderRows(none, none, [])).toEqual([]);
  });
});

describe("filterSenderRows and countSenderRows", () => {
  const rows = buildSenderRows(
    { senders: ["ana@acme.com"], domains: ["bank.example"] },
    { senders: ["deals@shop.net"], domains: [] },
    ["@shop.net", "ana@acme.com"],
  );

  it("counts what each filter shows", () => {
    expect(countSenderRows(rows)).toEqual({ all: 4, priority: 2, muted: 2, blocked: 1 });
  });

  it("filters by list", () => {
    expect(filterSenderRows(rows, "muted", "").map((row) => row.label).sort()).toEqual(["@shop.net", "ana@acme.com"]);
    expect(filterSenderRows(rows, "blocked", "").map((row) => row.label)).toEqual(["deals@shop.net"]);
  });

  it("searches the name without minding case or spaces", () => {
    expect(filterSenderRows(rows, "all", "  SHOP ").map((row) => row.label).sort()).toEqual(["@shop.net", "deals@shop.net"]);
    expect(filterSenderRows(rows, "priority", "shop")).toEqual([]);
  });
});

describe("senderLabel", () => {
  it("writes a domain with an @", () => {
    expect(senderLabel({ kind: "domains", value: "acme.com" })).toBe("@acme.com");
    expect(senderLabel({ kind: "senders", value: "ana@acme.com" })).toBe("ana@acme.com");
  });
});
