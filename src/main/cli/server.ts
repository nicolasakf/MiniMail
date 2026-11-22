import { chmodSync, existsSync, mkdirSync, unlinkSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { dirname } from "node:path";

import { reportError } from "../events";
import type { CliResponse } from "./commands";

/** A request is one line of JSON: a draft's text is the largest part of it. */
const MAX_REQUEST_BYTES = 1024 * 1024;
/** Unix socket paths are limited to about 104 bytes on macOS (108 on Linux). */
const MAX_SOCKET_PATH = 100;

export interface CliServerDeps {
  /** Where to listen. Its folder is made private (only this user can enter it). */
  socketPath: string;
  /** Answers one request. `signal` aborts when the caller goes away (a `wait` is cut short). */
  handle: (request: unknown, signal: AbortSignal) => Promise<CliResponse>;
  /** Asked before every request, so turning the CLI off stops it at once even for a connection already open. */
  enabled: () => boolean;
}

function answerOf(code: "usage" | "disabled" | "failed", message: string): CliResponse {
  return { ok: false, error: { code, message } };
}

/**
 * The CLI's way in: a Unix socket that only the person's own account can open, speaking one line of
 * JSON each way. It carries no authority of its own: every request is checked against what the person
 * allowed (see `handleCliRequest`) before it does anything.
 */
export class CliServer {
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();

  constructor(private readonly deps: CliServerDeps) {}

  get running(): boolean {
    return this.server !== null;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const { socketPath } = this.deps;
    if (socketPath.length > MAX_SOCKET_PATH) throw new Error(`The CLI socket path is too long (${socketPath.length} characters): ${socketPath}`);
    const folder = dirname(socketPath);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    chmodSync(folder, 0o700);
    // Left over from a MiniMail that did not shut down cleanly. The single-instance lock means no other MiniMail owns it.
    if (existsSync(socketPath)) unlinkSync(socketPath);

    const server = createServer((socket) => this.accept(socket));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.off("error", reject);
        resolve();
      });
    });
    chmodSync(socketPath, 0o600);
    server.on("error", (error) => reportError("cli", "The CLI socket failed", error));
    this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    for (const socket of this.sockets) socket.destroy();
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    // Right away, not after the close: the app may be quitting and not wait for it.
    try {
      if (existsSync(this.deps.socketPath)) unlinkSync(this.deps.socketPath);
    } catch (error) {
      reportError("cli", "Could not remove the CLI socket file", error);
    }
    await closed;
  }

  private accept(socket: Socket): void {
    this.sockets.add(socket);
    socket.setEncoding("utf8");
    const abort = new AbortController();
    let buffer = "";
    let started = false;
    socket.on("close", () => {
      this.sockets.delete(socket);
      abort.abort();
    });
    // expected: a caller that goes away mid-answer (Ctrl-C, a closed terminal) leaves nothing to answer, and nothing was lost.
    socket.on("error", () => undefined);
    socket.on("data", (chunk: string) => {
      if (started) return;
      buffer += chunk;
      if (buffer.length > MAX_REQUEST_BYTES) {
        started = true;
        this.reply(socket, answerOf("usage", "That request is too large."));
        return;
      }
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      started = true;
      void this.serve(socket, buffer.slice(0, end), abort.signal);
    });
  }

  private async serve(socket: Socket, line: string, signal: AbortSignal): Promise<void> {
    if (!this.deps.enabled()) {
      this.reply(socket, answerOf("disabled", "The MiniMail CLI is turned off. The person can turn it on in MiniMail, Settings, CLI."));
      return;
    }
    let request: unknown;
    try {
      request = JSON.parse(line);
    } catch {
      // expected: a line that is not JSON is the caller's mistake, and it is told so in the answer.
      this.reply(socket, answerOf("usage", "That request was not understood."));
      return;
    }
    try {
      this.reply(socket, await this.deps.handle(request, signal));
    } catch (error) {
      // A caller that left (aborting a wait) is not a failure.
      if (signal.aborted) return;
      reportError("cli", "A CLI command failed", error);
      this.reply(socket, answerOf("failed", `MiniMail could not do that: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  private reply(socket: Socket, response: CliResponse): void {
    if (socket.destroyed) return;
    socket.end(`${JSON.stringify(response)}\n`);
  }
}
