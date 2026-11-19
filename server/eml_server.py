#!/usr/bin/env python3
"""
eml_server — local reference server for the "Save Message as EML" extension.

Listens on 127.0.0.1 only. When the extension POSTs a raw message to
/eml, this writes it to the output directory and answers with the final
path. This is where you add your own processing (renaming, routing,
hooks, ...) — the extension simply POSTs the bytes plus metadata
headers:

    X-EML-Name        suggested file name, e.g. 20261118_111913.eml
    X-EML-Subject     subject of the message (truncated to 500 chars)
    X-EML-Message-Id  the Thunderbird message id

Behavior of this reference implementation:
  - binds 127.0.0.1 only (never the network)
  - writes to --dir (created if missing), files 0600
  - never overwrites: existing targets get a .1, .2, ... suffix
  - the name comes from X-EML-Name; it is reduced to its basename and
    rejected if it looks like a path escape or is not a *.eml file
  - body size is capped at 256 MB
  - Python 3 standard library only, no other dependencies

Usage:
  eml_server.py [--port 8765] [--dir ~/eml-out]

Health check:
  curl http://127.0.0.1:8765/health
"""

import argparse
import json
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MAX_BODY = 256 * 1024 * 1024
SAFE_NAME = re.compile(r"^[A-Za-z0-9._-]+\.eml$")


def uniquify(target: Path) -> Path:
    if not target.exists():
        return target
    stem, suffix = target.stem, target.suffix
    n = 1
    while True:
        cand = target.with_name(f"{stem}.{n}{suffix}")
        if not cand.exists():
            return cand
        n += 1


def make_handler(outdir: Path):
    class Handler(BaseHTTPRequestHandler):
        server_version = "eml-server/1.0"

        def log_message(self, fmt, *args):
            print(time.strftime("%Y-%m-%d %H:%M:%S"),
                  fmt % args, flush=True)

        def _json(self, code, obj):
            body = json.dumps(obj).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == "/health":
                self._json(200, {"ok": True, "dir": str(outdir)})
            else:
                self._json(404, {"ok": False, "error": "not found"})

        def do_POST(self):
            if self.path != "/eml":
                self._json(404, {"ok": False, "error": "use POST /eml"})
                return

            try:
                length = int(self.headers.get("Content-Length", 0))
            except ValueError:
                length = 0
            if length <= 0 or length > MAX_BODY:
                self._json(400, {"ok": False,
                                 "error": f"bad Content-Length {length}"})
                return

            data = self.rfile.read(length)

            name = (self.headers.get("X-EML-Name") or "").strip()
            name = os.path.basename(name)  # refuse any path components
            if not name or not SAFE_NAME.match(name):
                name = (time.strftime("%Y%m%d_%H%M%S") + ".eml")

            target = uniquify(outdir / name)
            try:
                outdir.mkdir(parents=True, exist_ok=True)
                fd = os.open(str(target), os.O_WRONLY | os.O_CREAT, 0o600)
                with os.fdopen(fd, "wb") as f:
                    f.write(data)
            except OSError as e:
                self._json(500, {"ok": False, "error": str(e)})
                return

            subject = self.headers.get("X-EML-Subject", "")
            self.log_message(
                "saved %s (%d bytes) subject=%r", target, len(data), subject[:80])
            self._json(200, {"ok": True, "path": str(target)})

    return Handler


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--dir", default=os.path.expanduser("~/eml-out"),
                    help="output directory (default: ~/eml-out)")
    args = ap.parse_args()

    outdir = Path(os.path.expanduser(args.dir))
    httpd = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(outdir))
    print(f"eml-server listening on 127.0.0.1:{args.port}, writing to {outdir}",
          flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("stopped", flush=True)
        sys.exit(0)


if __name__ == "__main__":
    main()
