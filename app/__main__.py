"""Startet den lokalen Server und öffnet den Browser."""
from __future__ import annotations

import os
import socket
import threading
import webbrowser

import uvicorn

from .main import app


def _free_port(start: int = 8420) -> int:
    for port in range(start, start + 20):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    return start


def run() -> None:
    port = int(os.environ.get("FPT_PORT") or _free_port())
    url = f"http://127.0.0.1:{port}"
    print(f"\n  FortiPAM Toolkit läuft auf {url}  (Beenden mit Strg+C)\n")
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    run()
