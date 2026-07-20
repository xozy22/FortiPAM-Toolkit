"""Windows-DPAPI-Verschlüsselung für die lokale Ablage des API-Tokens.

Die Daten sind an das Windows-Benutzerkonto gebunden (CryptProtectData) —
andere Benutzer oder Rechner können sie nicht entschlüsseln.
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes
import sys

CRYPTPROTECT_UI_FORBIDDEN = 0x01


class _DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", ctypes.wintypes.DWORD),
                ("pbData", ctypes.POINTER(ctypes.c_char))]


def available() -> bool:
    return sys.platform == "win32"


def _blob_bytes(blob: _DATA_BLOB) -> bytes:
    data = ctypes.string_at(blob.pbData, blob.cbData)
    ctypes.windll.kernel32.LocalFree(blob.pbData)
    return data


def _crypt(data: bytes, encrypt: bool) -> bytes:
    if not available():
        raise OSError("DPAPI ist nur unter Windows verfügbar.")
    blob_in = _DATA_BLOB(len(data), ctypes.cast(
        ctypes.create_string_buffer(data, len(data)), ctypes.POINTER(ctypes.c_char)))
    blob_out = _DATA_BLOB()
    func = (ctypes.windll.crypt32.CryptProtectData if encrypt
            else ctypes.windll.crypt32.CryptUnprotectData)
    ok = func(ctypes.byref(blob_in), None, None, None, None,
              CRYPTPROTECT_UI_FORBIDDEN, ctypes.byref(blob_out))
    if not ok:
        raise OSError("DPAPI-Aufruf fehlgeschlagen.")
    return _blob_bytes(blob_out)


def protect(data: bytes) -> bytes:
    return _crypt(data, encrypt=True)


def unprotect(data: bytes) -> bytes:
    return _crypt(data, encrypt=False)
