const EventEmitter = require("events");
const config = require("./config");
const { pingHost } = require("./ping");
const store = require("./store");
const email = require("./email");

class Monitor extends EventEmitter {
  constructor() {
    super();
    this.statuses = new Map();
    this.timer = null;
    this.running = false;
    this.currentCheck = null;
  }

  start() {
    if (this.timer) return;
    this.checkAll();
    this.timer = setInterval(() => this.checkAll(), config.monitorIntervalMs);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  restart() {
    this.stop();
    this.start();
  }

  getStatuses() {
    return Array.from(this.statuses.values());
  }

  getStatus(id) {
    return this.statuses.get(id);
  }

  async checkAll() {
    if (this.running && this.currentCheck) return this.currentCheck;
    this.running = true;
    this.currentCheck = (async () => {
      const devices = (await store.listDevices()).filter((device) => device.enabled);
      await Promise.all(devices.map((device) => this.checkDevice(device)));
      this.emit("update", this.getStatuses());
    })();
    try {
      await this.currentCheck;
    } finally {
      this.running = false;
      this.currentCheck = null;
    }
  }

  async checkDevice(device) {
    const previous = this.statuses.get(device.id);
    const ping = await pingHost(device.host, config.pingTimeoutMs);
    const state = ping.ok ? "online" : "offline";
    const now = new Date().toISOString();
    const next = {
      id: device.id,
      name: device.name,
      host: device.host,
      adbHost: device.adbHost,
      location: device.location,
      state,
      latencyMs: ping.latencyMs,
      lastCheckedAt: now,
      lastOnlineAt: ping.ok ? now : previous?.lastOnlineAt || null,
      lastOfflineAt: ping.ok ? previous?.lastOfflineAt || null : now,
      error: ping.error,
      alert: previous?.alert || null,
    };

    this.statuses.set(device.id, next);

    if (!previous || previous.state !== state) {
      await store.addEvent({
        type: "status-change",
        deviceId: device.id,
        deviceName: device.name,
        message: `${device.name} is ${state}`,
        severity: state === "online" ? "info" : "critical",
      });
      if (state === "offline") await this.sendOfflineAlert(device, next, previous);
    } else if (state === "offline") {
      await this.sendOfflineAlert(device, next, previous);
    }

    return next;
  }

  async sendOfflineAlert(device, status, previous) {
    const lastSentAt = previous?.alert?.lastSentAt ? Date.parse(previous.alert.lastSentAt) : 0;
    if (Date.now() - lastSentAt < config.alertCooldownMs) return;

    const subject = `[RISTV STB Monitor] ${device.name} is offline`;
    const text = [
      `${device.name} did not respond to ping.`,
      "",
      `Host: ${device.host}`,
      `ADB target: ${device.adbHost || "not configured"}`,
      `Location: ${device.location || "not set"}`,
      `Checked: ${status.lastCheckedAt}`,
      status.error ? `Ping error: ${status.error}` : "",
    ].filter(Boolean).join("\n");

    const result = await email.sendMail({ subject, text }).catch((error) => ({ ok: false, error: error.message }));
    const nextStatus = this.statuses.get(device.id) || status;
    nextStatus.alert = {
      lastSentAt: new Date().toISOString(),
      ok: result.ok,
      skipped: result.skipped || false,
      error: result.error || result.reason || "",
    };
    this.statuses.set(device.id, nextStatus);

    await store.addEvent({
      type: "alert",
      deviceId: device.id,
      deviceName: device.name,
      message: result.ok ? `Offline alert sent for ${device.name}` : `Offline alert not sent for ${device.name}: ${nextStatus.alert.error}`,
      severity: result.ok ? "warning" : "warning",
    });
  }
}

module.exports = new Monitor();
