/*
 * Save Message as EML — v0.4.0 (local endpoint)
 *
 * The "Save .eml" button appears in the message display toolbar.
 * Pressing it sends the raw RFC 822 source of the currently displayed
 * message (headers, body, attachments) as one HTTP POST to the local
 * endpoint configured in the options, e.g.
 *
 *     http://127.0.0.1:8765/eml
 *
 * The server (server/eml_server.py) writes it to your output directory
 * and returns the final path. All processing logic lives on the server,
 * which you own and can extend.
 *
 * Why an endpoint at all (verified in Thunderbird/Gecko source):
 *   - the WebExtension `downloads` API only writes into Thunderbird's
 *     downloads directory (absolute filenames and ".." are rejected by
 *     ext-downloads.js), `data:` URLs are refused,
 *   - no WebExtension API writes to an arbitrary directory (localFile is
 *     gone), and the download directory itself cannot be read or
 *     changed from an extension (browserSettings does not expose it),
 *   - so the extension does the one thing it can do everywhere:
 *     POST the bytes to a loopback endpoint.
 *
 *   browser.messageDisplayAction.onClicked        the button
 *   browser.messageDisplay.getDisplayedMessages   which message is open
 *   browser.messages.getRaw                       raw RFC 822 source
 *   fetch() to the loopback endpoint (host_permissions)
 *   browser.storage.local                         configured endpoint
 *
 *  - no `downloads` permission, no file-system access from the extension,
 *    no third-party code, no remote hosts (127.0.0.1 only)
 *  - one notification with the final path (from the server's reply)
 *
 * Log lines are prefixed [eml]; about:debugging -> This Thunderbird
 * -> "Save Message as EML" -> Console.
 */

// Default endpoint, used until the options are set.
const DEFAULT_ENDPOINT = "http://127.0.0.1:8765/eml";

const log = (...a) => console.log("[eml]", ...a);
const logErr = (...a) => console.error("[eml]", ...a);

const pad = (n) => String(n).padStart(2, "0");

messenger.messageDisplayAction.onClicked.addListener(() => {
  log("button clicked");
  saveDisplayed().catch((err) => {
    logErr("FAILED:", err && err.message ? err.message : err);
    logErr("stack:", err && err.stack ? err.stack : "(no stack)");
    notify("Save as EML failed", String(err && err.message ? err.message : err));
  });
});

async function saveDisplayed() {
  const endpoint = (await messenger.storage.local.get("endpoint")).endpoint
    || DEFAULT_ENDPOINT;

  // 1. Which message is currently displayed? (active tab)
  log("step 1: getDisplayedMessages …");
  const list = await messenger.messageDisplay.getDisplayedMessages();
  const msg = list.messages[0];
  if (!msg) {
    throw new Error("no message is displayed in the active tab");
  }
  log("step 1 ok: msg.id =", msg.id, "subject =", msg.subject);

  // 2. The raw message source (headers + body + attachments).
  log("step 2: messages.getRaw …");
  const file = await messenger.messages.getRaw(msg.id);
  const bytes = new Uint8Array(await file.arrayBuffer());
  log("step 2 ok: size =", bytes.length);

  // 3. Suggested file name: <timestamp>.eml, moment of the click (local).
  //    The server may keep it or rename as it likes.
  const c = new Date();
  const name =
    `${c.getFullYear()}${pad(c.getMonth() + 1)}${pad(c.getDate())}` +
    `_${pad(c.getHours())}${pad(c.getMinutes())}${pad(c.getSeconds())}.eml`;

  // 4. POST the bytes to the local endpoint.
  log("step 3: POST", endpoint, "name =", name);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-EML-Name": name,
      "X-EML-Subject": (msg.subject || "").slice(0, 500),
      "X-EML-Message-Id": msg.id,
    },
    body: bytes,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`server replied ${res.status}: ${text.slice(0, 300)}`);
  }
  let path = text;
  try {
    path = JSON.parse(text).path || text;
  } catch (_) {
    /* server did not return JSON — raw reply is the path */
  }
  log("done:", path);
  notify("Saved as EML", String(path));
}

function notify(title, message) {
  if (messenger.notifications && messenger.notifications.create) {
    messenger.notifications.create({
      id: "save-as-eml",
      title,
      message,
      type: "basic",
    });
  }
}
