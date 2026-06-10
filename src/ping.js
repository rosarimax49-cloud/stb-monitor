const { execFile } = require("child_process");
const os = require("os");

function pingHost(host, timeoutMs) {
  return new Promise((resolve) => {
    if (!host) {
      resolve({ ok: false, latencyMs: null, error: "Missing host" });
      return;
    }

    const isWindows = os.platform() === "win32";
    const args = isWindows
      ? ["-n", "1", "-w", String(timeoutMs), host]
      : ["-c", "1", "-W", String(Math.ceil(timeoutMs / 1000)), host];

    const startedAt = Date.now();
    execFile("ping", args, { timeout: timeoutMs + 1000 }, (error, stdout, stderr) => {
      const output = `${stdout}\n${stderr}`;
      const measured = Date.now() - startedAt;
      const latencyMatch =
        output.match(/time[=<]\s*(\d+(?:\.\d+)?)\s*ms/i) ||
        output.match(/Average\s*=\s*(\d+(?:\.\d+)?)ms/i);
      const latencyMs = latencyMatch ? Number.parseFloat(latencyMatch[1]) : measured;
      resolve({
        ok: !error,
        latencyMs: !error ? Math.round(latencyMs) : null,
        error: error ? output.trim() || error.message : "",
      });
    });
  });
}

module.exports = { pingHost };
