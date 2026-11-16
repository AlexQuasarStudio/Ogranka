"""Content-defined chunks for delta updates of release assets."""
import hashlib
import json
import os

FORMAT = 1
ALGORITHM = "ogranka-cdc-1"
MIN_CHUNK = 16 * 1024
AVG_BITS = 16
MAX_CHUNK = 512 * 1024
MASK64 = (1 << 64) - 1
AVG_MASK = (1 << AVG_BITS) - 1


def _gear_table():
    values = []
    value = 0x9E3779B97F4A7C15
    for _ in range(256):
        value = (value * 6364136223846793005 + 1442695040888963407) & MASK64
        values.append(value)
    return values


GEAR = _gear_table()


def chunks(data):
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


def manifest_for(path, asset_name=None):
    with open(path, "rb") as fh:
        data = fh.read()
    chunks_data = []
    for offset, length in chunks(data):
        chunk = data[offset:offset + length]
        chunks_data.append(
            {
                "offset": offset,
                "length": length,
                "sha256": hashlib.sha256(chunk).hexdigest(),
            }
        )
    manifest = {
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
    return manifest


def write_manifest(path, out_path=None, asset_name=None):
    out_path = out_path or (path + ".delta.json")
    manifest = manifest_for(path, asset_name=asset_name)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    return out_path


def load_manifest(path):
    with open(path, "r", encoding="utf-8") as fh:
        manifest = json.load(fh)
    if manifest.get("format") != FORMAT or manifest.get("algorithm") != ALGORITHM:
        raise ValueError("Неизвестный формат дельта-манифеста.")
    if not isinstance(manifest.get("chunks"), list):
        raise ValueError("В дельта-манифесте нет списка чанков.")
    return manifest


def reconstruct(old_path, manifest, fetch, out_path, progress=None):
    if manifest.get("format") != FORMAT or manifest.get("algorithm") != ALGORITHM:
        raise ValueError("Неизвестный формат дельта-манифеста.")
    total = int(manifest.get("size") or 0)
    if total <= 0:
        raise ValueError("В дельта-манифесте неверный размер файла.")
    old_data = b""
    if old_path and os.path.isfile(old_path):
        with open(old_path, "rb") as fh:
            old_data = fh.read()
    index = {}
    for offset, length in chunks(old_data):
        digest = hashlib.sha256(old_data[offset:offset + length]).hexdigest()
        index.setdefault(digest, []).append((offset, length))
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
            candidate = None
            for old_offset, old_length in index.get(digest, []):
                if old_length == length:
                    candidate = (old_offset, old_length)
                    break
            if candidate is not None:
                out.seek(offset)
                out.write(old_data[candidate[0]:candidate[0] + candidate[1]])
                reused += length
            else:
                missing.append((offset, length, digest))
        groups = []
        for offset, length, digest in missing:
            if groups and groups[-1][0] + groups[-1][1] == offset:
                groups[-1] = (
                    groups[-1][0],
                    groups[-1][1] + length,
                    groups[-1][2] + [(digest, length)],
                )
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
    return {"reused": reused, "downloaded": downloaded}
