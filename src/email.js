const net = require("net");
const tls = require("tls");
const config = require("./config");

function readLine(socket) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      if (/\r?\n/.test(buffer) && /^[0-9]{3} /.test(buffer.split(/\r?\n/).filter(Boolean).slice(-1)[0] || "")) {
        cleanup();
        resolve(buffer);
      }
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.on("error", onError);
  });
}

async function expect(socket, codes) {
  const response = await readLine(socket);
  const code = Number.parseInt(response.slice(0, 3), 10);
  if (!codes.includes(code)) throw new Error(`SMTP expected ${codes.join("/")} but got: ${response.trim()}`);
  return response;
}

async function send(socket, command, codes) {
  socket.write(`${command}\r\n`);
  return expect(socket, codes);
}

function connectSocket(settings) {
  return new Promise((resolve, reject) => {
    const socket = settings.secure
      ? tls.connect(settings.port, settings.host, { servername: settings.host }, () => resolve(socket))
      : net.connect(settings.port, settings.host, () => resolve(socket));
    socket.once("error", reject);
    socket.setTimeout(20000, () => socket.destroy(new Error("SMTP connection timed out")));
  });
}

function upgradeToTls(socket, settings) {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({ socket, servername: settings.host }, () => resolve(secureSocket));
    secureSocket.once("error", reject);
  });
}

function addressOnly(value) {
  const match = String(value).match(/<([^>]+)>/);
  return match ? match[1] : String(value).trim();
}

function encodeBase64(value) {
  return Buffer.from(String(value), "utf8").toString("base64");
}

function buildMessage({ from, to, subject, text }) {
  return [
    `From: ${from}`,
    `To: ${to.join(", ")}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    text,
    ".",
    "",
  ].join("\r\n");
}

async function sendMail({ subject, text }) {
  const settings = config.smtp;
  if (!settings.host || settings.to.length === 0) {
    return { ok: false, skipped: true, reason: "SMTP_HOST and ALERT_TO are not configured" };
  }

  let socket = await connectSocket(settings);
  try {
    await expect(socket, [220]);
    await send(socket, "EHLO ristv-monitor.local", [250]);

    if (!settings.secure) {
      await send(socket, "STARTTLS", [220]);
      socket = await upgradeToTls(socket, settings);
      await send(socket, "EHLO ristv-monitor.local", [250]);
    }

    if (settings.user && settings.pass) {
      await send(socket, "AUTH LOGIN", [334]);
      await send(socket, encodeBase64(settings.user), [334]);
      await send(socket, encodeBase64(settings.pass), [235]);
    }

    await send(socket, `MAIL FROM:<${addressOnly(settings.from)}>`, [250]);
    for (const recipient of settings.to) {
      await send(socket, `RCPT TO:<${addressOnly(recipient)}>`, [250, 251]);
    }
    await send(socket, "DATA", [354]);
    socket.write(buildMessage({ from: settings.from, to: settings.to, subject, text }));
    await expect(socket, [250]);
    await send(socket, "QUIT", [221]);
    return { ok: true };
  } finally {
    socket.destroy();
  }
}

module.exports = { sendMail };
