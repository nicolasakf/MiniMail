const { spawn } = require("node:child_process");
const { delimiter, dirname, join } = require("node:path");
const { createInterface } = require("node:readline");
const { app, dialog } = require("electron");
const { project, node, npm } = require("./package.json");

// Match the normal dev entry point before Electron initializes macOS storage.
app.setName("MiniMail");
app.setAppPath(project);
process.chdir(project);

const vite = spawn(node, [npm, "run", "dev"], {
  cwd: project,
  env: {
    ...process.env,
    PATH: [dirname(node), process.env.PATH].filter(Boolean).join(delimiter),
    ELECTRON_EXEC_PATH: join(__dirname, "vite-ready.sh"),
  },
  stdio: ["pipe", "pipe", "pipe"],
});

let quitting = false;
let started = false;
let errors = "";

function fail(message) {
  if (quitting) return;
  quitting = true;
  dialog.showErrorBox(app.getName(), message);
  app.quit();
}

app.once("will-quit", () => {
  quitting = true;
  vite.stdin.end();
  if (!started) vite.kill();
});

vite.stderr.on("data", (chunk) => {
  errors = (errors + chunk).slice(-4000);
  process.stderr.write(chunk);
});
vite.on("error", (error) => fail(error.message));
vite.on("close", (code, signal) => {
  fail(errors.trim() || `The Vite dev server exited (${signal || code}).`);
});

// Electron Vite invokes the script when its builds and renderer server are ready.
// The script stays alive until this app closes its stdin.
const output = createInterface({ input: vite.stdout });
output.on("line", (line) => {
  const prefix = "MINIMAIL_RENDERER_URL=";
  if (quitting || started || !line.startsWith(prefix)) {
    console.log(line);
    return;
  }
  process.env.ELECTRON_RENDERER_URL = line.slice(prefix.length);
  try {
    require(project);
    started = true;
  } catch (error) {
    fail(error.message);
  }
});
