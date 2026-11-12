const { execFileSync } = require("node:child_process");
const { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { dirname, join, resolve } = require("node:path");

if (process.platform !== "darwin") {
  throw new Error("MiniMail Dev requires macOS.");
}

const project = resolve(__dirname, "..");
const applications = join(homedir(), "Applications");
const appName = "MiniMail";
const bundleIdentifier = "com.nicolasakf.minimail.dev-launcher";
const destination = join(applications, `${appName}.app`);
const electron = require("electron");
const npm = realpathSync(join(dirname(process.execPath), "npm"));
const { name, version } = require("../package.json");

if (existsSync(destination)) {
  const identifier = execFileSync(
    "/usr/bin/plutil",
    ["-extract", "CFBundleIdentifier", "raw", join(destination, "Contents", "Info.plist")],
    { encoding: "utf8" },
  ).trim();
  if (identifier !== bundleIdentifier) {
    throw new Error(`A different app is already installed at ${destination}.`);
  }
}

mkdirSync(applications, { recursive: true });
const temp = mkdtempSync(join(applications, ".minimail-dev-"));
const bundle = join(temp, `${appName}.app`);
const previous = join(temp, "Previous.app");
const resources = join(bundle, "Contents", "Resources");
const bootstrap = join(resources, "app");
const plist = join(bundle, "Contents", "Info.plist");
let installed = false;

try {
  execFileSync("/bin/cp", ["-cR", resolve(dirname(electron), "../.."), bundle]);
  for (const [key, value] of Object.entries({
    CFBundleName: appName,
    CFBundleDisplayName: appName,
    CFBundleIdentifier: bundleIdentifier,
  })) {
    execFileSync("/usr/bin/plutil", ["-replace", key, "-string", value, plist]);
  }
  copyFileSync(join(project, "build", "icon.icns"), join(resources, "electron.icns"));
  rmSync(join(resources, "default_app.asar"));
  mkdirSync(bootstrap);
  copyFileSync(join(__dirname, "mac-dev", "main.cjs"), join(bootstrap, "main.cjs"));
  copyFileSync(join(__dirname, "mac-dev", "vite-ready.sh"), join(bootstrap, "vite-ready.sh"));
  writeFileSync(
    join(bootstrap, "package.json"),
    JSON.stringify({ name, version, main: "main.cjs", project, node: process.execPath, npm }),
  );

  execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", "--identifier", "Electron", bundle]);
  execFileSync("/usr/bin/codesign", ["--verify", "--strict", bundle]);
  if (existsSync(destination)) renameSync(destination, previous);
  renameSync(bundle, destination);
  installed = true;
} finally {
  if (!installed && existsSync(previous)) renameSync(previous, destination);
  rmSync(temp, { recursive: true, force: true });
}

execFileSync(
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
  ["-f", destination],
);
console.log(`Installed ${destination}`);
