"""Content-defined chunks for delta updates of release assets.

Chunk boundaries come from a gear rolling hash.  Only the low ``AVG_BITS``
bits of the hash decide a boundary, and those bits depend on the last
``AVG_BITS`` bytes alone, so the hash of every position can be computed with
NumPy at once instead of a Python loop over each byte.  The boundaries are
identical to the reference implementation (:func:`_chunks_reference`).
"""
from __future__ import annotations

import hashlib
import json
import os

try:
    import numpy as np
except Exception:  # pragma: no cover - numpy is bundled with the app
    np = None

FORMAT = 1
ALGORITHM = "ogranka-cdc-1"
MIN_CHUNK = 16 * 1024
AVG_BITS = 16
MAX_CHUNK = 512 * 1024
MASK64 = (1 << 64) - 1
AVG_MASK = (1 << AVG_BITS) - 1
_BLOCK = 1 << 22


def _gear_table():
    values = []
    value = 0x9E3779B97F4A7C15
    for _ in range(256):
        value = (value * 6364136223846793005 + 1442695040888963407) & MASK64
        values.append(value)
    return values


GEAR = _gear_table()


def _chunks_reference(data):
    """Byte-by-byte reference implementation (slow, kept for verification)."""
    start = 0
    rolling = 0
    for index, value in enumerate(data):
        rolling = ((rolling << 1) + GEAR[value]) & MASK64
        length = index - start + 1
        if length >= MIN_CHUNK and ((rolling & AVG_MASK) == 0 or length >= MAX_CHUNK):
            yield start, length
            start = index + 1
            rolling = 0
    if start < len(data):
        yield start, len(data) - start


def _zero_hash_positions(data):
    """Positions whose low-bit gear hash over the last ``AVG_BITS`` bytes is zero."""
    arr = np.frombuffer(data, dtype=np.uint8)
    low = np.array([g & AVG_MASK for g in GEAR], dtype=np.uint32)
    found = []
    first = AVG_BITS - 1
    for begin in range(first, len(arr), _BLOCK):
        end = min(len(arr), begin + _BLOCK)
        acc = np.zeros(end - begin, dtype=np.uint32)
        for shift in range(AVG_BITS):
            acc += low[arr[begin - shift:end - shift]] << np.uint32(shift)
        found.append(np.flatnonzero((acc & AVG_MASK) == 0) + begin)
    return np.concatenate(found) if found else np.zeros(0, dtype=np.int64)


def chunks(data):
    """Yield ``(offset, length)`` of content-defined chunks of ``data``."""
    if np is None:
        yield from _chunks_reference(data)
        return
    total = len(data)
    if total == 0:
        return
    marks = _zero_hash_positions(data)
    start = 0
    while start < total:
        lowest = start + MIN_CHUNK - 1
        if lowest >= total:
            break
        highest = start + MAX_CHUNK - 1
        k = int(np.searchsorted(marks, lowest))
        if k < len(marks) and marks[k] <= highest:
            end = int(marks[k])
        elif highest < total:
            end = highest
        else:
            break
        yield start, end - start + 1
        start = end + 1
    if start < total:
        yield start, total - start


def manifest_for(path, asset_name=None):
    with open(path, "rb") as fh:
        data = fh.read()
    view = memoryview(data)
    chunks_data = [
        {
            "offset": offset,
            "length": length,
            "sha256": hashlib.sha256(view[offset:offset + length]).hexdigest(),
        }
        for offset, length in chunks(data)
    ]
    return {
        "format": FORMAT,
        "algorithm": ALGORITHM,
        "asset": asset_name or os.path.basename(path),
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "min_chunk": MIN_CHUNK,
        "avg_bits": AVG_BITS,
        "max_chunk": MAX_CHUNK,
        "chunks": chunks_data,
    }


def write_manifest(path, out_path=None, asset_name=None):
    out_path = out_path or (path + ".delta.json")
    manifest = manifest_for(path, asset_name=asset_name)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    return out_path


def _check_format(manifest):
    if manifest.get("format") != FORMAT or manifest.get("algorithm") != ALGORITHM:
        raise ValueError("Неизвестный формат дельта-манифеста.")


def load_manifest(path):
    with open(path, "r", encoding="utf-8") as fh:
        manifest = json.load(fh)
    _check_format(manifest)
    if not isinstance(manifest.get("chunks"), list):
        raise ValueError("В дельта-манифесте нет списка чанков.")
    return manifest


def reconstruct(old_path, manifest, fetch, out_path, progress=None):
    """Assemble the new file from reusable old chunks and fetched byte ranges."""
    _check_format(manifest)
    total = int(manifest.get("size") or 0)
    if total <= 0:
        raise ValueError("В дельта-манифесте неверный размер файла.")
    old_data = b""
    if old_path and os.path.isfile(old_path):
        with open(old_path, "rb") as fh:
            old_data = fh.read()
    old_view = memoryview(old_data)
    index = {}
    for offset, length in chunks(old_data):
        digest = hashlib.sha256(old_view[offset:offset + length]).hexdigest()
        index.setdefault((digest, length), offset)
    reused = 0
    downloaded = 0
    missing = []
    with open(out_path, "wb") as out:
        for item in manifest["chunks"]:
            offset = int(item["offset"])
            length = int(item["length"])
            digest = str(item["sha256"])
            if offset < 0 or length <= 0 or offset + length > total:
                raise ValueError("Дельта-манифест содержит неверный диапазон.")
            source = index.get((digest, length))
            if source is not None:
                out.seek(offset)
                out.write(old_view[source:source + length])
                reused += length
            else:
                missing.append((offset, length, digest))
        groups = []
        for offset, length, digest in missing:
            if groups and groups[-1][0] + groups[-1][1] == offset:
                start, size, items = groups[-1]
                items.append((digest, length))
                groups[-1] = (start, size + length, items)
            else:
                groups.append((offset, length, [(digest, length)]))
        for offset, length, items in groups:
            payload = fetch(offset, length)
            if not payload or len(payload) != length:
                raise RuntimeError("Сервер вернул неполный фрагмент обновления.")
            cursor = 0
            for digest, chunk_length in items:
                piece = payload[cursor:cursor + chunk_length]
                if hashlib.sha256(piece).hexdigest() != digest:
                    raise RuntimeError("Фрагмент дельта-обновления не совпал по хешу.")
                out.seek(offset + cursor)
                out.write(piece)
                cursor += chunk_length
                downloaded += chunk_length
            if progress:
                progress(reused + downloaded, total)
        out.truncate(total)
    if progress:
        progress(total, total)
    return {"reused": reused, "downloaded": downloaded}
