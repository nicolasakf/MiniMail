"use strict";
/*
 * The `minimail` command. It is a thin client: it turns what was typed into one request, sends it to
 * the running MiniMail over a private socket and prints the answer. All the rules (what is allowed,
 * what is withheld) are applied by MiniMail, never here. MiniMail writes this file next to the
 * launcher each time it starts, so the two always belong to the same version.
 *
 * Environment (set by the launcher): MINIMAIL_SOCKET, and MINIMAIL_APP (the app to start when it is not running).
 */

const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PROTOCOL = 1;
/** Options that stand alone; the word after them is not their value. Kept equal to the catalog by a test. */
const SWITCHES = new Set(["unread", "full", "headers", "remove", "thread"]);
const START_WAIT_MS = 20_000;
const RETRY_MS = 300;

/** `list inbox --limit 5 --unread` -> { command, positional, flags }. */
function parseArgs(argv) {
  const positional = [];
  const flags = {};
  let rest = false;
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index];
    if (rest || !word.startsWith("--") || word === "--") {
      if (!rest && word === "--") rest = true;
      else positional.push(word);
      continue;
    }
    const equals = word.indexOf("=");
    if (equals > 0) {
      put(flags, word.slice(2, equals), word.slice(equals + 1));
      continue;
    }
    const name = word.slice(2);
    const next = argv[index + 1];
    // A value may be "-" (read it from standard input) or start with a single dash; only another --option ends it.
    if (SWITCHES.has(name) || next === undefined || next.startsWith("--")) flags[name] = true;
    else {
      put(flags, name, next);
      index += 1;
    }
  }
  const [command, ...words] = positional;
  // `draft new` is one command with two words.
  if (command === "draft" && words.length > 0) return { command: `draft ${words[0]}`, positional: words.slice(1), flags };
  return { command: command ?? "help", positional: words, flags };
}

/** An option given twice (--attach a --attach b) keeps both, one per line. */
function put(flags, name, value) {
  flags[name] = typeof flags[name] === "string" ? `${flags[name]}\n${value}` : value;
}

/** Files are named relative to where the command was typed; MiniMail does not know that place. */
function absolutePaths(value) {
  return value
    .split("\n")
    .filter(Boolean)
    .map((file) => path.resolve(file))
    .join("\n");
}

/** Reads all of standard input (for `--body -`, so a long text does not have to be a command-line argument). */
function readStdin() {
  return new Promise((resolve, reject) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      text += chunk;
    });
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", reject);
  });
}

/** Sends one request and resolves with the answer, or rejects with the connection error. */
function ask(socketPath, request) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let data = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => {
      data += chunk;
    });
    socket.on("error", reject);
    socket.on("close", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("MiniMail closed the connection without an answer. If you turned the CLI off, that is why."));
      }
    });
    const stop = () => socket.destroy();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const notThere = (error) => error && (error.code === "ENOENT" || error.code === "ECONNREFUSED");

/** Starts MiniMail without bringing it to the front (macOS), then waits for its socket. */
async function startApp(socketPath, request, app) {
  if (process.platform !== "darwin" || !app) return null;
  spawn("open", ["-g", "-a", app, "--args", "--hidden"], { detached: true, stdio: "ignore" }).unref();
  const until = Date.now() + START_WAIT_MS;
  while (Date.now() < until) {
    await sleep(RETRY_MS);
    try {
      return await ask(socketPath, request);
    } catch (error) {
      if (!notThere(error)) throw error;
    }
  }
  return null;
}

function fail(message, code) {
  process.stderr.write(`minimail: ${message}\n`);
  process.exit(code);
}

async function main() {
  const socketPath = process.env.MINIMAIL_SOCKET;
  if (!socketPath) fail("This script is started by the minimail launcher that MiniMail writes. Use the command shown in MiniMail, Settings, CLI.", 2);
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.flags.help === true) {
    parsed.command = "help";
    parsed.positional = [];
    parsed.flags = {};
  }
  if (typeof parsed.flags.attach === "string") parsed.flags.attach = absolutePaths(parsed.flags.attach);
  if (parsed.flags.body === "-") parsed.flags.body = await readStdin();
  const request = { protocol: PROTOCOL, ...parsed };

  let answer;
  try {
    answer = await ask(socketPath, request);
  } catch (error) {
    if (!notThere(error)) fail(error.message, 1);
    answer = await startApp(socketPath, request, process.env.MINIMAIL_APP).catch((startError) => fail(startError.message, 1));
    if (!answer) {
      fail("MiniMail is not running, or the CLI is turned off. Open MiniMail and turn it on in Settings, CLI.", 1);
    }
  }

  if (answer.ok) {
    process.stdout.write(typeof answer.text === "string" ? `${answer.text}\n` : `${JSON.stringify(answer.data, null, 2)}\n`);
    return;
  }
  fail(answer.error.message, answer.error.code === "usage" ? 2 : 1);
}

if (require.main === module) {
  main().catch((error) => fail(error.message, 1));
}

module.exports = { parseArgs, absolutePaths, SWITCHES, PROTOCOL };
