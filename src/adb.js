const { execFile } = require("child_process");
const config = require("./config");

function runAdb(args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    execFile(config.adbPath, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error && typeof error.code === "number" ? error.code : 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        error: error ? error.message : "",
      });
    });
  });
}

function runAdbBuffer(args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    execFile(config.adbPath, args, { encoding: "buffer", maxBuffer: 20 * 1024 * 1024, timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error && typeof error.code === "number" ? error.code : 0,
        stdout,
        stderr: stderr.toString("utf8").trim(),
        error: error ? error.message : "",
      });
    });
  });
}

async function connect(adbHost) {
  return runAdb(["connect", adbHost], 20000);
}

async function disconnect(adbHost) {
  return runAdb(["disconnect", adbHost], 10000);
}

async function reboot(adbHost) {
  return runAdb(["-s", adbHost, "reboot"], 10000);
}

async function shell(adbHost, command) {
  return runAdb(["-s", adbHost, "shell", command], 20000);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function getProperties(adbHost) {
  return runAdb(["-s", adbHost, "shell", "getprop ro.product.model; getprop ro.build.version.release; getprop ro.serialno"], 20000);
}

async function screenshot(adbHost) {
  return runAdbBuffer(["-s", adbHost, "exec-out", "screencap", "-p"], 30000);
}

async function installApk(adbHost, apkFile) {
  return runAdb(["-s", adbHost, "install", "-r", apkFile], 120000);
}

function parseResolvedComponent(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .reverse()
    .find((line) => /^[A-Za-z0-9_.]+\/[A-Za-z0-9_.$/]+$/.test(line)) || "";
}

async function resolveHomeActivity(adbHost, packageName) {
  const packageArg = shellQuote(packageName);
  const homeResult = await shell(
    adbHost,
    `cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME ${packageArg}`,
  );
  let component = parseResolvedComponent(homeResult.stdout);
  if (component) return { ...homeResult, component };

  const launcherResult = await shell(
    adbHost,
    `cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER ${packageArg}`,
  );
  component = parseResolvedComponent(launcherResult.stdout);
  return { ...launcherResult, component };
}

async function setHomeActivity(adbHost, component) {
  return shell(adbHost, `cmd package set-home-activity ${shellQuote(component)}`);
}

async function startPackage(adbHost, packageName) {
  return runAdb(["-s", adbHost, "shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1"], 20000);
}

async function makeLauncher(adbHost, packageName) {
  const resolveResult = await resolveHomeActivity(adbHost, packageName);
  if (!resolveResult.component) {
    return {
      ok: false,
      stdout: resolveResult.stdout,
      stderr: resolveResult.stderr,
      error: resolveResult.error || "No launcher/home activity found for the configured Package Name",
    };
  }

  const setHomeResult = await setHomeActivity(adbHost, resolveResult.component);
  const startResult = await startPackage(adbHost, packageName);
  return {
    ok: setHomeResult.ok,
    component: resolveResult.component,
    stdout: [
      `Resolved launcher activity: ${resolveResult.component}`,
      setHomeResult.stdout,
      startResult.stdout,
    ].filter(Boolean).join("\n"),
    stderr: [resolveResult.stderr, setHomeResult.stderr, startResult.stderr].filter(Boolean).join("\n"),
    error: setHomeResult.error,
  };
}

async function uninstallPackage(adbHost, packageName) {
  return runAdb(["-s", adbHost, "uninstall", packageName], 60000);
}

module.exports = {
  connect,
  disconnect,
  getProperties,
  installApk,
  makeLauncher,
  reboot,
  runAdb,
  runAdbBuffer,
  screenshot,
  shell,
  uninstallPackage,
};
