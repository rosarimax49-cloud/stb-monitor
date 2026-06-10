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

async function getProperties(adbHost) {
  return runAdb(["-s", adbHost, "shell", "getprop ro.product.model; getprop ro.build.version.release; getprop ro.serialno"], 20000);
}

async function screenshot(adbHost) {
  return runAdbBuffer(["-s", adbHost, "exec-out", "screencap", "-p"], 30000);
}

async function installApk(adbHost, apkFile) {
  return runAdb(["-s", adbHost, "install", "-r", apkFile], 120000);
}

async function uninstallPackage(adbHost, packageName) {
  return runAdb(["-s", adbHost, "uninstall", packageName], 60000);
}

module.exports = {
  connect,
  disconnect,
  getProperties,
  installApk,
  reboot,
  runAdb,
  runAdbBuffer,
  screenshot,
  shell,
  uninstallPackage,
};
