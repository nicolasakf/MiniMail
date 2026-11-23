import { describe, expect, it } from "vitest";
import { CLI_COMMANDS, type CliCommandDef } from "./cli";
import { CLI_DOCS, commandHelp, documentedOptions, topicCommand } from "./cli-docs";

describe("the docs of each command", () => {
  it("has an entry for every command and none for a command that does not exist", () => {
    expect(Object.keys(CLI_DOCS).sort()).toEqual(CLI_COMMANDS.map((command) => command.id).sort());
  });

  it("describes exactly the options the command accepts", () => {
    for (const command of CLI_COMMANDS as readonly CliCommandDef[]) {
      expect(documentedOptions(CLI_DOCS[command.id as keyof typeof CLI_DOCS]).sort(), command.id).toEqual([...(command.options ?? [])].sort());
    }
  });

  it("shows an option that takes a value with a placeholder, and a switch without one", () => {
    for (const command of CLI_COMMANDS as readonly CliCommandDef[]) {
      for (const key of Object.keys(CLI_DOCS[command.id as keyof typeof CLI_DOCS].options ?? {})) {
        const name = /^--([a-z-]+)/.exec(key)![1]!;
        expect(/ </.test(key), `${command.id} ${key}`).toBe(!(command.switches ?? []).includes(name));
      }
    }
  });

  it("gives every command at least one example that starts with it", () => {
    for (const command of CLI_COMMANDS) {
      const { examples } = CLI_DOCS[command.id];
      expect(examples.length, command.id).toBeGreaterThan(0);
      for (const [text] of examples) expect(text, command.id).toContain(`minimail ${command.id}`);
    }
  });

  it("only uses options in its examples that the command accepts", () => {
    for (const command of CLI_COMMANDS as readonly CliCommandDef[]) {
      const known = new Set(command.options ?? []);
      for (const [text] of CLI_DOCS[command.id as keyof typeof CLI_DOCS].examples) {
        for (const match of text.matchAll(/ --([a-z-]+)/g)) expect(known.has(match[1]!), `${command.id}: ${text}`).toBe(true);
      }
    }
  });

  it("finds a command from the words of a topic", () => {
    expect(topicCommand(["show"])).toBe("show");
    expect(topicCommand(["draft", "reply-all"])).toBe("draft reply-all");
    expect(topicCommand(["Draft", "  Reply"])).toBe("draft reply");
    expect(topicCommand(["nothing"])).toBeUndefined();
  });

  it("prints the sections in order, with the help option last in the options", () => {
    const text = commandHelp("search");
    const at = (part: string) => text.indexOf(part);
    expect([at("Usage"), at("About"), at("Arguments"), at("Options"), at("Answer"), at("Examples"), at("Notes")]).toEqual(
      [at("Usage"), at("About"), at("Arguments"), at("Options"), at("Answer"), at("Examples"), at("Notes")].sort((a, b) => a - b),
    );
    expect(text.indexOf("--folder <list>")).toBeLessThan(text.indexOf("-h, --help"));
  });
});
