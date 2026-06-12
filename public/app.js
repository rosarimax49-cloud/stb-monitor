const defaultListColumns = ["name", "ip", "location", "status", "lastChecked", "lastOnline", "functions"];

const state = {
  devices: [],
  events: [],
  intervalMs: 30000,
  selectedDeviceId: null,
  detailsDirty: false,
  screenshots: {},
  settings: null,
  viewMode: "card",
  filterQuery: "",
  statusFilter: "all",
  sort: {
    field: "name",
    direction: "asc",
  },
  listColumns: loadListColumns(),
  installDialogActive: false,
  installDialogFinished: false,
  installAbortController: null,
  installDialogOperation: "install",
  installedApps: [],
  installedAppsFilter: "",
  installedAppsDeviceId: null,
  selectedAppPackage: "",
  screenshotDeviceId: null,
};

const $ = (selector) => document.querySelector(selector);

const listColumnDefs = [
  { key: "id", label: "ID", sort: "id", value: (device) => escapeHtml(device.id) },
  { key: "name", label: "Name", sort: "name", value: (device) => `<strong>${escapeHtml(device.name)}</strong>` },
  { key: "ip", label: "IP", sort: "ip", value: (device) => escapeHtml(device.host) },
  { key: "adbHost", label: "ADB target", sort: "adbHost", value: (device) => escapeHtml(device.adbHost || "not set") },
  { key: "location", label: "Location", sort: "location", value: (device) => escapeHtml(device.location || "No location") },
  { key: "status", label: "Status", sort: "status", value: (device) => `<span class="status ${escapeHtml(device.status.state)}">${escapeHtml(device.status.state)}</span>` },
  { key: "latency", label: "Latency", sort: "latency", value: (device) => device.status.latencyMs === null ? "--" : `${device.status.latencyMs} ms` },
  { key: "lastChecked", label: "Last Checked", sort: "lastChecked", value: (device) => fmtTime(device.status.lastCheckedAt) },
  { key: "lastOnline", label: "Last Online", sort: "lastOnline", value: (device) => fmtTime(device.status.lastOnlineAt) },
  { key: "lastOffline", label: "Last Offline", sort: "lastOffline", value: (device) => fmtTime(device.status.lastOfflineAt) },
  { key: "notes", label: "Notes", sort: "notes", value: (device) => escapeHtml(device.notes || "") },
  { key: "enabled", label: "Enabled", sort: "enabled", value: (device) => device.enabled !== false ? "Yes" : "No" },
  { key: "ristvInstalledAt", label: "RISTV installed", sort: "ristvInstalledAt", value: (device) => fmtDateTime(device.ristvInstalledAt) },
  { key: "ristvApkFileName", label: "RISTV APK file", sort: "ristvApkFileName", value: (device) => renderListApkName(device) },
  { key: "ristvLauncherConfiguredAt", label: "Launcher configured", sort: "ristvLauncherConfiguredAt", value: (device) => fmtDateTime(device.ristvLauncherConfiguredAt) },
  { key: "ristvLauncherComponent", label: "Launcher component", sort: "ristvLauncherComponent", value: (device) => escapeHtml(device.ristvLauncherComponent || "") },
  { key: "functions", label: "Functions", value: (device) => `<button type="button" data-functions="${escapeHtml(device.id)}">Functions</button>` },
];

function loadListColumns() {
  try {
    const saved = JSON.parse(localStorage.getItem("ristvListColumns") || "[]");
    return Array.isArray(saved) && saved.length ? saved : defaultListColumns;
  } catch {
    return defaultListColumns;
  }
}

function saveListColumns() {
  localStorage.setItem("ristvListColumns", JSON.stringify(state.listColumns));
}

function appendInstallLog(message) {
  const log = $("#installLog");
  const time = new Date().toLocaleTimeString();
  log.textContent += `[${time}] ${message}\n`;
  log.scrollTop = log.scrollHeight;
}

function startInstallDialog(device, operation = "install") {
  const isUninstall = operation === "uninstall";
  const isLauncherActivate = operation === "launcher-activate";
  const isLauncherDeactivate = operation === "launcher-deactivate";
  const title = isUninstall
    ? "Uninstall RISTV"
    : isLauncherActivate
      ? "Activate RISTV Launcher"
      : isLauncherDeactivate
        ? "Deactivate RISTV Launcher"
        : "Install RISTV";
  state.installDialogActive = true;
  state.installDialogFinished = false;
  state.installDialogOperation = operation;
  $("#installTitle").textContent = `${title} - ${device?.name || "STB"}`;
  $("#installState").textContent = isUninstall
    ? "Uninstalling"
    : isLauncherActivate
      ? "Activating launcher"
      : isLauncherDeactivate
        ? "Deactivating launcher"
        : "Installing";
  $("#installHint").textContent = isUninstall
    ? "Please keep this window open while the configured Package Name is uninstalled."
    : isLauncherActivate
      ? "Please keep this window open while the configured Package Name is activated as launcher."
      : isLauncherDeactivate
        ? "Please keep this window open while the launcher assignment is removed."
        : "Please keep this window open while the APK from Settings is installed.";
  $("#installLog").textContent = "";
  $("#installSpinner").hidden = false;
  $("#closeInstallDialog").disabled = true;
  $("#cancelInstallDialog").disabled = false;
  appendInstallLog(`Target STB: ${device?.name || "Unknown"}`);
  appendInstallLog(`ADB target: ${device?.adbHost || "not configured"}`);
  appendInstallLog(isUninstall || isLauncherActivate || isLauncherDeactivate
    ? `Package Name configured in Settings: ${state.settings?.packageName || "not configured"}`
    : `APK configured in Settings: ${state.settings?.ristvApkFile || "not configured"}`);
  appendInstallLog(`Sending ${title.toLowerCase()} request to the monitor server...`);
  appendInstallLog(isUninstall
    ? "ADB uninstall is running."
    : isLauncherActivate
      ? "ADB launcher activation is running."
      : isLauncherDeactivate
        ? "ADB launcher deactivation is running."
        : "ADB install is running. This can take a while for larger APK files.");
  $("#installDialog").showModal();
}

function finishInstallDialog(ok) {
  const labels = {
    install: "Install",
    uninstall: "Uninstall",
    "launcher-activate": "Launcher activation",
    "launcher-deactivate": "Launcher deactivation",
  };
  const label = labels[state.installDialogOperation] || "Operation";
  state.installDialogActive = false;
  state.installDialogFinished = true;
  $("#installSpinner").hidden = true;
  $("#installState").textContent = ok ? `${label} finished` : `${label} finished with errors`;
  $("#installHint").textContent = "Review the log below. Press Close when you are ready.";
  $("#closeInstallDialog").disabled = false;
  $("#cancelInstallDialog").disabled = true;
  state.installAbortController = null;
}

function closeInstallDialog() {
  if (state.installDialogActive) return;
  if (state.installDialogFinished && !confirm("Close the verbose window?")) return;
  $("#installDialog").close();
}

function cancelInstallDialog() {
  if (!state.installDialogActive) return;
  if (!confirm("Cancel waiting for this operation to finish? The ADB command may still continue on the server/STB.")) return;
  state.installAbortController?.abort();
  appendInstallLog("User cancelled waiting for the operation result.");
  finishInstallDialog(false);
}

function fmtTime(value) {
  if (!value) return "--";
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function fmtDateTime(value) {
  if (!value) return "--";
  return new Date(value).toLocaleString();
}

function fileNameFromPath(value) {
  return String(value || "").split(/[\\/]/).filter(Boolean).at(-1) || "";
}

function isDeviceApkOutdated(device) {
  const settingsApkFileName = fileNameFromPath(state.settings?.ristvApkFile);
  const installedApkFileName = device.ristvApkFileName || "";
  return Boolean(installedApkFileName && settingsApkFileName && installedApkFileName !== settingsApkFileName);
}

function renderListApkName(device) {
  const apkName = device.ristvApkFileName || "";
  if (!apkName) return "";
  return isDeviceApkOutdated(device)
    ? `<span class="apk-outdated" title="APK not Up to Date!">${escapeHtml(apkName)}</span>`
    : escapeHtml(apkName);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const json = await response.json();
  if (!response.ok) {
    const message = json.error || json.result?.stderr || json.result?.error || "Request failed";
    const error = new Error(message);
    error.payload = json;
    throw error;
  }
  return json;
}

async function loadDevices() {
  const json = await api("/api/devices");
  state.devices = json.devices;
  if (state.selectedDeviceId && !state.devices.some((device) => device.id === state.selectedDeviceId)) {
    state.selectedDeviceId = null;
    state.detailsDirty = false;
  }
  state.intervalMs = json.intervalMs;
  render();
}

async function loadEvents() {
  const json = await api("/api/events");
  state.events = json.events;
  renderEvents();
}

async function loadSettings() {
  const json = await api("/api/settings");
  state.settings = json.settings;
  applyAppTitle();
  fillSettingsForm();
  if (state.devices.length) render();
}

async function refreshNow() {
  $("#refreshBtn").disabled = true;
  const refreshingDialog = $("#refreshingDialog");
  if (!refreshingDialog.open) refreshingDialog.showModal();
  try {
    const json = await api("/api/check", { method: "POST", body: "{}" });
    state.devices = json.devices;
    render();
    await loadEvents();
  } finally {
    if (refreshingDialog.open) refreshingDialog.close();
    $("#refreshBtn").disabled = false;
  }
}

async function runAdb(id, action, command) {
  const button = document.querySelector(`[data-adb="${id}:${action}"]`);
  const output = document.querySelector(`[data-output="${id}"]`);
  if (button) button.disabled = true;
  if (output) output.textContent = "Running...";
  try {
    const json = await api(`/api/devices/${encodeURIComponent(id)}/adb/${action}`, {
      method: "POST",
      body: JSON.stringify({ command }),
    });
    const result = json.result;
    if (output) output.textContent = [result.stdout, result.stderr, result.error].filter(Boolean).join("\n") || "Done";
    await loadEvents();
  } catch (error) {
    if (output) output.textContent = error.message;
  } finally {
    if (button) button.disabled = false;
  }
}

async function captureScreenshot(id) {
  const button = document.querySelector(`[data-screenshot="${id}"]`);
  const output = document.querySelector(`[data-output="${id}"]`);
  if (button) button.disabled = true;
  if (output) output.textContent = "Capturing screenshot...";
  try {
    const json = await api(`/api/devices/${encodeURIComponent(id)}/adb/screenshot`, {
      method: "POST",
      body: "{}",
    });
    state.screenshots[id] = json.result.url;
    if (output) output.textContent = "Screenshot captured.";
    render();
    await loadEvents();
  } catch (error) {
    if (output) output.textContent = `Screenshot failed: ${error.message}`;
  } finally {
    if (button) button.disabled = false;
  }
}

async function installRistv(id) {
  const device = state.devices.find((candidate) => candidate.id === id);
  if (!state.settings) await loadSettings();
  const name = device?.name || "this STB";
  const apkFile = state.settings?.ristvApkFile || "the APK configured in Settings";
  if (!confirm(`Install RISTV on ${name}?\n\nAPK file:\n${apkFile}`)) return;

  const button = document.querySelector(`[data-install-ristv="${id}"]`);
  const output = document.querySelector(`[data-output="${id}"]`);
  if (button) button.disabled = true;
  if (output) output.textContent = "Installing RISTV...";
  startInstallDialog(device);
  const controller = new AbortController();
  state.installAbortController = controller;
  try {
    appendInstallLog("Step 1/2: Installing APK with ADB...");
    const json = await api(`/api/devices/${encodeURIComponent(id)}/adb/install-ristv`, {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    });
    const result = json.result;
    if (result.command) appendInstallLog(`Command issued: ${result.command}`);
    appendInstallLog(`APK being installed: ${result.apkFile || state.settings?.ristvApkFile || "--"}`);
    if (result.stdout) appendInstallLog(`STDOUT:\n${result.stdout}`);
    if (result.stderr) appendInstallLog(`STDERR:\n${result.stderr}`);
    if (result.timedOut) appendInstallLog(`TIMEOUT: ADB install exceeded ${Math.round((result.timeoutMs || 0) / 1000)} seconds.`);
    if (result.error) appendInstallLog(`ERROR:\n${result.error}`);
    appendInstallLog(result.ok ? "Step 2/2: APK install completed." : "Step 2/2: APK install reported an error.");
    if (output) output.textContent = [result.stdout, result.stderr, result.error].filter(Boolean).join("\n") || "RISTV installed.";
    await loadDevices();
    await loadEvents();
    finishInstallDialog(result.ok !== false);
  } catch (error) {
    if (error.name === "AbortError") {
      if (output) output.textContent = "Install wait cancelled.";
      return;
    }
    const result = error.payload?.result;
    if (result?.command) appendInstallLog(`Command issued: ${result.command}`);
    if (result?.apkFile) appendInstallLog(`APK being installed: ${result.apkFile}`);
    if (result?.stdout) appendInstallLog(`STDOUT:\n${result.stdout}`);
    if (result?.stderr) appendInstallLog(`STDERR:\n${result.stderr}`);
    if (result?.timedOut) appendInstallLog(`TIMEOUT: ADB install exceeded ${Math.round((result.timeoutMs || 0) / 1000)} seconds.`);
    if (result?.error) appendInstallLog(`ERROR:\n${result.error}`);
    appendInstallLog(`INSTALL FAILED:\n${error.message}`);
    if (output) output.textContent = [result?.stdout, result?.stderr, result?.error, error.message].filter(Boolean).join("\n") || `Install failed: ${error.message}`;
    finishInstallDialog(false);
  } finally {
    if (button) button.disabled = false;
  }
}

async function uninstallRistv(id) {
  const device = state.devices.find((candidate) => candidate.id === id);
  const name = device?.name || "this STB";
  if (!confirm(`Uninstall RISTV from ${name}?\n\nThis removes the app configured by Package Name in Settings.`)) return;

  const button = document.querySelector(`[data-uninstall-ristv="${id}"]`);
  const output = document.querySelector(`[data-output="${id}"]`);
  if (button) button.disabled = true;
  if (output) output.textContent = "Uninstalling RISTV...";
  if (!state.settings) await loadSettings();
  startInstallDialog(device, "uninstall");
  const controller = new AbortController();
  state.installAbortController = controller;
  try {
    appendInstallLog("Step 1/1: Uninstalling Package Name with ADB...");
    const json = await api(`/api/devices/${encodeURIComponent(id)}/adb/uninstall-ristv`, {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    });
    const result = json.result;
    appendInstallLog(`Package being uninstalled: ${state.settings?.packageName || "--"}`);
    if (result.stdout) appendInstallLog(`STDOUT:\n${result.stdout}`);
    if (result.stderr) appendInstallLog(`STDERR:\n${result.stderr}`);
    if (result.error) appendInstallLog(`ERROR:\n${result.error}`);
    appendInstallLog(result.ok ? "Uninstall completed." : "Uninstall reported an error.");
    if (output) output.textContent = [result.stdout, result.stderr, result.error].filter(Boolean).join("\n") || "RISTV uninstalled.";
    await loadEvents();
    finishInstallDialog(result.ok !== false);
  } catch (error) {
    if (error.name === "AbortError") {
      if (output) output.textContent = "Uninstall wait cancelled.";
      return;
    }
    appendInstallLog(`UNINSTALL FAILED:\n${error.message}`);
    if (output) output.textContent = `Uninstall failed: ${error.message}`;
    finishInstallDialog(false);
  } finally {
    if (button) button.disabled = false;
  }
}

function renderInstalledApps() {
  const wrap = $("#appsTable");
  const query = state.installedAppsFilter.trim().toLowerCase();
  const packageName = String(state.settings?.packageName || "").trim().toLowerCase();
  const apps = state.installedApps.filter((app) => {
    if (!query) return true;
    return [app.packageName, app.apkPath].some((field) => String(field || "").toLowerCase().includes(query));
  });
  if (!state.installedApps.length) {
    wrap.innerHTML = '<p class="empty">No installed apps were returned by ADB.</p>';
    return;
  }
  if (!apps.length) {
    wrap.innerHTML = '<p class="empty">No installed apps match the current filter.</p>';
    return;
  }
  wrap.innerHTML = `
    <table class="apps-table">
      <thead>
        <tr>
          <th>Package Name</th>
          <th>APK Path</th>
        </tr>
      </thead>
      <tbody>
        ${apps.map((app) => {
          const isConfiguredPackage = packageName && app.packageName.toLowerCase() === packageName;
          return `
          <tr class="${isConfiguredPackage ? "configured-package" : ""}">
            <td>
              <button class="app-package-button" type="button" data-app-package="${escapeHtml(app.packageName)}">
                ${isConfiguredPackage ? `<strong>${escapeHtml(app.packageName)}</strong>` : escapeHtml(app.packageName)}
              </button>
            </td>
            <td>${escapeHtml(app.apkPath || "--")}</td>
          </tr>
        `;
        }).join("")}
      </tbody>
    </table>
  `;
}

async function showInstalledApps(id) {
  const device = state.devices.find((candidate) => candidate.id === id);
  const button = document.querySelector(`[data-show-apps="${id}"]`);
  const output = document.querySelector(`[data-output="${id}"]`);
  if (!state.settings) await loadSettings();
  state.installedApps = [];
  state.installedAppsFilter = "";
  state.installedAppsDeviceId = id;
  state.selectedAppPackage = "";
  $("#appsTitle").textContent = `${device?.name || "STB"} installed apps`;
  $("#appsMessage").textContent = "Loading installed apps from ADB...";
  $("#appsFilter").value = "";
  $("#appsInstallFile").value = "";
  $("#appsTable").innerHTML = '<p class="empty">Please wait...</p>';
  if (!$("#appsDialog").open) $("#appsDialog").showModal();
  if (button) button.disabled = true;
  if (output) output.textContent = "Loading installed apps...";
  try {
    const json = await api(`/api/devices/${encodeURIComponent(id)}/adb/list-apps`, {
      method: "POST",
      body: "{}",
    });
    const apps = json.result.apps || [];
    state.installedApps = apps;
    const configuredFound = apps.some((app) => app.packageName.toLowerCase() === String(state.settings?.packageName || "").trim().toLowerCase());
    $("#appsMessage").textContent = `${apps.length} installed app${apps.length === 1 ? "" : "s"} found.${state.settings?.packageName ? ` Package Name ${configuredFound ? "found" : "not found"}: ${state.settings.packageName}` : ""}`;
    renderInstalledApps();
    if (output) output.textContent = `Found ${apps.length} installed app${apps.length === 1 ? "" : "s"}.`;
    await loadEvents();
  } catch (error) {
    $("#appsMessage").textContent = `Failed to load installed apps: ${error.message}`;
    $("#appsTable").innerHTML = "";
    if (output) output.textContent = `Show installed apps failed: ${error.message}`;
  } finally {
    if (button) button.disabled = false;
  }
}

function openAppActions(packageName) {
  state.selectedAppPackage = packageName;
  $("#appActionsTitle").textContent = packageName;
  $("#appActionsMessage").textContent = "Choose an action for this installed app.";
  $("#appActionsOutput").textContent = "";
  $("#appActionsDialog").showModal();
}

async function showSelectedAppMemory() {
  const packageName = state.selectedAppPackage;
  const deviceId = state.installedAppsDeviceId;
  if (!packageName || !deviceId) return;
  $("#appActionsMessage").textContent = "Loading memory usage from ADB...";
  $("#appActionsOutput").textContent = "";
  try {
    const json = await api(`/api/devices/${encodeURIComponent(deviceId)}/adb/app-memory`, {
      method: "POST",
      body: JSON.stringify({ packageName }),
    });
    $("#appActionsMessage").textContent = "Memory usage loaded.";
    $("#appActionsOutput").textContent = [json.result.stdout, json.result.stderr, json.result.error].filter(Boolean).join("\n") || "No memory information returned.";
    await loadEvents();
  } catch (error) {
    $("#appActionsMessage").textContent = `Memory check failed: ${error.message}`;
    $("#appActionsOutput").textContent = error.payload?.result?.stdout || error.payload?.result?.stderr || error.payload?.result?.error || "";
  }
}

async function uninstallSelectedApp() {
  const packageName = state.selectedAppPackage;
  const deviceId = state.installedAppsDeviceId;
  if (!packageName || !deviceId) return;
  if (!confirm(`Uninstall ${packageName} from this STB?`)) return;
  $("#appActionsMessage").textContent = "Uninstalling app via ADB...";
  $("#appActionsOutput").textContent = "";
  try {
    const json = await api(`/api/devices/${encodeURIComponent(deviceId)}/adb/uninstall-app`, {
      method: "POST",
      body: JSON.stringify({ packageName }),
    });
    $("#appActionsMessage").textContent = json.result.ok ? "App uninstalled." : "Uninstall finished with errors.";
    $("#appActionsOutput").textContent = [json.result.stdout, json.result.stderr, json.result.error].filter(Boolean).join("\n") || "Uninstall completed.";
    state.installedApps = state.installedApps.filter((app) => app.packageName !== packageName);
    renderInstalledApps();
    await loadEvents();
  } catch (error) {
    $("#appActionsMessage").textContent = `Uninstall failed: ${error.message}`;
    $("#appActionsOutput").textContent = error.payload?.result?.stdout || error.payload?.result?.stderr || error.payload?.result?.error || "";
  }
}

async function installSelectedAppFile() {
  const deviceId = state.installedAppsDeviceId;
  const file = $("#appsInstallFile").files[0];
  if (!deviceId || !file) {
    $("#appsMessage").textContent = "Please select an APK file first.";
    return;
  }
  if (!confirm(`Install ${file.name} on this STB?`)) return;
  $("#appsInstallBtn").disabled = true;
  $("#appsMessage").textContent = `Installing ${file.name} via ADB...`;
  try {
    const response = await fetch(`/api/devices/${encodeURIComponent(deviceId)}/adb/install-app-file`, {
      method: "POST",
      headers: { "X-File-Name": file.name },
      body: file,
    });
    const json = await response.json();
    if (!response.ok) {
      const error = new Error(json.error || json.result?.stderr || json.result?.error || "Install failed");
      error.payload = json;
      throw error;
    }
    $("#appsMessage").textContent = `${file.name} installed. Reloading installed apps...`;
    await showInstalledApps(deviceId);
  } catch (error) {
    const result = error.payload?.result;
    $("#appsMessage").textContent = `Install failed: ${error.message}`;
    if (result) {
      $("#appsTable").insertAdjacentHTML("afterbegin", `<pre class="install-log">${escapeHtml([result.stdout, result.stderr, result.error].filter(Boolean).join("\n"))}</pre>`);
    }
  } finally {
    $("#appsInstallBtn").disabled = false;
    await loadEvents();
  }
}

function parseInfoSections(output = "") {
  const sections = [];
  let current = null;
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.match(/^===\s*(.+?)\s*===$/);
    if (match) {
      current = { title: match[1], lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return sections.length ? sections : [{ title: "Output", lines: String(output || "").split(/\r?\n/) }];
}

function renderStbInfo(output = "") {
  $("#stbInfoContent").innerHTML = parseInfoSections(output).map((section) => `
    <section class="stb-info-section">
      <h3>${escapeHtml(section.title)}</h3>
      <pre>${escapeHtml(section.lines.join("\n").trim() || "--")}</pre>
    </section>
  `).join("");
}

async function showStbInfo(id) {
  const device = state.devices.find((candidate) => candidate.id === id);
  const button = document.querySelector(`[data-stb-info="${id}"]`);
  const output = document.querySelector(`[data-output="${id}"]`);
  $("#stbInfoTitle").textContent = `${device?.name || "STB"} info`;
  $("#stbInfoMessage").textContent = "Loading STB information from ADB...";
  $("#stbInfoContent").innerHTML = '<p class="empty">Please wait...</p>';
  $("#stbInfoDialog").showModal();
  if (button) button.disabled = true;
  if (output) output.textContent = "Loading STB information...";
  try {
    const json = await api(`/api/devices/${encodeURIComponent(id)}/adb/device-info`, {
      method: "POST",
      body: "{}",
    });
    $("#stbInfoMessage").textContent = "STB information loaded.";
    renderStbInfo(json.result.stdout || "");
    if (output) output.textContent = "STB information loaded.";
    await loadEvents();
  } catch (error) {
    $("#stbInfoMessage").textContent = `Failed to load STB information: ${error.message}`;
    $("#stbInfoContent").innerHTML = "";
    if (output) output.textContent = `STB info failed: ${error.message}`;
  } finally {
    if (button) button.disabled = false;
  }
}

async function toggleRistvLauncher(id, enabled) {
  const device = state.devices.find((candidate) => candidate.id === id);
  const checkbox = document.querySelector(`[data-launcher-toggle="${id}"]`);
  const output = document.querySelector(`[data-output="${id}"]`);
  if (checkbox) checkbox.disabled = true;
  if (output) output.textContent = enabled ? "Activating RISTV as launcher..." : "Deactivating RISTV as launcher...";
  if (!state.settings) await loadSettings();
  startInstallDialog(device, enabled ? "launcher-activate" : "launcher-deactivate");
  const controller = new AbortController();
  state.installAbortController = controller;
  try {
    appendInstallLog(enabled
      ? "Step 1/1: Activating configured Package Name as launcher..."
      : "Step 1/1: Deactivating configured Package Name as launcher...");
    const json = await api(`/api/devices/${encodeURIComponent(id)}/adb/launcher-ristv`, {
      method: "POST",
      body: JSON.stringify({ enabled }),
      signal: controller.signal,
    });
    const result = json.result;
    appendInstallLog(`Package Name: ${state.settings?.packageName || "--"}`);
    if (result.component) appendInstallLog(`Launcher component: ${result.component}`);
    if (result.stdout) appendInstallLog(`STDOUT:\n${result.stdout}`);
    if (result.stderr) appendInstallLog(`STDERR:\n${result.stderr}`);
    if (result.error) appendInstallLog(`ERROR:\n${result.error}`);
    appendInstallLog(result.ok ? "Launcher operation completed." : "Launcher operation reported an error.");
    if (output) output.textContent = [
      enabled ? "Launcher activated." : "Launcher deactivated.",
      result.component ? `Component: ${result.component}` : "",
      result.stdout,
      result.stderr,
      result.error,
    ].filter(Boolean).join("\n");
    await loadDevices();
    await loadEvents();
    finishInstallDialog(result.ok !== false);
  } catch (error) {
    if (error.name === "AbortError") {
      if (output) output.textContent = "Launcher wait cancelled.";
      return;
    }
    const result = error.payload?.result;
    appendInstallLog(`Package Name: ${state.settings?.packageName || "--"}`);
    if (result?.component) appendInstallLog(`Launcher component: ${result.component}`);
    if (result?.stdout) appendInstallLog(`STDOUT:\n${result.stdout}`);
    if (result?.stderr) appendInstallLog(`STDERR:\n${result.stderr}`);
    if (result?.error) appendInstallLog(`ERROR:\n${result.error}`);
    appendInstallLog(`LAUNCHER UPDATE FAILED:\n${error.message}`);
    if (output) output.textContent = `Launcher update failed: ${error.message}`;
    if (checkbox) checkbox.checked = !enabled;
    finishInstallDialog(false);
  } finally {
    if (checkbox) checkbox.disabled = false;
  }
}

function renderSummary() {
  const total = state.devices.length;
  const online = state.devices.filter((device) => device.status.state === "online").length;
  const offline = state.devices.filter((device) => device.status.state === "offline").length;
  const latencies = state.devices.map((device) => device.status.latencyMs).filter((value) => Number.isFinite(value));
  const avg = latencies.length ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length) : null;
  $("#totalCount").textContent = total;
  $("#onlineCount").textContent = online;
  $("#offlineCount").textContent = offline;
  $("#avgLatency").textContent = avg === null ? "--" : `${avg} ms`;
}

function renderDevices() {
  const grid = $("#deviceGrid");
  const visibleDevices = filteredDevices();
  if (!state.devices.length) {
    grid.innerHTML = '<p class="empty">No STBs have been added yet.</p>';
    renderDetails();
    return;
  }

  grid.className = state.viewMode === "list"
    ? "device-grid device-list"
    : state.viewMode === "grid"
      ? "device-grid device-cube-grid"
      : "device-grid";
  $("#listColumnsBtn").hidden = state.viewMode !== "list";
  renderViewModeButtons();

  if (!visibleDevices.length) {
    grid.innerHTML = '<p class="empty">No STBs match the current filters.</p>';
    renderDetails();
    return;
  }

  if (state.viewMode === "list") {
    renderDeviceList(grid, visibleDevices);
  } else if (state.viewMode === "grid") {
    renderDeviceCubeGrid(grid, visibleDevices);
  } else {
    renderDeviceCards(grid, visibleDevices);
  }
  renderDetails();
}

function renderViewModeButtons() {
  document.querySelectorAll("[data-view-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.viewMode === state.viewMode);
  });
}

function filteredDevices() {
  const query = state.filterQuery.trim().toLowerCase();
  return state.devices.filter((device) => {
    if (state.statusFilter !== "all" && device.status?.state !== state.statusFilter) return false;
    if (!query) return true;
    const fields = [
      device.name,
      device.host,
      device.adbHost,
      device.location,
      device.notes,
      device.status?.state,
    ];
    return fields.some((field) => String(field || "").toLowerCase().includes(query));
  });
}

function renderStatusFilters() {
  document.querySelectorAll("[data-status-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.statusFilter === state.statusFilter);
  });
}

function sortedDevices(devices = filteredDevices()) {
  const statusRank = { offline: 0, unknown: 1, disabled: 2, online: 3 };
  const valueFor = (device) => {
    if (state.sort.field === "status") return statusRank[device.status.state] ?? 9;
    if (state.sort.field === "ip") return device.host || "";
    if (state.sort.field === "adbHost") return device.adbHost || "";
    if (state.sort.field === "enabled") return device.enabled !== false ? 1 : 0;
    if (state.sort.field === "latency") return device.status.latencyMs ?? Number.MAX_SAFE_INTEGER;
    if (state.sort.field === "lastChecked") return Date.parse(device.status.lastCheckedAt || "") || 0;
    if (state.sort.field === "lastOnline") return Date.parse(device.status.lastOnlineAt || "") || 0;
    if (state.sort.field === "lastOffline") return Date.parse(device.status.lastOfflineAt || "") || 0;
    if (state.sort.field === "ristvInstalledAt") return Date.parse(device.ristvInstalledAt || "") || 0;
    if (state.sort.field === "ristvLauncherConfiguredAt") return Date.parse(device.ristvLauncherConfiguredAt || "") || 0;
    return device[state.sort.field] || "";
  };
  return [...devices].sort((a, b) => {
    const aValue = valueFor(a);
    const bValue = valueFor(b);
    const result = typeof aValue === "number"
      ? aValue - bValue
      : String(aValue).localeCompare(String(bValue), undefined, { numeric: true, sensitivity: "base" });
    return state.sort.direction === "asc" ? result : -result;
  });
}

function sortLabel(field) {
  if (state.sort.field !== field) return "";
  return state.sort.direction === "asc" ? " ^" : " v";
}

function deviceCardHtml(device, { selected = device.id === state.selectedDeviceId } = {}) {
  const status = device.status;
  const stateClass = escapeHtml(status.state);
  const selectedClass = selected ? " selected" : "";
  const screenshotUrl = state.screenshots[device.id];
  const isOldApk = isDeviceApkOutdated(device);
  const installInfo = device.ristvInstalledAt || device.ristvApkFileName
    ? `
        <div class="install-info">
          <span>RISTV installed</span>
          <strong>${escapeHtml(fmtDateTime(device.ristvInstalledAt))}</strong>
          <span>APK file</span>
          <strong>${escapeHtml(device.ristvApkFileName || "--")} ${isOldApk ? '<em class="apk-warning">Not latest APK!</em>' : ""}</strong>
          <span>Launcher</span>
          <strong>${escapeHtml(device.ristvLauncherConfiguredAt ? `Configured ${fmtDateTime(device.ristvLauncherConfiguredAt)}` : "Not configured")}</strong>
          ${device.ristvLauncherComponent ? `<span>Component</span><strong>${escapeHtml(device.ristvLauncherComponent)}</strong>` : ""}
        </div>
      `
    : "";
  return `
    <article class="device-card${selectedClass}" data-device="${escapeHtml(device.id)}" tabindex="0">
      <div class="device-top">
        <div>
          <div class="device-name">${escapeHtml(device.name)}</div>
          <div class="meta">${escapeHtml(device.location || "No location")}</div>
        </div>
        <span class="status ${stateClass}">${escapeHtml(status.state)}</span>
      </div>
      <div class="meta">
        Host: ${escapeHtml(device.host)}<br>
        ADB: ${escapeHtml(device.adbHost || "not set")}<br>
        Latency: ${status.latencyMs === null ? "--" : `${status.latencyMs} ms`}<br>
        Checked: ${fmtTime(status.lastCheckedAt)}<br>
        ${status.alert ? `Alert: ${status.alert.ok ? "sent" : "not sent"} ${escapeHtml(status.alert.error || "")}` : ""}
      </div>
      ${installInfo}
      <label class="launcher-toggle">
        <span>Use installed app as launcher</span>
        <input type="checkbox" data-launcher-toggle="${escapeHtml(device.id)}" ${device.ristvLauncherConfiguredAt ? "checked" : ""}>
      </label>
      ${device.notes ? `<p class="meta">${escapeHtml(device.notes)}</p>` : ""}
      <div class="screenshot-box">
        ${screenshotUrl
          ? `<button class="screenshot-thumb" type="button" data-screenshot-view="${escapeHtml(device.id)}" title="Open screenshot">
              <img src="${escapeHtml(screenshotUrl)}" alt="${escapeHtml(device.name)} screenshot">
            </button>`
          : '<span>No screenshot captured</span>'}
      </div>
      <div class="device-actions">
        <button data-adb="${device.id}:connect">Connect</button>
        <button data-screenshot="${device.id}">Screenshot</button>
        <button data-live-stream="${device.id}">Live Streaming</button>
        <button data-stb-info="${device.id}">STB Info</button>
        <button data-show-apps="${device.id}">Show Installed Apps</button>
        <button data-install-ristv="${device.id}">Install RISTV</button>
        <button data-uninstall-ristv="${device.id}">Uninstall RISTV</button>
        <button data-adb="${device.id}:props">Props</button>
        <button data-adb="${device.id}:reboot">Reboot</button>
        <button data-delete="${device.id}">Delete</button>
      </div>
      <pre class="output" data-output="${device.id}"></pre>
    </article>
  `;
}

function renderDeviceCards(grid, devices) {
  grid.innerHTML = sortedDevices(devices).map((device) => deviceCardHtml(device)).join("");
}

function cubeStatusClass(device) {
  if (device.enabled === false || device.status.state === "disabled") return "disabled";
  if (device.status.state === "online") return "online";
  return "offline";
}

function cubeTooltip(device) {
  return [
    `Name: ${device.name || "--"}`,
    `IP: ${device.host || "--"}`,
    `RISTV installed: ${fmtDateTime(device.ristvInstalledAt)}`,
    `APK file: ${device.ristvApkFileName || "--"}`,
    `Launcher: ${device.ristvLauncherConfiguredAt ? `Configured ${fmtDateTime(device.ristvLauncherConfiguredAt)}` : "Not configured"}`,
    device.ristvLauncherComponent ? `Launcher component: ${device.ristvLauncherComponent}` : "",
    `Last online: ${fmtTime(device.status.lastOnlineAt)}`,
  ].filter(Boolean).join("\n");
}

function renderDeviceCubeGrid(grid, devices) {
  grid.innerHTML = sortedDevices(devices).map((device) => `
    <button class="device-cube ${cubeStatusClass(device)}" type="button" data-functions="${escapeHtml(device.id)}" title="${escapeHtml(cubeTooltip(device))}">
      <span>${escapeHtml(device.location || "No location")}</span>
    </button>
  `).join("");
}

function renderDeviceList(grid, devices) {
  const columns = listColumnDefs.filter((column) => state.listColumns.includes(column.key));
  grid.innerHTML = `
    <table class="device-table">
      <thead>
        <tr>
          ${columns.map((column) => `
            <th>${column.sort
              ? `<button type="button" data-sort="${escapeHtml(column.sort)}">${escapeHtml(column.label)}${sortLabel(column.sort)}</button>`
              : escapeHtml(column.label)}
            </th>
          `).join("")}
        </tr>
      </thead>
      <tbody>
        ${sortedDevices(devices).map((device) => {
          const selectedClass = device.id === state.selectedDeviceId ? " selected" : "";
          return `
            <tr class="device-row${selectedClass}" data-device="${escapeHtml(device.id)}" tabindex="0">
              ${columns.map((column) => `<td>${column.value(device)}</td>`).join("")}
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;
}

function renderListColumnsDialog() {
  $("#listColumnsForm").innerHTML = listColumnDefs.map((column) => `
    <label>
      <span>${escapeHtml(column.label)}</span>
      <input type="checkbox" data-list-column="${escapeHtml(column.key)}" ${state.listColumns.includes(column.key) ? "checked" : ""}>
    </label>
  `).join("");
}

function openListColumnsDialog() {
  renderListColumnsDialog();
  $("#listColumnsDialog").showModal();
}

function setDetailsDisabled(disabled) {
  const form = $("#detailsForm");
  form.setAttribute("aria-disabled", String(disabled));
  form.querySelectorAll("input, textarea, button").forEach((field) => {
    field.disabled = disabled;
  });
}

function selectedDevice() {
  return state.devices.find((device) => device.id === state.selectedDeviceId) || null;
}

function renderDetailStatus(status) {
  $("#detailState").textContent = status.state || "--";
  $("#detailLatency").textContent = status.latencyMs === null ? "--" : `${status.latencyMs} ms`;
  $("#detailChecked").textContent = fmtTime(status.lastCheckedAt);
  $("#detailOnline").textContent = fmtTime(status.lastOnlineAt);
}

function renderDetails() {
  const device = selectedDevice();
  const form = $("#detailsForm");
  const message = $("#detailsMessage");

  if (!device) {
    form.reset();
    form.elements.id.value = "";
    $("#detailsStatus").textContent = "Select an STB";
    renderDetailStatus({ state: "--", latencyMs: null, lastCheckedAt: null, lastOnlineAt: null });
    message.textContent = "Click an STB card to view and edit its details.";
    setDetailsDisabled(true);
    return;
  }

  const status = device.status;
  if (state.detailsDirty && form.elements.id.value === device.id) {
    $("#detailsStatus").textContent = `${device.name} - editing`;
    renderDetailStatus(status);
    return;
  }

  setDetailsDisabled(false);
  form.elements.id.value = device.id;
  form.elements.name.value = device.name || "";
  form.elements.host.value = device.host || "";
  form.elements.adbHost.value = device.adbHost || "";
  form.elements.location.value = device.location || "";
  form.elements.notes.value = device.notes || "";
  form.elements.enabled.checked = device.enabled !== false;
  $("#detailsStatus").textContent = device.name;
  renderDetailStatus(status);
  message.textContent = "";
}

function renderEvents() {
  const list = $("#eventList");
  if (!state.events.length) {
    list.innerHTML = '<p class="empty">No events yet.</p>';
    return;
  }
  list.innerHTML = state.events.map((event) => `
    <div class="event">
      <strong>${escapeHtml(event.message)}</strong>
      <span>${fmtTime(event.at)} - ${escapeHtml(event.severity || "info")}</span>
    </div>
  `).join("");
}

function renderAllEventsTable() {
  const wrap = $("#allEventsTable");
  if (!state.events.length) {
    wrap.innerHTML = '<p class="empty">No events yet.</p>';
    return;
  }
  wrap.innerHTML = `
    <table class="events-table">
      <thead>
        <tr>
          <th>Time</th>
          <th>Severity</th>
          <th>Type</th>
          <th>Device</th>
          <th>Message</th>
        </tr>
      </thead>
      <tbody>
        ${state.events.map((event) => `
          <tr>
            <td>${escapeHtml(event.at ? new Date(event.at).toLocaleString() : "--")}</td>
            <td>${escapeHtml(event.severity || "info")}</td>
            <td>${escapeHtml(event.type || "--")}</td>
            <td>${escapeHtml(event.deviceName || event.deviceId || "--")}</td>
            <td class="event-message">${escapeHtml(event.message || "")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

async function showAllEvents() {
  await loadEvents();
  renderAllEventsTable();
  $("#allEventsDialog").showModal();
}

async function deleteAllEvents() {
  if (!confirm("Delete all events?\n\nThis clears the full event log.")) return;
  await api("/api/events", { method: "DELETE" });
  state.events = [];
  renderEvents();
  renderAllEventsTable();
}

function stbRows() {
  return state.devices.map((device) => ({
    id: device.id,
    name: device.name || "",
    host: device.host || "",
    adbHost: device.adbHost || "",
    location: device.location || "",
    notes: device.notes || "",
    enabled: device.enabled !== false,
    ristvInstalledAt: device.ristvInstalledAt || "",
    ristvApkFileName: device.ristvApkFileName || "",
    ristvLauncherConfiguredAt: device.ristvLauncherConfiguredAt || "",
    ristvLauncherComponent: device.ristvLauncherComponent || "",
  }));
}

function csvCell(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function xmlText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function exportContent(format) {
  const rows = stbRows();
  if (format === "csv") {
    const header = ["id", "name", "host", "adbHost", "location", "notes", "enabled", "ristvInstalledAt", "ristvApkFileName", "ristvLauncherConfiguredAt", "ristvLauncherComponent"];
    return [
      header.join(","),
      ...rows.map((row) => header.map((field) => csvCell(row[field])).join(",")),
    ].join("\n");
  }
  if (format === "xml") {
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<stbs>",
      ...rows.map((row) => [
        "  <stb>",
        `    <id>${xmlText(row.id)}</id>`,
        `    <name>${xmlText(row.name)}</name>`,
        `    <host>${xmlText(row.host)}</host>`,
        `    <adbHost>${xmlText(row.adbHost)}</adbHost>`,
        `    <location>${xmlText(row.location)}</location>`,
        `    <notes>${xmlText(row.notes)}</notes>`,
        `    <enabled>${row.enabled}</enabled>`,
        `    <ristvInstalledAt>${xmlText(row.ristvInstalledAt)}</ristvInstalledAt>`,
        `    <ristvApkFileName>${xmlText(row.ristvApkFileName)}</ristvApkFileName>`,
        `    <ristvLauncherConfiguredAt>${xmlText(row.ristvLauncherConfiguredAt)}</ristvLauncherConfiguredAt>`,
        `    <ristvLauncherComponent>${xmlText(row.ristvLauncherComponent)}</ristvLauncherComponent>`,
        "  </stb>",
      ].join("\n")),
      "</stbs>",
      "",
    ].join("\n");
  }
  return rows.map((row) => [
    `Name: ${row.name}`,
    `IP / Host: ${row.host}`,
    `ADB target: ${row.adbHost}`,
    `Location: ${row.location}`,
    `Notes: ${row.notes}`,
    `Enabled: ${row.enabled}`,
    `RISTV installed: ${row.ristvInstalledAt}`,
    `RISTV APK file: ${row.ristvApkFileName}`,
    `RISTV launcher configured: ${row.ristvLauncherConfiguredAt}`,
    `RISTV launcher component: ${row.ristvLauncherComponent}`,
  ].join("\n")).join("\n\n");
}

function downloadFile(fileName, mimeType, content) {
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function exportStbs(format) {
  const types = {
    csv: "text/csv;charset=utf-8",
    txt: "text/plain;charset=utf-8",
    xml: "application/xml;charset=utf-8",
  };
  downloadFile(`ristv-stbs.${format}`, types[format] || types.txt, exportContent(format));
  $("#exportDialog").close();
}

function tagText(node, tagName) {
  return node.querySelector(tagName)?.textContent?.trim() || "";
}

function parseStbXml(text) {
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("The XML file could not be parsed");
  return Array.from(doc.querySelectorAll("stb")).map((node) => ({
    id: tagText(node, "id"),
    name: tagText(node, "name"),
    host: tagText(node, "host"),
    adbHost: tagText(node, "adbHost"),
    location: tagText(node, "location"),
    notes: tagText(node, "notes"),
    enabled: tagText(node, "enabled").toLowerCase() !== "false",
    ristvInstalledAt: tagText(node, "ristvInstalledAt"),
    ristvApkFileName: tagText(node, "ristvApkFileName"),
    ristvLauncherConfiguredAt: tagText(node, "ristvLauncherConfiguredAt"),
    ristvLauncherComponent: tagText(node, "ristvLauncherComponent"),
  })).filter((device) => device.name && device.host);
}

async function importStbsFromFile(file) {
  const text = await file.text();
  const devices = parseStbXml(text);
  if (!devices.length) {
    alert("No valid STBs were found in the XML file.");
    return;
  }

  let mode = "add";
  if (!confirm(`${devices.length} STB${devices.length === 1 ? "" : "s"} found.\n\nPress OK to add them to existing STBs.\nPress Cancel to choose replacing all existing STBs.`)) {
    if (!confirm("Delete all existing STBs before importing this XML file?")) return;
    mode = "replace";
  }

  const json = await api("/api/devices/import", {
    method: "POST",
    body: JSON.stringify({ mode, devices }),
  });
  state.devices = json.devices;
  state.selectedDeviceId = null;
  state.detailsDirty = false;
  render();
  await loadEvents();
  alert(`${json.imported} STB${json.imported === 1 ? "" : "s"} imported.`);
}

async function deleteAllStbs() {
  if (!confirm("Delete all STBs?\n\nThis removes every STB from monitoring.")) return;
  if (!confirm("Please confirm again: delete every STB from the dashboard?")) return;
  await api("/api/devices", { method: "DELETE" });
  state.devices = [];
  state.selectedDeviceId = null;
  state.detailsDirty = false;
  render();
  await loadEvents();
}

function render() {
  renderSummary();
  renderStatusFilters();
  renderDevices();
  renderEvents();
  renderOpenFunctionsDialog();
  const latest = state.devices
    .map((device) => device.status.lastCheckedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  $("#lastUpdated").textContent = latest ? `Last checked ${fmtTime(latest)}` : "Waiting for first check";
}

function applyAppTitle() {
  const title = state.settings?.appTitle || "STB Monitor";
  $("#appTitle").textContent = title;
  document.title = title;
}

function openScreenshot(deviceId) {
  const device = state.devices.find((candidate) => candidate.id === deviceId);
  const screenshotUrl = state.screenshots[deviceId];
  if (!device || !screenshotUrl) return;
  state.screenshotDeviceId = deviceId;
  $("#screenshotTitle").textContent = `${device.name} screenshot`;
  const image = $("#screenshotPreview");
  image.src = screenshotUrl;
  image.alt = `${device.name} screenshot`;
  $("#screenshotRemoteMessage").textContent = "";
  $("#screenshotDialog").showModal();
}

async function sendScreenshotKey(key) {
  const deviceId = state.screenshotDeviceId;
  if (!deviceId) return;
  const message = $("#screenshotRemoteMessage");
  message.textContent = `Sending ${key}...`;
  try {
    await api(`/api/devices/${encodeURIComponent(deviceId)}/adb/keyevent`, {
      method: "POST",
      body: JSON.stringify({ key }),
    });
    message.textContent = `${key} sent. Refreshing screenshot...`;
    const json = await api(`/api/devices/${encodeURIComponent(deviceId)}/adb/screenshot`, {
      method: "POST",
      body: "{}",
    });
    state.screenshots[deviceId] = json.result.url;
    $("#screenshotPreview").src = json.result.url;
    message.textContent = `${key} sent.`;
    await loadEvents();
  } catch (error) {
    message.textContent = `${key} failed: ${error.message}`;
  }
}

function openLiveStream(deviceId) {
  const device = state.devices.find((candidate) => candidate.id === deviceId);
  if (!device) return;
  $("#liveStreamTitle").textContent = `${device.name} live stream`;
  $("#liveStreamMessage").textContent = "Streaming via ADB screenshots. Close this window to stop.";
  const image = $("#liveStreamPreview");
  image.alt = `${device.name} live stream`;
  image.src = `/api/devices/${encodeURIComponent(deviceId)}/adb/live-stream?t=${Date.now()}`;
  $("#liveStreamDialog").showModal();
}

function closeLiveStream() {
  const image = $("#liveStreamPreview");
  image.removeAttribute("src");
  image.alt = "";
  $("#liveStreamMessage").textContent = "";
  $("#liveStreamDialog").close();
  loadEvents().catch(() => {});
}

function renderOpenFunctionsDialog() {
  const dialog = $("#functionsDialog");
  if (!dialog.open) return;
  const deviceId = dialog.dataset.deviceId;
  const device = state.devices.find((candidate) => candidate.id === deviceId);
  if (!device) {
    dialog.close();
    return;
  }
  $("#functionsTitle").textContent = `${device.name} functions`;
  $("#functionsCard").innerHTML = deviceCardHtml(device, { selected: true });
}

function openFunctions(deviceId) {
  const device = state.devices.find((candidate) => candidate.id === deviceId);
  if (!device) return;
  const dialog = $("#functionsDialog");
  dialog.dataset.deviceId = deviceId;
  $("#functionsTitle").textContent = `${device.name} functions`;
  $("#functionsCard").innerHTML = deviceCardHtml(device, { selected: true });
  dialog.showModal();
}

function openDialog() {
  $("#deviceForm").reset();
  $("#deviceDialog").showModal();
}

function fillSettingsForm() {
  if (!state.settings) return;
  const form = $("#settingsForm");
  const settings = state.settings;
  form.elements.appTitle.value = settings.appTitle || "STB Monitor";
  form.elements.port.value = settings.port;
  form.elements.monitorIntervalMs.value = settings.monitorIntervalMs;
  form.elements.pingTimeoutMs.value = settings.pingTimeoutMs;
  form.elements.alertCooldownMs.value = settings.alertCooldownMs;
  form.elements.logRetentionDays.value = settings.logRetentionDays || 30;
  form.elements.adbPath.value = settings.adbPath || "adb";
  form.elements.packageName.value = settings.packageName || "";
  form.elements.ristvApkFile.value = settings.ristvApkFile || "";
  form.elements.smtpHost.value = settings.smtp.host || "";
  form.elements.smtpPort.value = settings.smtp.port || 587;
  form.elements.smtpSecure.checked = settings.smtp.secure === true;
  form.elements.smtpUser.value = settings.smtp.user || "";
  form.elements.smtpPass.value = settings.smtp.pass || "";
  form.elements.smtpFrom.value = settings.smtp.from || "";
  form.elements.smtpTo.value = (settings.smtp.to || []).join(",");
}

async function openSettings() {
  $("#settingsMessage").textContent = "Loading...";
  $("#settingsDialog").showModal();
  await loadSettings();
  $("#settingsMessage").textContent = "";
}

async function saveDevice(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = {
    name: form.get("name"),
    host: form.get("host"),
    adbHost: form.get("adbHost"),
    location: form.get("location"),
    notes: form.get("notes"),
    enabled: form.get("enabled") === "on",
  };
  await api("/api/devices", { method: "POST", body: JSON.stringify(payload) });
  $("#deviceDialog").close();
  await loadDevices();
  await loadEvents();
}

async function saveDetails(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = {
    id: form.get("id"),
    name: form.get("name"),
    host: form.get("host"),
    adbHost: form.get("adbHost"),
    location: form.get("location"),
    notes: form.get("notes"),
    enabled: form.get("enabled") === "on",
  };
  $("#detailsMessage").textContent = "Saving...";
  const json = await api("/api/devices", { method: "POST", body: JSON.stringify(payload) });
  state.selectedDeviceId = json.device.id;
  state.detailsDirty = false;
  $("#detailsMessage").textContent = "Saved.";
  await loadDevices();
  await loadEvents();
}

function confirmDeleteDevice(device) {
  const name = device?.name || "this STB";
  return confirm(`Delete ${name} from monitoring?\n\nThis removes the STB from the dashboard.`);
}

async function deleteSelectedDevice() {
  const device = selectedDevice();
  if (!device || !confirmDeleteDevice(device)) return;
  await api(`/api/devices/${encodeURIComponent(device.id)}`, { method: "DELETE" });
  state.selectedDeviceId = null;
  state.detailsDirty = false;
  await loadDevices();
}

function settingsPayload() {
  const form = new FormData($("#settingsForm"));
  return {
    appTitle: form.get("appTitle"),
    port: form.get("port"),
    monitorIntervalMs: form.get("monitorIntervalMs"),
    pingTimeoutMs: form.get("pingTimeoutMs"),
    alertCooldownMs: form.get("alertCooldownMs"),
    logRetentionDays: form.get("logRetentionDays"),
    adbPath: form.get("adbPath"),
    packageName: form.get("packageName"),
    ristvApkFile: form.get("ristvApkFile"),
    smtp: {
      host: form.get("smtpHost"),
      port: form.get("smtpPort"),
      secure: form.get("smtpSecure") === "on",
      user: form.get("smtpUser"),
      pass: form.get("smtpPass"),
      from: form.get("smtpFrom"),
      to: form.get("smtpTo"),
    },
  };
}

async function saveSettings(event) {
  event.preventDefault();
  $("#settingsMessage").textContent = "Saving...";
  const savingDialog = $("#savingSettingsDialog");
  if (!savingDialog.open) savingDialog.showModal();
  const json = await api("/api/settings", {
    method: "POST",
    body: JSON.stringify(settingsPayload()),
  }).catch((error) => {
    $("#settingsMessage").textContent = `Save failed: ${error.message}`;
    throw error;
  }).finally(() => {
    if (savingDialog.open) savingDialog.close();
  });
  state.settings = json.settings;
  state.intervalMs = json.settings.monitorIntervalMs;
  applyAppTitle();
  fillSettingsForm();
  $("#settingsMessage").textContent = json.note || "Saved.";
  if ($("#settingsDialog").open) $("#settingsDialog").close();
  await loadEvents();
}

async function testEmail() {
  $("#settingsMessage").textContent = "Saving settings before test...";
  const saved = await api("/api/settings", {
    method: "POST",
    body: JSON.stringify(settingsPayload()),
  });
  state.settings = saved.settings;
  applyAppTitle();
  $("#settingsMessage").textContent = "Sending test email...";
  try {
    await api("/api/settings/test-email", { method: "POST", body: "{}" });
    $("#settingsMessage").textContent = "Test email sent.";
  } catch (error) {
    $("#settingsMessage").textContent = `Test failed: ${error.message}`;
  }
  await loadEvents();
}

document.addEventListener("click", async (event) => {
  const sortTarget = event.target.closest("[data-sort]");
  if (sortTarget) {
    const field = sortTarget.dataset.sort;
    if (state.sort.field === field) {
      state.sort.direction = state.sort.direction === "asc" ? "desc" : "asc";
    } else {
      state.sort.field = field;
      state.sort.direction = "asc";
    }
    render();
    return;
  }

  const statusFilterTarget = event.target.closest("[data-status-filter]");
  if (statusFilterTarget) {
    state.statusFilter = statusFilterTarget.dataset.statusFilter;
    render();
    return;
  }

  const listColumnTarget = event.target.closest("[data-list-column]");
  if (listColumnTarget) {
    const key = listColumnTarget.dataset.listColumn;
    if (listColumnTarget.checked) {
      state.listColumns = [...new Set([...state.listColumns, key])];
    } else {
      state.listColumns = state.listColumns.filter((column) => column !== key);
    }
    if (!state.listColumns.length) {
      state.listColumns = ["name"];
      renderListColumnsDialog();
    }
    saveListColumns();
    render();
    return;
  }

  if (event.target.closest(".launcher-toggle")) {
    return;
  }

  const functionsTarget = event.target.closest("[data-functions]");
  if (functionsTarget) {
    openFunctions(functionsTarget.dataset.functions);
    return;
  }

  const screenshotTarget = event.target.closest("[data-screenshot]");
  if (screenshotTarget) {
    await captureScreenshot(screenshotTarget.dataset.screenshot);
    return;
  }

  const screenshotViewTarget = event.target.closest("[data-screenshot-view]");
  if (screenshotViewTarget) {
    openScreenshot(screenshotViewTarget.dataset.screenshotView);
    return;
  }

  const screenshotKeyTarget = event.target.closest("[data-screenshot-key]");
  if (screenshotKeyTarget) {
    await sendScreenshotKey(screenshotKeyTarget.dataset.screenshotKey);
    return;
  }

  const liveStreamTarget = event.target.closest("[data-live-stream]");
  if (liveStreamTarget) {
    openLiveStream(liveStreamTarget.dataset.liveStream);
    return;
  }

  const showAppsTarget = event.target.closest("[data-show-apps]");
  if (showAppsTarget) {
    await showInstalledApps(showAppsTarget.dataset.showApps);
    return;
  }

  const appPackageTarget = event.target.closest("[data-app-package]");
  if (appPackageTarget) {
    openAppActions(appPackageTarget.dataset.appPackage);
    return;
  }

  const stbInfoTarget = event.target.closest("[data-stb-info]");
  if (stbInfoTarget) {
    await showStbInfo(stbInfoTarget.dataset.stbInfo);
    return;
  }

  const installRistvTarget = event.target.closest("[data-install-ristv]");
  if (installRistvTarget) {
    await installRistv(installRistvTarget.dataset.installRistv);
    return;
  }

  const uninstallRistvTarget = event.target.closest("[data-uninstall-ristv]");
  if (uninstallRistvTarget) {
    await uninstallRistv(uninstallRistvTarget.dataset.uninstallRistv);
    return;
  }

  const adbTarget = event.target.closest("[data-adb]");
  if (adbTarget) {
    const [id, action] = adbTarget.dataset.adb.split(":");
    await runAdb(id, action);
    return;
  }

  const deleteTarget = event.target.closest("[data-delete]");
  if (deleteTarget) {
    const deviceId = deleteTarget.dataset.delete;
    const device = state.devices.find((candidate) => candidate.id === deviceId);
    if (!confirmDeleteDevice(device)) return;
    await api(`/api/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" });
    if (state.selectedDeviceId === deviceId) {
      state.selectedDeviceId = null;
      state.detailsDirty = false;
    }
    await loadDevices();
    return;
  }

  const deviceTarget = event.target.closest("[data-device]");
  if (deviceTarget) {
    state.selectedDeviceId = deviceTarget.dataset.device;
    state.detailsDirty = false;
    render();
  }
});

document.addEventListener("change", async (event) => {
  const launcherTarget = event.target.closest("[data-launcher-toggle]");
  if (!launcherTarget) return;
  await toggleRistvLauncher(launcherTarget.dataset.launcherToggle, launcherTarget.checked);
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const deviceTarget = event.target.closest("[data-device]");
  if (!deviceTarget) return;
  event.preventDefault();
  state.selectedDeviceId = deviceTarget.dataset.device;
  state.detailsDirty = false;
  render();
});

$("#addBtn").addEventListener("click", openDialog);
$("#refreshBtn").addEventListener("click", refreshNow);
$("#settingsBtn").addEventListener("click", openSettings);
$("#listColumnsBtn").addEventListener("click", openListColumnsDialog);
$("#exportStbsBtn").addEventListener("click", () => $("#exportDialog").showModal());
$("#importStbsBtn").addEventListener("click", () => $("#importStbsFile").click());
$("#deleteAllStbsBtn").addEventListener("click", deleteAllStbs);
$("#importStbsFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    await importStbsFromFile(file);
  } catch (error) {
    alert(`Import failed: ${error.message}`);
  }
});
$("#closeExportDialog").addEventListener("click", () => $("#exportDialog").close());
$("#closeScreenshotDialog").addEventListener("click", () => $("#screenshotDialog").close());
$("#screenshotDialog").addEventListener("close", () => {
  state.screenshotDeviceId = null;
});
$("#closeLiveStreamDialog").addEventListener("click", closeLiveStream);
$("#liveStreamDialog").addEventListener("close", () => {
  $("#liveStreamPreview").removeAttribute("src");
});
$("#closeInstallDialog").addEventListener("click", closeInstallDialog);
$("#cancelInstallDialog").addEventListener("click", cancelInstallDialog);
$("#installDialog").addEventListener("cancel", (event) => {
  if (state.installDialogActive) event.preventDefault();
});
$("#closeAppsDialog").addEventListener("click", () => $("#appsDialog").close());
$("#appsDialog").addEventListener("close", () => {
  state.installedAppsDeviceId = null;
  state.selectedAppPackage = "";
});
$("#appsInstallBtn").addEventListener("click", installSelectedAppFile);
$("#appsFilter").addEventListener("input", (event) => {
  state.installedAppsFilter = event.target.value;
  renderInstalledApps();
});
$("#closeAppActionsDialog").addEventListener("click", () => $("#appActionsDialog").close());
$("#appMemoryBtn").addEventListener("click", showSelectedAppMemory);
$("#appUninstallBtn").addEventListener("click", uninstallSelectedApp);
$("#closeStbInfoDialog").addEventListener("click", () => $("#stbInfoDialog").close());
$("#closeFunctionsDialog").addEventListener("click", () => $("#functionsDialog").close());
$("#closeListColumnsDialog").addEventListener("click", () => $("#listColumnsDialog").close());
document.querySelectorAll("[data-export-format]").forEach((button) => {
  button.addEventListener("click", () => exportStbs(button.dataset.exportFormat));
});
$("#showAllEventsBtn").addEventListener("click", showAllEvents);
$("#deleteAllEventsBtn").addEventListener("click", deleteAllEvents);
$("#closeAllEvents").addEventListener("click", () => $("#allEventsDialog").close());
$("#deviceFilter").addEventListener("input", (event) => {
  state.filterQuery = event.target.value;
  render();
});
$("#detailsForm").addEventListener("input", () => {
  state.detailsDirty = true;
});
document.querySelectorAll("[data-view-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    state.viewMode = button.dataset.viewMode;
    render();
  });
});
$("#cancelDialog").addEventListener("click", () => $("#deviceDialog").close());
$("#cancelSettings").addEventListener("click", () => $("#settingsDialog").close());
$("#deviceForm").addEventListener("submit", saveDevice);
$("#detailsForm").addEventListener("submit", saveDetails);
$("#detailsDelete").addEventListener("click", deleteSelectedDevice);
$("#settingsForm").addEventListener("submit", saveSettings);
$("#testEmailBtn").addEventListener("click", testEmail);

loadDevices().catch((error) => alert(error.message));
loadEvents().catch(() => {});
loadSettings().catch(() => {});
setInterval(() => {
  loadDevices().catch(() => {});
  loadEvents().catch(() => {});
}, 10000);
