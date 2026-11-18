/*
 * Save Message as EML — options page
 *
 * One setting: the absolute output directory. Stored in the
 * extension's storage.local; read by background.js on every click
 * and by mover/eml_mover.py from the profile's storage file.
 */

const input = document.getElementById("dir");
const save = document.getElementById("save");
const status = document.getElementById("status");

async function load() {
  const s = await browser.storage.local.get("dir");
  if (s.dir) {
    input.value = s.dir;
  }
}

save.addEventListener("click", async () => {
  const dir = input.value.trim();
  if (!dir) {
    status.textContent = "Enter a directory path first.";
    return;
  }
  if (!dir.startsWith("/")) {
    status.textContent = "Use an absolute path, e.g. /home/danielp/eml-out";
    return;
  }
  await browser.storage.local.set({ dir });
  status.textContent = "Saved: " + dir;
});

load();
