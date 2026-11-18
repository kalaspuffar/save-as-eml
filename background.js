/*
 * Save Message as EML — v0.3.0
 *
 * The "Save .eml" button appears in the message display toolbar.
 * Pressing it saves the currently displayed message as
 * <timestamp>.eml (local time at the moment of the click).
 *
 * Why the download-dir detour (verified in Thunderbird/Gecko source):
 *   - the WebExtension `downloads` API only writes inside Thunderbird's
 *     downloads directory: absolute filenames and ".." are rejected
 *     (ext-downloads.js: "filename must not be an absolute path",
 *      "filename must not contain back-references (..)"),
 *   - data: URLs are refused by content policy,
 *   - there is no WebExtension API to write files to an arbitrary
 *     directory (the old localFile API is gone).
 *
 * So the extension writes <timestamp>.eml to the downloads directory,
 * and the small local mover (mover/eml_mover.py) moves it to the
 * output directory configured in the extension options.
 *
 *   browser.messageDisplayAction.onClicked        the button
 *   browser.messageDisplay.getDisplayedMessages   which message is open
 *   browser.messages.getRaw                       raw RFC 822 source (DOM File)
 *   browser.downloads.download                    write to the downloads dir
 *   browser.storage.local                         configured output dir
 *
 *  - never overwrites : conflictAction "uniquify"
 *  - no dialogs, no prompts, no network, no third-party code
 *
 * Log lines are prefixed [eml]; see about:debugging -> This Thunderbird
 * -> "Save Message as EML" -> Console.
 */

// Fallback output directory, used only if the options have not been set.
const DEFAULT_DIR = "/home/danielp/eml-out";
const DOWNLOADS_HINT = "downloads directory";

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
  const dir = (await messenger.storage.local.get("dir")).dir || DEFAULT_DIR;

  // 1. Which message is currently displayed? (active tab)
  log("step 1: getDisplayedMessages …");
  const list = await messenger.messageDisplay.getDisplayedMessages();
  const msg = list.messages[0];
  if (!msg) {
    throw new Error("no message is displayed in the active tab");
  }
  log("step 1 ok: msg.id =", msg.id, "subject =", msg.subject);

  // 2. The raw message source (headers + body + attachments) as a DOM File.
  log("step 2: messages.getRaw …");
  const file = await messenger.messages.getRaw(msg.id);
  log("step 2 ok: file =", file && file.name, "size =", file && file.size);

  // 3. File name: <timestamp>.eml — the moment of the click (local time).
  const c = new Date();
  const name =
    `${c.getFullYear()}${pad(c.getMonth() + 1)}${pad(c.getDate())}` +
    `_${pad(c.getHours())}${pad(c.getMinutes())}${pad(c.getSeconds())}.eml`;

  // 4. Write to the downloads directory (the only place the WebExtension
  //    downloads API may write; a relative filename is required).
  log("step 4: downloads.download … name =", name, "target dir =", dir);
  const url = URL.createObjectURL(file);
  try {
    await messenger.downloads.download({
      url,
      filename: name,
      conflictAction: "uniquify",
    });
    log("step 4 ok: download accepted");
  } finally {
    URL.revokeObjectURL(url);
  }

  log("done: " + name + " in " + DOWNLOADS_HINT + "; mover will move it to " + dir);
  notify("Saved as EML", `${name} → ${dir}`);
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
