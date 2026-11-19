# save-as-eml
Small thunderbird extension to with one button press save the email to a directory.

One click on the **Save .eml** button (message display toolbar) saves the
currently displayed message — raw RFC 822 source, headers, body and
attachments — as `<timestamp>.eml`, e.g. `20261118_111913.eml`, to the
directory your local server is started with. The extension POSTs the raw
bytes to a loopback endpoint you own, so all processing logic (naming,
routing, hooks) can live on the server side.

- Pure WebExtension (Manifest V3, Thunderbird ≥ 128), no third-party
  code, no privileged/experiment APIs, no remote hosts
- 4 small extension files + a ~150-line Python 3 reference server, all
  reviewable
- Never overwrites existing files (unique suffix on collision)
- Endpoint configurable in the extension GUI (options page)

## Files

| file               | what it is                                              |
|--------------------|---------------------------------------------------------|
| `manifest.json`    | MV3 manifest (permissions: messagesRead, storage, notifications; host permissions: 127.0.0.1 + localhost) |
| `background.js`    | button handler: get message → raw source → POST to endpoint |
| `options.html/js`  | GUI: the local endpoint setting                        |
| `server/eml_server.py` | reference server: writes the POSTed message to your directory |
| `server/eml_receiver.php` | the same receiver in PHP (drop-in for `php -S`, handles the CORS preflight) |
| `server/eml-server.service` | systemd user unit to keep the server running       |

## Why a local endpoint?

Thunderbird's WebExtension `downloads` API can only write files into
Thunderbird's **downloads directory** — absolute paths and `..` are
rejected by the API (verified in the Gecko source: `ext-downloads.js`
throws `filename must not be an absolute path`), `data:` URLs are refused,
and there is no WebExtension API to write to an arbitrary directory.
(Reading or temporarily changing Thunderbird's download directory is
also not possible from a WebExtension: the `browserSettings` API does
not expose it, and Thunderbird's own settings APIs only cover
spellcheck and the search provider — both verified in the TB/Gecko
source.)
POSTing to `127.0.0.1` is the one thing a WebExtension can do anywhere,
so the extension sends the message to a local endpoint. The reference
server keeps it dead simple; replace or extend it with whatever you like
— the contract is just: `POST /eml`, body = raw RFC 822, headers
`X-EML-Name`, `X-EML-Subject`, `X-EML-Message-Id`, reply = final path.

## Install

1. Build the XPI (or install from source via *Load Temporary Add-on*):
   ```sh
   cd save-as-eml
   zip save-as-eml.xpi manifest.json background.js options.html options.js
   ```
   Add it in Thunderbird: *Add-ons Manager → gear → Install Add-on From File*.
2. Set the endpoint (optional — the default is `http://127.0.0.1:8765/eml`):
   *Add-ons Manager → Save Message as EML → Options*.
3. Run the server (one-time service install):
   ```sh
   mkdir -p ~/.config/systemd/user
   sed -e "s|__HOME__|$HOME|" -e "s|__DIR__|/home/danielp/eml-out|" \
     save-as-eml/server/eml-server.service \
     > ~/.config/systemd/user/eml-server.service
   systemctl --user daemon-reload
   systemctl --user enable --now eml-server
   curl http://127.0.0.1:8765/health    # {"ok": true, "dir": "..."}
   journalctl --user -u eml-server -f   # watch it work
   ```
   (Or just run `python3 server/eml_server.py --dir ~/eml-out` for testing.)
   **Prefer PHP?** Copy `server/eml_receiver.php` into the directory and run
   `php -S localhost:8765 eml_receiver.php` (or point your router at it).
   It does the same job — write the POSTed message to a `.eml` file — and
   also answers the CORS preflight Thunderbird sends, so it works even with
   an extension build whose `host_permissions` don't cover your host.
4. Open a message, press **Save .eml** — the notification shows the
   final path, and the file is in your directory.

## Note: the `OPTIONS` preflight

When you press the button you may see the server get an `OPTIONS`
request before the real `POST`. That is a **CORS preflight**, sent by
Firefox/Thunderbird (not by Chrome) whenever the host you target is not
covered by the extension's `host_permissions`. If the preflight is not
answered with `Access-Control-Allow-*` headers, the browser drops the
real `POST` and you only ever see the `OPTIONS` (and no data).

v0.4.1 covers both `127.0.0.1` and `localhost`, so with it installed no
preflight is sent at all. If you run an older build against a host the
manifest doesn't list, either add that host to `host_permissions` and
reinstall, or let the server answer the preflight (the PHP handler in
`server/eml_receiver.php` does this for you).

## Security model

- The extension talks **only** to `127.0.0.1` (single host permission);
  no other host, no remote code.
- Extension permissions are limited to `messagesRead` (read the
  displayed message), `storage` (remember the endpoint),
  `notifications` (one confirmation per save). No `downloads`, no
  file-system access from the extension.
- The server binds `127.0.0.1` only, writes 0600 files to the directory
  you give it, caps the body at 256 MB, and refuses names that are not a
  plain `*.eml` basename.

## Debug

- Extension console: `about:debugging` → *This Thunderbird* →
  **Save Message as EML** → *Console* (log lines prefixed `[eml]`).
- Server: `journalctl --user -u eml-server -f`.
