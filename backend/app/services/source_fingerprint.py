"""Content checksums cached by observable file version, independent of PyTorch.

The SHA-256 is persisted in inference metadata. This bounded process-local cache
only avoids rereading unchanged files; it is rebuilt after restart. Storage must
remain application-owned: stat metadata is not a tamper-proof integrity signal.
"""
from functools import lru_cache
import hashlib
import os
from pathlib import Path
import stat
from threading import RLock


class SourceChangedError(OSError):
    """A file was replaced or changed while its checksum was being calculated."""


_cache_lock = RLock()


def file_version(path: Path) -> tuple[int, ...]:
    # Use one stat mechanism consistently: Windows path stat and handle fstat
    # can report different ctime semantics. Opening here reads no volume bytes.
    with path.open("rb") as stream:
        info = os.fstat(stream.fileno())
    if not stat.S_ISREG(info.st_mode):
        raise OSError("Input is not a regular file")
    return _stat_version(info)


def _stat_version(info) -> tuple[int, ...]:
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _read_digest(path: str, version: tuple[int, ...]) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        if _stat_version(os.fstat(stream.fileno())) != version:
            raise SourceChangedError("Input changed before checksum calculation")
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
        if _stat_version(os.fstat(stream.fileno())) != version:
            raise SourceChangedError("Input changed during checksum calculation")
    if file_version(Path(path)) != version:
        raise SourceChangedError("Input was replaced during checksum calculation")
    return digest.hexdigest()


@lru_cache(maxsize=128)
def _digest_for_version(path: str, version: tuple[int, ...]) -> str:
    return _read_digest(path, version)


def source_sha256(path: Path) -> str:
    path = path.resolve()
    # Serialize cold misses so concurrent requests do not duplicate large reads.
    with _cache_lock:
        return _digest_for_version(str(path), file_version(path))
