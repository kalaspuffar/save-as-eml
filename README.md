# save-as-eml
Small thunderbird extension to with one button press save the email to a directory.

One click on the **Save .eml** button (message display toolbar) saves the
currently displayed message — raw RFC 822 source, headers, body and
attachments — as `<timestamp>.eml`, e.g. `20261118_111913.eml`, to the
output directory configured in the extension options.

- Pure WebExtension (Manifest V3, Thunderbird ≥ 128), no network access,
  no third-party code, no privileged/experiment APIs
- Only 4 small files, all reviewable
- Never overwrites existing files (unique suffix on collision)
- Output directory configurable in the extension GUI (options page)

## Files

| file               | what it is                                              |
|--------------------|---------------------------------------------------------|
| `manifest.json`    | MV3 manifest (permissions: messagesRead, downloads, storage, notifications) |
| `background.js`    | button handler: get message → raw source → downloads dir |
| `options.html/js`  | GUI: the output directory setting                        |
| `mover/eml_mover.py` | small local watcher that moves the file into the output directory |
| `mover/eml-mover.service` | systemd user unit to keep the mover running          |

## Why a mover?

Thunderbird's WebExtension `downloads` API can only write files into
Thunderbird's **downloads directory** — absolute paths and `..` are
rejected by the API (verified in the Gecko source: `ext-downloads.js`
throws `filename must not be an absolute path`), `data:` URLs are refused,
and there is no WebExtension API to write to an arbitrary directory.
So the extension drops `<timestamp>.eml` into the downloads directory,
and the mover picks it up within about a second and moves it to your
output directory. Your normal downloads are never touched: the mover only
moves files matching the extension's exact naming
(`^[0-9]{8}_[0-9]{6}.eml$`) that were created recently.

## Install

1. Build the XPI (or install from source via *Load Temporary Add-on*):
   ```sh
   cd save-as-eml
   zip save-as-eml.xpi manifest.json background.js options.html options.js
   ```
   Add it in Thunderbird: *Add-ons Manager → gear → Install Add-on From File*.
2. Set the output directory: *Add-ons Manager → Save Message as EML →
   gear (or the options link) → Options* — enter e.g.
   `/home/danielp/eml-out` and press **Save**.
3. Install the mover (one-time):
   ```sh
   mkdir -p ~/.config/systemd/user
   sed "s|__HOME__|$HOME|" save-as-eml/mover/eml-mover.service \
     > ~/.config/systemd/user/eml-mover.service
   systemctl --user daemon-reload
   systemctl --user enable --now eml-mover
   journalctl --user -u eml-mover -f    # watch it work
   ```
   (Or just run `python3 mover/eml_mover.py` in a terminal for testing.)
4. Open a message, press **Save .eml**, watch the file appear in your
   output directory.

## Security model

- No network access at any point (no host permissions, no remote code).
- Permissions are limited to `messagesRead` (read the displayed message),
  `downloads` (write the file), `storage` (remember the output directory),
  `notifications` (one confirmation per save).
- The mover is a ~130-line Python 3 standard-library script; it moves
  only new files with the extension's exact name pattern and never
  overwrites.

## Debug

- Extension console: `about:debugging` → *This Thunderbird* →
  **Save Message as EML** → *Console* (log lines prefixed `[eml]`).
- Mover: `journalctl --user -u eml-mover -f`.
