#!/usr/bin/env python3
"""
eml-mover — moves "Save Message as EML" files to the output directory.

The Thunderbird WebExtension can only write files into Thunderbird's
downloads directory, so the extension drops <YYYYMMDD_HHMMSS>.eml there
and this small watcher moves matching new files to the configured
output directory as soon as they are complete.

Properties:
  - only touches files named ^[0-9]{8}_[0-9]{6}.eml$ (the extension's
    exact naming), so your normal downloads are never moved
  - only considers files modified within the last hour (plus files
    from before a mover restart), never old/manual files
  - waits until the file size is stable (download finished)
  - never overwrites: an existing target gets a .1, .2, ... suffix
  - output directory: --dir flag > extension options (storage.local in
    the Thunderbird profile) > ~/eml-out
  - Python 3 standard library only, no network access

Usage:
  eml_mover.py [--downloads-dir DIR] [--dir DIR] [--interval 0.5]

Run persistently (systemd user service, see eml-mover.service):
  systemctl --user start eml-mover
  journalctl --user -u eml-mover -f
"""

import argparse
import json
import os
import re
import shutil
import sys
import time
from pathlib import Path

PATTERN = re.compile(r"^\d{8}_\d{6}\.eml$")
ADDON_ID = "save-as-eml@danielpersson.local"
DEFAULT_OUT = "~/eml-out"
RECENT_WINDOW_S = 3600  # only files modified within the last hour


def log(*a):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), *a, flush=True)


def resolve_dir(cli_dir):
    if cli_dir:
        return os.path.expanduser(cli_dir)
    # Extension options: storage.local lives in the profile as
    # <profile>/webext-storage-local/<addon-id>.json  ->  {"dir": "/..."}
    prof = Path.home() / ".thunderbird"
    if prof.is_dir():
        for p in sorted(prof.glob(f"*/webext-storage-local/{ADDON_ID}.json")):
            try:
                d = json.loads(p.read_text()).get("dir")
                if isinstance(d, str) and d.startswith("/"):
                    return d
            except Exception:
                pass
    return os.path.expanduser(DEFAULT_OUT)


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


def read_state(statefile: Path):
    try:
        return float(statefile.read_text().strip())
    except Exception:
        return 0.0


def main():
    ap = argparse.ArgumentParser(
        description="Move Save Message as EML files to the output directory."
    )
    ap.add_argument("--downloads-dir", default=os.path.expanduser("~/Downloads"))
    ap.add_argument("--dir", default=None,
                    help="output directory (default: extension option, else ~/eml-out)")
    ap.add_argument("--interval", type=float, default=0.5,
                    help="poll interval in seconds (default 0.5)")
    args = ap.parse_args()

    ddir = Path(os.path.expanduser(args.downloads_dir))
    outdir = Path(resolve_dir(args.dir))

    cache = Path(os.environ.get("XDG_CACHE_HOME", os.path.expanduser("~/.cache"))) / "eml-mover"
    cache.mkdir(parents=True, exist_ok=True)
    statefile = cache / "last_run"

    last_run = read_state(statefile)
    # Resume safely after restarts: process files newer than the last
    # run (minus slack), but never older than the recent window.
    floor = max(last_run - 5.0, time.time() - RECENT_WINDOW_S)

    log(f"downloads dir: {ddir}")
    log(f"output dir:    {outdir}")
    outdir.mkdir(parents=True, exist_ok=True)

    sizes = {}  # name -> last seen size (stability detection)
    while True:
        now = time.time()
        cutoff = max(floor, now - RECENT_WINDOW_S)
        if ddir.is_dir():
            try:
                entries = list(ddir.iterdir())
            except OSError as e:
                log(f"cannot list downloads dir: {e}")
                entries = []
            for f in entries:
                if not PATTERN.match(f.name):
                    continue
                try:
                    st = f.stat()
                except OSError:
                    continue
                if not f.is_file() or st.st_mtime <= cutoff:
                    continue
                prev = sizes.get(f.name)
                if prev is not None and prev == st.st_size:
                    # Stable across two polls -> complete.
                    target = uniquify(outdir / f.name)
                    try:
                        shutil.move(str(f), str(target))
                        log(f"moved {f.name} -> {target}")
                    except Exception as e:
                        log(f"move failed for {f.name}: {e}")
                    sizes.pop(f.name, None)
                else:
                    sizes[f.name] = st.st_size
        try:
            statefile.write_text(str(now))
        except OSError:
            pass
        time.sleep(args.interval)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log("stopped")
        sys.exit(0)
