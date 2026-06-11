const { execFile } = require("child_process");
const os = require("os");

function parsePingResult(output, error, measuredMs) {
  const text = String(output || "");
  const lower = text.toLowerCase();
  const failurePatterns = [
    "destination host unreachable",
    "destination net unreachable",
    "request timed out",
    "100% loss",
    "100% packet loss",
    "ttl expired",
    "transmit failed",
    "could not find host",
    "unknown host",
    "general failure",
  ];
  const hasFailureText = failurePatterns.some((pattern) => lower.includes(pattern));
  const latencyMatch =
    text.match(/time[=<]\s*(\d+(?:\.\d+)?)\s*ms/i) ||
    text.match(/Average\s*=\s*(\d+(?:\.\d+)?)ms/i);
  const hasRealReply = Boolean(latencyMatch || /\bttl[=\s]\d+/i.test(text));
  const windowsReceivedMatch = text.match(/Received\s*=\s*(\d+)/i);
  const unixReceivedMatch = text.match(/,\s*(\d+)\s+(?:packets\s+)?received/i);
  const received = windowsReceivedMatch
    ? Number.parseInt(windowsReceivedMatch[1], 10)
    : unixReceivedMatch
      ? Number.parseInt(unixReceivedMatch[1], 10)
      : null;
  const ok = !error && !hasFailureText && hasRealReply && (received === null || received > 0);
  const latencyMs = latencyMatch ? Number.parseFloat(latencyMatch[1]) : measuredMs;

  return {
    ok,
    latencyMs: ok ? Math.round(latencyMs) : null,
    error: ok ? "" : text.trim() || error?.message || "No successful ping reply",
  };
}

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
      resolve(parsePingResult(output, error, measured));
    });
  });
}

module.exports = { pingHost, parsePingResult };
