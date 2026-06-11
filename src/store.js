const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const config = require("./config");

const dataDir = path.join(process.cwd(), "data");
const devicesFile = path.join(dataDir, "stbs.json");
const eventsFile = path.join(dataDir, "events.json");
const settingsFile = path.join(dataDir, "settings.json");

async function ensureFiles() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(devicesFile);
  } catch {
    await fs.writeFile(devicesFile, "[]\n");
  }
  try {
    await fs.access(eventsFile);
  } catch {
    await fs.writeFile(eventsFile, "[]\n");
  }
  try {
    await fs.access(settingsFile);
  } catch {
    await fs.writeFile(settingsFile, "{}\n");
  }
}

async function readJson(filePath, fallback) {
  await ensureFiles();
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function listDevices() {
  return readJson(devicesFile, []);
}

async function saveDevices(devices) {
  await ensureFiles();
  await writeJson(devicesFile, devices);
  return devices;
}

function normalizeDevice(input) {
  const id = input.id || slug(input.name || input.host) || crypto.randomUUID();
  return {
    id,
    name: input.name || input.host || id,
    host: input.host || "",
    adbHost: input.adbHost || input.host || "",
    location: input.location || "",
    notes: input.notes || "",
    enabled: input.enabled !== false,
    ristvInstalledAt: input.ristvInstalledAt || "",
    ristvApkFileName: input.ristvApkFileName || "",
    ristvLauncherConfiguredAt: input.ristvLauncherConfiguredAt || "",
    ristvLauncherComponent: input.ristvLauncherComponent || "",
  };
}

async function upsertDevice(input) {
  const devices = await listDevices();
  const id = input.id || slug(input.name || input.host) || crypto.randomUUID();
  const index = devices.findIndex((device) => device.id === id);
  const next = normalizeDevice(index >= 0 ? { ...devices[index], ...input, id } : { ...input, id });
  if (index >= 0) devices[index] = next;
  else devices.push(next);
  await saveDevices(devices);
  return next;
}

async function updateDevice(id, patch) {
  const devices = await listDevices();
  const index = devices.findIndex((device) => device.id === id);
  if (index < 0) return null;
  const next = normalizeDevice({ ...devices[index], ...patch, id });
  devices[index] = next;
  await saveDevices(devices);
  return next;
}

async function importDevices(inputs, mode = "add") {
  const base = mode === "replace" ? [] : await listDevices();
  for (const input of inputs) {
    const next = normalizeDevice(input);
    const index = base.findIndex((device) => device.id === next.id);
    if (index >= 0) base[index] = next;
    else base.push(next);
  }
  await saveDevices(base);
  return base;
}

async function deleteDevice(id) {
  const devices = await listDevices();
  const next = devices.filter((device) => device.id !== id);
  await saveDevices(next);
  return devices.length !== next.length;
}

async function clearDevices() {
  await saveDevices([]);
  return true;
}

function retentionCutoff(retentionDays = config.logRetentionDays) {
  const days = Number.parseInt(retentionDays, 10);
  const safeDays = Number.isFinite(days) && days >= 1 ? days : 30;
  return Date.now() - safeDays * 24 * 60 * 60 * 1000;
}

function filterRetainedEvents(events, retentionDays = config.logRetentionDays) {
  const cutoff = retentionCutoff(retentionDays);
  return events.filter((event) => {
    const timestamp = Date.parse(event.at);
    return !Number.isFinite(timestamp) || timestamp >= cutoff;
  });
}

async function pruneEvents(retentionDays = config.logRetentionDays) {
  const events = await readJson(eventsFile, []);
  const retained = filterRetainedEvents(events, retentionDays);
  if (retained.length !== events.length) {
    await writeJson(eventsFile, retained);
  }
  return events.length - retained.length;
}

async function listEvents(limit = 100) {
  const events = await readJson(eventsFile, []);
  const retained = filterRetainedEvents(events);
  if (retained.length !== events.length) {
    await writeJson(eventsFile, retained);
  }
  return retained.slice(-limit).reverse();
}

async function clearEvents() {
  await ensureFiles();
  await writeJson(eventsFile, []);
  return true;
}

async function addEvent(event) {
  const events = await readJson(eventsFile, []);
  const next = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    ...event,
  };
  events.push(next);
  await writeJson(eventsFile, filterRetainedEvents(events).slice(-1000));
  return next;
}

async function getSettings() {
  return readJson(settingsFile, {});
}

async function saveSettings(settings) {
  await ensureFiles();
  await writeJson(settingsFile, settings);
  return settings;
}

module.exports = {
  addEvent,
  clearEvents,
  clearDevices,
  deleteDevice,
  getSettings,
  importDevices,
  listDevices,
  listEvents,
  pruneEvents,
  saveSettings,
  saveDevices,
  updateDevice,
  upsertDevice,
};
