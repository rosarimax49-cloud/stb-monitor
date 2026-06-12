const http = require("http");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const url = require("url");
const config = require("./config");
const store = require("./store");
const monitor = require("./monitor");
const adb = require("./adb");
const email = require("./email");

const publicDir = path.join(process.cwd(), "public");
const screenshotsDir = path.join(publicDir, "screenshots");

function sendJson(res, statusCode, value) {
  const body = JSON.stringify(value);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendText(res, statusCode, value) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(value);
}

async function streamDeviceScreen(req, res, device) {
  await store.addEvent({
    type: "adb",
    deviceId: device.id,
    deviceName: device.name,
    message: `Live stream started for ${device.name}`,
    severity: "info",
  });

  res.writeHead(200, {
    "Content-Type": "multipart/x-mixed-replace; boundary=ristvframe",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    "Connection": "close",
    "Pragma": "no-cache",
  });

  let active = true;
  req.on("close", () => {
    active = false;
  });

  while (active) {
    const frame = await adb.screenshot(device.adbHost);
    if (frame.ok && frame.stdout.length) {
      res.write(`--ristvframe\r\nContent-Type: image/png\r\nContent-Length: ${frame.stdout.length}\r\n\r\n`);
      res.write(frame.stdout);
      res.write("\r\n");
    } else {
      res.write(`--ristvframe\r\nContent-Type: text/plain\r\n\r\n${frame.error || frame.stderr || "No frame returned"}\r\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  try {
    res.end();
  } catch {
    // Client already closed the stream.
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function readBinaryBody(req, maxBytes = 500 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error("Uploaded APK is too large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function cleanFileName(value) {
  return path.basename(String(value || "app.apk")).replace(/[^A-Za-z0-9._-]/g, "_") || "app.apk";
}

function validPackageName(value) {
  const packageName = String(value || "").trim();
  return /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/.test(packageName) ? packageName : "";
}

function deviceView(device) {
  return {
    ...device,
    status: monitor.getStatus(device.id) || {
      id: device.id,
      name: device.name,
      host: device.host,
      adbHost: device.adbHost,
      location: device.location,
      state: device.enabled ? "unknown" : "disabled",
      latencyMs: null,
      lastCheckedAt: null,
      lastOnlineAt: null,
      lastOfflineAt: null,
      error: "",
    },
  };
}

async function handleApi(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true, time: new Date().toISOString() });
    return;
  }

  if (req.method === "GET" && pathname === "/api/devices") {
    const devices = await store.listDevices();
    sendJson(res, 200, { devices: devices.map(deviceView), intervalMs: config.monitorIntervalMs });
    return;
  }

  if (req.method === "DELETE" && pathname === "/api/devices") {
    await store.clearDevices();
    await store.addEvent({
      type: "devices",
      message: "All STBs deleted",
      severity: "warning",
    });
    sendJson(res, 200, { deleted: true });
    return;
  }

  if (req.method === "POST" && pathname === "/api/devices") {
    const body = await readBody(req);
    if (!body.name || !body.host) {
      sendJson(res, 400, { error: "Device name and host are required" });
      return;
    }
    const device = await store.upsertDevice(body);
    if (device.enabled) {
      monitor.checkDevice(device).catch((error) => {
        console.error(`Device check failed for ${device.id}:`, error);
      });
    }
    sendJson(res, 200, { device: deviceView(device) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/devices/import") {
    const body = await readBody(req);
    const devices = Array.isArray(body.devices) ? body.devices : [];
    const mode = body.mode === "replace" ? "replace" : "add";
    const validDevices = devices.filter((device) => device && device.name && device.host);
    if (!validDevices.length) {
      sendJson(res, 400, { error: "No valid STBs were found in the import file" });
      return;
    }
    const imported = await store.importDevices(validDevices, mode);
    await store.addEvent({
      type: "import",
      message: `${validDevices.length} STB${validDevices.length === 1 ? "" : "s"} imported (${mode})`,
      severity: "info",
    });
    sendJson(res, 200, { imported: validDevices.length, devices: imported.map(deviceView) });
    return;
  }

  const deviceMatch = pathname.match(/^\/api\/devices\/([^/]+)$/);
  if (deviceMatch && req.method === "DELETE") {
    const deleted = await store.deleteDevice(decodeURIComponent(deviceMatch[1]));
    sendJson(res, deleted ? 200 : 404, { deleted });
    return;
  }

  if (req.method === "POST" && pathname === "/api/check") {
    await monitor.checkAll();
    const devices = await store.listDevices();
    sendJson(res, 200, { devices: devices.map(deviceView) });
    return;
  }

  const liveStreamMatch = pathname.match(/^\/api\/devices\/([^/]+)\/adb\/live-stream$/);
  if (liveStreamMatch && req.method === "GET") {
    const id = decodeURIComponent(liveStreamMatch[1]);
    const devices = await store.listDevices();
    const device = devices.find((candidate) => candidate.id === id);
    if (!device) {
      sendJson(res, 404, { error: "Device not found" });
      return;
    }
    if (!device.adbHost) {
      sendJson(res, 400, { error: "ADB target is not configured for this device" });
      return;
    }
    await streamDeviceScreen(req, res, device);
    return;
  }

  if (req.method === "GET" && pathname === "/api/events") {
    sendJson(res, 200, { events: await store.listEvents(100) });
    return;
  }

  if (req.method === "DELETE" && pathname === "/api/events") {
    await store.clearEvents();
    sendJson(res, 200, { deleted: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/settings") {
    sendJson(res, 200, { settings: config.getSettings() });
    return;
  }

  if (req.method === "POST" && pathname === "/api/settings") {
    const body = await readBody(req);
    const previousPort = config.port;
    const settings = config.applySettings(body);
    await store.saveSettings(settings);
    await store.pruneEvents(settings.logRetentionDays);
    monitor.restart();
    await store.addEvent({
      type: "settings",
      message: "Settings updated",
      severity: "info",
    });
    sendJson(res, 200, {
      settings,
      note: settings.port === previousPort ? "Saved" : "Port changes require a server restart",
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/settings/test-email") {
    const result = await email.sendMail({
      subject: "[RISTV STB Monitor] Test email",
      text: `This is a test email from RISTV STB Monitor.\n\nSent: ${new Date().toISOString()}`,
    }).catch((error) => ({ ok: false, error: error.message }));
    await store.addEvent({
      type: "email-test",
      message: result.ok ? "Test email sent" : `Test email failed: ${result.error || result.reason || "unknown error"}`,
      severity: result.ok ? "info" : "warning",
    });
    sendJson(res, result.ok ? 200 : 500, { result });
    return;
  }

  const adbMatch = pathname.match(/^\/api\/devices\/([^/]+)\/adb\/([^/]+)$/);
  if (adbMatch && req.method === "POST") {
    const id = decodeURIComponent(adbMatch[1]);
    const action = decodeURIComponent(adbMatch[2]);
    const body = action === "install-app-file" ? {} : await readBody(req);
    const devices = await store.listDevices();
    const device = devices.find((candidate) => candidate.id === id);
    if (!device) {
      sendJson(res, 404, { error: "Device not found" });
      return;
    }
    if (!device.adbHost) {
      sendJson(res, 400, { error: "ADB target is not configured for this device" });
      return;
    }

    const commands = {
      connect: () => adb.connect(device.adbHost),
      disconnect: () => adb.disconnect(device.adbHost),
      reboot: () => adb.reboot(device.adbHost),
      props: () => adb.getProperties(device.adbHost),
      shell: () => adb.shell(device.adbHost, body.command || "uptime"),
    };

    if (action === "install-ristv") {
      const apkFile = config.ristvApkFile;
      if (!apkFile) {
        sendJson(res, 400, { error: "RISTV apk file is not configured in Settings" });
        return;
      }
      const result = await adb.installApk(device.adbHost, apkFile);
      result.apkFile = apkFile;
      result.apkFileName = path.basename(apkFile);
      if (result.ok) {
        await store.updateDevice(device.id, {
          ristvInstalledAt: new Date().toISOString(),
          ristvApkFileName: path.basename(apkFile),
        });
      }
      await store.addEvent({
        type: "adb",
        deviceId: device.id,
        deviceName: device.name,
        message: `RISTV install ${result.ok ? "completed" : "failed"} for ${device.name}`,
        severity: result.ok ? "info" : "warning",
      });
      sendJson(res, result.ok ? 200 : 500, { result });
      return;
    }

    if (action === "uninstall-ristv") {
      const packageName = config.packageName;
      if (!packageName) {
        sendJson(res, 400, { error: "Package Name is not configured in Settings" });
        return;
      }
      const result = await adb.uninstallPackage(device.adbHost, packageName);
      await store.addEvent({
        type: "adb",
        deviceId: device.id,
        deviceName: device.name,
        message: `RISTV uninstall ${result.ok ? "completed" : "failed"} for ${device.name}`,
        severity: result.ok ? "info" : "warning",
      });
      sendJson(res, result.ok ? 200 : 500, { result });
      return;
    }

    if (action === "list-apps") {
      const result = await adb.listInstalledApps(device.adbHost);
      await store.addEvent({
        type: "adb",
        deviceId: device.id,
        deviceName: device.name,
        message: `Installed apps listed for ${device.name}`,
        severity: result.ok ? "info" : "warning",
      });
      sendJson(res, result.ok ? 200 : 500, { result });
      return;
    }

    if (action === "app-memory") {
      const packageName = validPackageName(body.packageName);
      if (!packageName) {
        sendJson(res, 400, { error: "Valid package name is required" });
        return;
      }
      const result = await adb.getPackageMemory(device.adbHost, packageName);
      await store.addEvent({
        type: "adb",
        deviceId: device.id,
        deviceName: device.name,
        message: `Memory usage loaded for ${packageName} on ${device.name}`,
        severity: result.ok ? "info" : "warning",
      });
      sendJson(res, result.ok ? 200 : 500, { result });
      return;
    }

    if (action === "uninstall-app") {
      const packageName = validPackageName(body.packageName);
      if (!packageName) {
        sendJson(res, 400, { error: "Valid package name is required" });
        return;
      }
      const result = await adb.uninstallPackage(device.adbHost, packageName);
      await store.addEvent({
        type: "adb",
        deviceId: device.id,
        deviceName: device.name,
        message: `App uninstall ${result.ok ? "completed" : "failed"} for ${packageName} on ${device.name}`,
        severity: result.ok ? "info" : "warning",
      });
      sendJson(res, result.ok ? 200 : 500, { result });
      return;
    }

    if (action === "install-app-file") {
      const fileName = cleanFileName(req.headers["x-file-name"]);
      const apkBytes = await readBinaryBody(req);
      if (!apkBytes.length) {
        sendJson(res, 400, { error: "APK file is empty" });
        return;
      }
      const uploadDir = path.join(os.tmpdir(), "ristv-stb-monitor-uploads");
      await fs.mkdir(uploadDir, { recursive: true });
      const apkPath = path.join(uploadDir, `${Date.now()}-${fileName}`);
      await fs.writeFile(apkPath, apkBytes);
      const result = await adb.installApkOnDevice(device.adbHost, apkPath);
      result.apkFile = fileName;
      await fs.unlink(apkPath).catch(() => {});
      await store.addEvent({
        type: "adb",
        deviceId: device.id,
        deviceName: device.name,
        message: `App install ${result.ok ? "completed" : "failed"} for ${fileName} on ${device.name}`,
        severity: result.ok ? "info" : "warning",
      });
      sendJson(res, result.ok ? 200 : 500, { result });
      return;
    }

    if (action === "device-info") {
      const result = await adb.getDeviceInfo(device.adbHost);
      await store.addEvent({
        type: "adb",
        deviceId: device.id,
        deviceName: device.name,
        message: `STB info loaded for ${device.name}`,
        severity: result.ok ? "info" : "warning",
      });
      sendJson(res, result.ok ? 200 : 500, { result });
      return;
    }

    if (action === "keyevent") {
      const allowedKeys = new Set(["LEFT", "RIGHT", "BACK", "ENTER", "UP", "DOWN"]);
      const key = String(body.key || "").toUpperCase();
      if (!allowedKeys.has(key)) {
        sendJson(res, 400, { error: "Unsupported key event" });
        return;
      }
      const keyCodes = {
        LEFT: "KEYCODE_DPAD_LEFT",
        RIGHT: "KEYCODE_DPAD_RIGHT",
        BACK: "KEYCODE_BACK",
        ENTER: "KEYCODE_ENTER",
        UP: "KEYCODE_DPAD_UP",
        DOWN: "KEYCODE_DPAD_DOWN",
      };
      const result = await adb.keyEvent(device.adbHost, keyCodes[key]);
      sendJson(res, result.ok ? 200 : 500, { result });
      return;
    }

    if (action === "launcher-ristv") {
      const packageName = config.packageName;
      if (!packageName) {
        sendJson(res, 400, { error: "Package Name is not configured in Settings" });
        return;
      }
      const enabled = body.enabled === true;
      const result = enabled
        ? await adb.makeLauncher(device.adbHost, packageName)
        : await adb.clearLauncher(device.adbHost, packageName);
      if (result.ok) {
        await store.updateDevice(device.id, {
          ristvLauncherConfiguredAt: enabled ? new Date().toISOString() : "",
          ristvLauncherComponent: enabled ? result.component || "" : "",
        });
      }
      await store.addEvent({
        type: "adb",
        deviceId: device.id,
        deviceName: device.name,
        message: `RISTV launcher ${enabled ? "activation" : "deactivation"} ${result.ok ? "completed" : "failed"} for ${device.name}`,
        severity: result.ok ? "info" : "warning",
      });
      sendJson(res, result.ok ? 200 : 500, { result });
      return;
    }

    if (action === "screenshot") {
      const result = await adb.screenshot(device.adbHost);
      if (!result.ok || !result.stdout.length) {
        await store.addEvent({
          type: "adb",
          deviceId: device.id,
          deviceName: device.name,
          message: `ADB screenshot failed for ${device.name}`,
          severity: "warning",
        });
        sendJson(res, 500, { result: { ok: false, stderr: result.stderr, error: result.error || "No screenshot data returned" } });
        return;
      }
      await fs.mkdir(screenshotsDir, { recursive: true });
      const fileName = `${device.id}.png`;
      const filePath = path.join(screenshotsDir, fileName);
      await fs.writeFile(filePath, result.stdout);
      await store.addEvent({
        type: "adb",
        deviceId: device.id,
        deviceName: device.name,
        message: `Screenshot captured for ${device.name}`,
        severity: "info",
      });
      sendJson(res, 200, { result: { ok: true, url: `/screenshots/${fileName}?t=${Date.now()}` } });
      return;
    }

    if (!commands[action]) {
      sendJson(res, 404, { error: "Unknown ADB action" });
      return;
    }
    const result = await commands[action]();
    await store.addEvent({
      type: "adb",
      deviceId: device.id,
      deviceName: device.name,
      message: `ADB ${action} ${result.ok ? "completed" : "failed"} for ${device.name}`,
      severity: result.ok ? "info" : "warning",
    });
    sendJson(res, result.ok ? 200 : 500, { result });
    return;
  }

  sendJson(res, 404, { error: "API route not found" });
}

async function serveStatic(req, res, parsedUrl) {
  const requested = parsedUrl.pathname === "/" ? "/index.html" : parsedUrl.pathname;
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
    }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  } catch {
    sendText(res, 404, "Not found");
  }
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  try {
    if (parsedUrl.pathname.startsWith("/api/")) {
      await handleApi(req, res, parsedUrl);
    } else {
      await serveStatic(req, res, parsedUrl);
    }
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

async function start() {
  const storedSettings = await store.getSettings();
  config.applySettings(storedSettings);
  server.listen(config.port, () => {
  monitor.start();
  console.log(`RISTV STB Monitor running at http://localhost:${config.port}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
