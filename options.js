/*
 * Save Message as EML — options page
 *
 * One setting: the local endpoint the raw message is POSTed to.
 * Stored in the extension's storage.local; read by background.js on
 * every click.
 */

const input = document.getElementById("endpoint");
const save = document.getElementById("save");
const status = document.getElementById("status");

async function load() {
  const s = await browser.storage.local.get("endpoint");
  if (s.endpoint) {
    input.value = s.endpoint;
  }
}

save.addEventListener("click", async () => {
  const endpoint = input.value.trim();
  if (!endpoint) {
    status.textContent = "Enter the endpoint URL first.";
    return;
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/\S*)?$/i.test(endpoint)) {
    status.textContent =
      "Must be a local http(s) URL, e.g. http://127.0.0.1:8765/eml";
    return;
  }
  await browser.storage.local.set({ endpoint });
  status.textContent = "Saved: " + endpoint;
});

load();
