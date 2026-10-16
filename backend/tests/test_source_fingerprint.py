import hashlib
import os

import pytest

from app.services import source_fingerprint as fingerprints


def test_content_hash_cache_tracks_file_versions(tmp_path, monkeypatch):
    path = tmp_path / "input.nii"
    path.write_bytes(b"volume-A")
    read = fingerprints._read_digest
    calls = []
    def count(path, version):
        calls.append(version)
        return read(path, version)
    monkeypatch.setattr(fingerprints, "_read_digest", count)
    first = fingerprints.source_sha256(path)
    assert first == hashlib.sha256(b"volume-A").hexdigest()
    assert fingerprints.source_sha256(path) == first
    assert len(calls) == 1
    before = path.stat()
    path.write_bytes(b"volume-B")
    os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns + 1_000_000))
    assert fingerprints.source_sha256(path) == hashlib.sha256(b"volume-B").hexdigest()
    assert len(calls) == 2
    # Touching the same content rechecks the checksum but does not make it stale.
    os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns + 2_000_000))
    assert fingerprints.source_sha256(path) == hashlib.sha256(b"volume-B").hexdigest()
    assert len(calls) == 3


def test_checksum_does_not_accept_changed_version(tmp_path):
    path = tmp_path / "input.nii"
    path.write_bytes(b"first")
    version = fingerprints.file_version(path)
    path.write_bytes(b"a different length")
    with pytest.raises(fingerprints.SourceChangedError):
        fingerprints._read_digest(str(path), version)


def test_replacement_with_restored_size_and_mtime_invalidates_cache(tmp_path):
    path = tmp_path / "input.nii"
    path.write_bytes(b"original")
    first = fingerprints.source_sha256(path)
    before = path.stat()
    replacement = tmp_path / "replacement.nii"
    replacement.write_bytes(b"modified")
    os.utime(replacement, ns=(before.st_atime_ns, before.st_mtime_ns))
    replacement.replace(path)
    assert fingerprints.source_sha256(path) != first


def test_missing_or_nonregular_sources_are_not_cached_as_valid(tmp_path):
    with pytest.raises(OSError):
        fingerprints.source_sha256(tmp_path / "missing.nii")
    with pytest.raises(OSError):
        fingerprints.source_sha256(tmp_path)
