FROM python:3.14-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/requirements.txt backend/requirements-model.txt ./
ARG INSTALL_MODEL=false
# Validate every fixture target before deleting; keep installation and cleanup in one layer.
RUN <<'INSTALL'
set -eu
pip install --no-cache-dir -r requirements.txt
python - <<'PY'
"""Validate the complete dependency-fixture plan before deleting any payload."""
from importlib import metadata, util
from pathlib import Path
import shutil
import stat


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def inspected(path):
    try:
        return path.lstat()
    except OSError as error:
        raise RuntimeError(f"Cannot inspect expected path: {path}") from error


def resolved(path):
    try:
        return path.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise RuntimeError(f"Cannot resolve expected path: {path}") from error


def validate_child(path, root, *, directory):
    root_mode = inspected(root).st_mode
    require(stat.S_ISDIR(root_mode) and not stat.S_ISLNK(root_mode),
            f"Package root must be a real directory: {root}")
    anchor = resolved(root)
    try:
        relative = path.relative_to(root)
    except ValueError as error:
        raise RuntimeError(f"Path is outside its package root: {path}") from error
    require(bool(relative.parts) and ".." not in relative.parts,
            f"Deletion/inspection target must be below its package root: {path}")
    current = root
    for index, part in enumerate(relative.parts):
        current = current / part
        mode = inspected(current).st_mode
        require(not stat.S_ISLNK(mode), f"Symlink is not allowed: {current}")
        want_directory = index < len(relative.parts) - 1 or directory
        require(stat.S_ISDIR(mode) if want_directory else stat.S_ISREG(mode),
                f"Unexpected path type: {current}")
        canonical = resolved(current)
        require(canonical != anchor and canonical.is_relative_to(anchor),
                f"Resolved path is outside its package root: {current}")
    return current


def package_root(module):
    spec = util.find_spec(module)
    require(spec is not None and bool(spec.origin), f"Missing package origin: {module}")
    origin = Path(spec.origin)
    require(origin.is_absolute(), f"Package origin must be absolute: {module}")
    root = origin.parent
    require(root.name == module, f"Unexpected package root: {module}")
    validate_child(origin, root, directory=False)
    return root


def children(directory):
    try:
        return sorted(directory.iterdir())
    except OSError as error:
        raise RuntimeError(f"Cannot enumerate expected directory: {directory}") from error


def validate_tree(directory, root):
    validate_child(directory, root, directory=True)
    for child in children(directory):
        mode = inspected(child).st_mode
        require(not stat.S_ISLNK(mode), f"Symlink is not allowed: {child}")
        if stat.S_ISDIR(mode):
            validate_tree(child, root)
        else:
            validate_child(child, root, directory=False)


def validated_plan():
    for package, expected in (("nibabel", "5.4.2"), ("scikit-image", "0.26.0")):
        actual = metadata.version(package)
        require(actual == expected, f"Unexpected {package} version: {actual}")
    nib = package_root("nibabel")
    sk = package_root("skimage")
    directories = tuple(nib / name for name in (
        "tests/data", "nicom/tests/data", "gifti/tests/data", "externals/tests/data"
    ))
    for directory in directories:
        validate_tree(directory, nib)
    data = sk / "data"
    validate_child(data, sk, directory=True)
    assets = []
    for entry in children(data):
        mode = inspected(entry).st_mode
        require(not stat.S_ISLNK(mode), f"Symlink is not allowed: {entry}")
        if entry.name == "__pycache__":
            require(stat.S_ISDIR(mode), f"Bytecode cache must be a directory: {entry}")
            validate_tree(entry, sk)
            continue
        require(not stat.S_ISDIR(mode), f"Unexpected example-data directory: {entry}")
        validate_child(entry, sk, directory=False)
        if (entry.suffix.lower() not in (".py", ".pyi", ".pyc", ".txt", ".md", ".rst")
                and not entry.name.upper().startswith(("LICENSE", "COPYING", "README"))):
            assets.append(entry)
    require(bool(assets), "Expected bundled scikit-image example payloads are missing")
    return directories, tuple(assets)


def main():
    # Phase 1 validates all versions, roots, descendants and targets without writes.
    directories, assets = validated_plan()
    # Phase 2 starts only after the entire plan has passed validation.
    for directory in directories:
        shutil.rmtree(directory)
    for asset in assets:
        asset.unlink()
    print("Excluded dependency fixture payloads; runtime modules and metadata retained")


if __name__ == "__main__":
    main()
PY
groupadd --gid 10001 vascuai
useradd --uid 10001 --gid 10001 --no-create-home vascuai
mkdir -p /data/uploads /data/outputs
chown -R 10001:10001 /data
INSTALL
RUN if [ "$INSTALL_MODEL" = "true" ]; then pip install --no-cache-dir -r requirements-model.txt --index-url https://download.pytorch.org/whl/cpu; fi
COPY backend/app/ ./app/
COPY backend/migrations/ ./migrations/
COPY backend/alembic.ini ./
USER 10001:10001
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
