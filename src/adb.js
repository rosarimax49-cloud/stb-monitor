const { execFile } = require("child_process");
const config = require("./config");

function runAdb(args, timeoutMs = 15000) {
  return new Promise((resolve) => {
    execFile(config.adbPath, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      const timedOut = error ? error.killed === true && error.signal === "SIGTERM" : false;
      const details = [];
      if (error) {
        details.push(error.message);
        if (timedOut) details.push(`ADB command timed out after ${Math.round(timeoutMs / 1000)} seconds`);
        if (error.signal) details.push(`signal=${error.signal}`);
        if (error.code !== undefined && error.code !== null) details.push(`code=${error.code}`);
      }
      resolve({
        ok: !error,
        code: error && typeof error.code === "number" ? error.code : 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        error: details.join("\n"),
        signal: error?.signal || "",
        timedOut,
        timeoutMs,
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

async function keyEvent(adbHost, keyCode) {
  return runAdb(["-s", adbHost, "shell", "input", "keyevent", keyCode], 10000);
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function getProperties(adbHost) {
  return runAdb(["-s", adbHost, "shell", "getprop ro.product.model; getprop ro.build.version.release; getprop ro.serialno"], 20000);
}

async function getDeviceInfo(adbHost) {
  return shell(adbHost, [
    "echo '=== Device ==='",
    "getprop ro.product.manufacturer",
    "getprop ro.product.model",
    "getprop ro.product.device",
    "getprop ro.build.version.release",
    "getprop ro.build.version.sdk",
    "getprop ro.serialno",
    "echo '=== Uptime ==='",
    "uptime",
    "echo '=== Memory ==='",
    "cat /proc/meminfo | head -n 8",
    "echo '=== Storage ==='",
    "df -h /data /sdcard 2>/dev/null",
    "echo '=== Network ==='",
    "ip addr show 2>/dev/null",
    "echo '=== CPU ==='",
    "cat /proc/cpuinfo | head -n 24",
  ].join("; "), 30000);
}

async function screenshot(adbHost) {
  return runAdbBuffer(["-s", adbHost, "exec-out", "screencap", "-p"], 30000);
}

async function installApk(adbHost, apkFile) {
  const connectResult = adbHost ? await connect(adbHost) : { ok: true, stdout: "", stderr: "", error: "" };
  const installResult = await runAdb(["install", apkFile], 15 * 60 * 1000);
  installResult.command = `${config.adbPath} install "${apkFile}"`;
  installResult.connect = connectResult;
  installResult.stdout = [connectResult.stdout, installResult.stdout].filter(Boolean).join("\n");
  installResult.stderr = [connectResult.stderr, installResult.stderr].filter(Boolean).join("\n");
  return installResult;
}

async function listInstalledApps(adbHost) {
  const result = await runAdb(["-s", adbHost, "shell", "pm", "list", "packages", "-f"], 45000);
  const apps = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const cleaned = line.replace(/^package:/, "");
      const separator = cleaned.lastIndexOf("=");
      return separator >= 0
        ? { apkPath: cleaned.slice(0, separator), packageName: cleaned.slice(separator + 1) }
        : { apkPath: "", packageName: cleaned };
    })
    .filter((app) => app.packageName)
    .sort((a, b) => a.packageName.localeCompare(b.packageName, undefined, { sensitivity: "base" }));
  return { ...result, apps };
}

function parseResolvedComponent(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .reverse()
    .find((line) => /^[A-Za-z0-9_.]+\/[A-Za-z0-9_.$/]+$/.test(line)) || "";
}

function parseComponents(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[A-Za-z0-9_.]+\/[A-Za-z0-9_.$/]+$/.test(line));
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

async function queryHomeActivities(adbHost) {
  const result = await shell(adbHost, "cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.HOME");
  return { ...result, components: parseComponents(result.stdout) };
}

async function startPackage(adbHost, packageName) {
  return runAdb(["-s", adbHost, "shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1"], 20000);
}

async function makeLauncher(adbHost, packageName) {
  const component = `${packageName}/com.netify.app.MainActivity`;
  const setHomeResult = await setHomeActivity(adbHost, component);
  const whitelistResult = await shell(adbHost, `dumpsys deviceidle whitelist +${shellQuote(packageName)}`);
  const disableStockLauncherResult = await shell(adbHost, "pm disable-user --user 0 com.droidlogic.xlauncher");
  const startResult = await startPackage(adbHost, packageName);
  return {
    ok: setHomeResult.ok && whitelistResult.ok && disableStockLauncherResult.ok,
    component,
    stdout: [
      `Using launcher activity: ${component}`,
      setHomeResult.stdout,
      whitelistResult.stdout,
      disableStockLauncherResult.stdout,
      startResult.stdout,
    ].filter(Boolean).join("\n"),
    stderr: [setHomeResult.stderr, whitelistResult.stderr, disableStockLauncherResult.stderr, startResult.stderr].filter(Boolean).join("\n"),
    error: [setHomeResult.error, whitelistResult.error, disableStockLauncherResult.error].filter(Boolean).join("\n"),
  };
}

async function clearLauncher(adbHost, packageName) {
  const enableStockLauncherResult = await shell(adbHost, "pm enable com.droidlogic.xlauncher");
  const removeWhitelistResult = await shell(adbHost, `dumpsys deviceidle whitelist -${shellQuote(packageName)}`);
  const packageArg = shellQuote(packageName);
  const result = await shell(adbHost, `cmd package clear-default-apps ${packageArg}`);
  if (result.ok) {
    return {
      ...result,
      stdout: [enableStockLauncherResult.stdout, removeWhitelistResult.stdout, result.stdout].filter(Boolean).join("\n"),
      stderr: [enableStockLauncherResult.stderr, removeWhitelistResult.stderr, result.stderr].filter(Boolean).join("\n"),
      error: [enableStockLauncherResult.error, removeWhitelistResult.error, result.error].filter(Boolean).join("\n"),
    };
  }
  const fallback = await shell(adbHost, `pm clear-default-apps ${packageArg}`);
  if (fallback.ok) {
    return {
      ...fallback,
      stdout: [enableStockLauncherResult.stdout, removeWhitelistResult.stdout, result.stdout, fallback.stdout].filter(Boolean).join("\n"),
      stderr: [enableStockLauncherResult.stderr, removeWhitelistResult.stderr, result.stderr, fallback.stderr].filter(Boolean).join("\n"),
      error: [enableStockLauncherResult.error, removeWhitelistResult.error, result.error, fallback.error].filter(Boolean).join("\n"),
    };
  }

  const homeActivities = await queryHomeActivities(adbHost);
  const replacement = homeActivities.components.find((component) => !component.toLowerCase().startsWith(`${packageName.toLowerCase()}/`));
  if (replacement) {
    const setHomeResult = await setHomeActivity(adbHost, replacement);
    return {
      ok: setHomeResult.ok,
      component: replacement,
      stdout: [
        enableStockLauncherResult.stdout,
        removeWhitelistResult.stdout,
        result.stdout,
        fallback.stdout,
        `Fallback: setting alternate home activity ${replacement}`,
        homeActivities.stdout,
        setHomeResult.stdout,
      ].filter(Boolean).join("\n"),
      stderr: [enableStockLauncherResult.stderr, removeWhitelistResult.stderr, result.stderr, fallback.stderr, homeActivities.stderr, setHomeResult.stderr].filter(Boolean).join("\n"),
      error: setHomeResult.error || [enableStockLauncherResult.error, removeWhitelistResult.error, result.error, fallback.error, homeActivities.error].filter(Boolean).join("\n"),
    };
  }

  return {
    ok: false,
    stdout: [
      enableStockLauncherResult.stdout,
      removeWhitelistResult.stdout,
      result.stdout,
      fallback.stdout,
      homeActivities.stdout,
      "No alternate HOME launcher activity was found to switch to.",
    ].filter(Boolean).join("\n"),
    stderr: [enableStockLauncherResult.stderr, removeWhitelistResult.stderr, result.stderr, fallback.stderr, homeActivities.stderr].filter(Boolean).join("\n"),
    error: [enableStockLauncherResult.error, removeWhitelistResult.error, result.error, fallback.error, homeActivities.error, "No alternate HOME launcher activity was found"].filter(Boolean).join("\n"),
  };
}

async function uninstallPackage(adbHost, packageName) {
  return runAdb(["-s", adbHost, "uninstall", packageName], 60000);
}

module.exports = {
  clearLauncher,
  connect,
  disconnect,
  getDeviceInfo,
  getProperties,
  installApk,
  keyEvent,
  listInstalledApps,
  makeLauncher,
  reboot,
  runAdb,
  runAdbBuffer,
  screenshot,
  shell,
  startPackage,
  uninstallPackage,
};
