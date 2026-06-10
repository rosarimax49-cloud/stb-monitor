const fs = require("fs");
const path = require("path");

function loadDotEnv(filePath = path.join(process.cwd(), ".env")) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function intEnv(name, fallback) {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) ? value : fallback;
}

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

loadDotEnv();

const config = {
  port: intEnv("PORT", 3000),
  monitorIntervalMs: intEnv("MONITOR_INTERVAL_MS", 30000),
  pingTimeoutMs: intEnv("PING_TIMEOUT_MS", 3000),
  alertCooldownMs: intEnv("ALERT_COOLDOWN_MS", 15 * 60 * 1000),
  logRetentionDays: intEnv("LOG_RETENTION_DAYS", 30),
  adbPath: process.env.ADB_PATH || "adb",
  packageName: process.env.PACKAGE_NAME || "",
  ristvApkFile: process.env.RISTV_APK_FILE || "",
  smtp: {
    host: process.env.SMTP_HOST || "",
    port: intEnv("SMTP_PORT", 587),
    secure: boolEnv("SMTP_SECURE", false),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    from: process.env.SMTP_FROM || "RISTV STB Monitor <alerts@localhost>",
    to: (process.env.ALERT_TO || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  },
};

function numberSetting(input, fallback, min = 0) {
  const value = Number.parseInt(input, 10);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

function stringSetting(source, key, fallback = "") {
  return Object.prototype.hasOwnProperty.call(source, key) ? String(source[key] || "") : fallback;
}

function cleanSettings(input = {}) {
  const smtp = input.smtp || {};
  return {
    port: numberSetting(input.port, config.port, 1),
    monitorIntervalMs: numberSetting(input.monitorIntervalMs, config.monitorIntervalMs, 5000),
    pingTimeoutMs: numberSetting(input.pingTimeoutMs, config.pingTimeoutMs, 1000),
    alertCooldownMs: numberSetting(input.alertCooldownMs, config.alertCooldownMs, 0),
    logRetentionDays: numberSetting(input.logRetentionDays, config.logRetentionDays, 1),
    adbPath: stringSetting(input, "adbPath", config.adbPath || "adb").trim() || "adb",
    packageName: stringSetting(input, "packageName", config.packageName || "").trim(),
    ristvApkFile: stringSetting(input, "ristvApkFile", config.ristvApkFile || "").trim(),
    smtp: {
      host: stringSetting(smtp, "host", config.smtp.host).trim(),
      port: numberSetting(smtp.port, config.smtp.port, 1),
      secure: Object.prototype.hasOwnProperty.call(smtp, "secure") ? smtp.secure === true : config.smtp.secure,
      user: stringSetting(smtp, "user", config.smtp.user).trim(),
      pass: stringSetting(smtp, "pass", config.smtp.pass),
      from: stringSetting(smtp, "from", config.smtp.from || "").trim(),
      to: Array.isArray(smtp.to)
        ? smtp.to.map((value) => String(value).trim()).filter(Boolean)
        : stringSetting(smtp, "to", config.smtp.to.join(","))
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
    },
  };
}

function applySettings(input = {}) {
  const next = cleanSettings(input);
  config.port = next.port;
  config.monitorIntervalMs = next.monitorIntervalMs;
  config.pingTimeoutMs = next.pingTimeoutMs;
  config.alertCooldownMs = next.alertCooldownMs;
  config.logRetentionDays = next.logRetentionDays;
  config.adbPath = next.adbPath;
  config.packageName = next.packageName;
  config.ristvApkFile = next.ristvApkFile;
  config.smtp = next.smtp;
  return getSettings();
}

function getSettings() {
  return {
    port: config.port,
    monitorIntervalMs: config.monitorIntervalMs,
    pingTimeoutMs: config.pingTimeoutMs,
    alertCooldownMs: config.alertCooldownMs,
    logRetentionDays: config.logRetentionDays,
    adbPath: config.adbPath,
    packageName: config.packageName,
    ristvApkFile: config.ristvApkFile,
    smtp: { ...config.smtp },
  };
}

config.applySettings = applySettings;
config.cleanSettings = cleanSettings;
config.getSettings = getSettings;

module.exports = config;
