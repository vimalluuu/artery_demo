"""Start a real Uvicorn server with a disposable SQLite test DB; run actual Axios calls."""
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory(prefix="vascuai-http-test-") as folder:
        root = Path(folder)
        env = os.environ.copy()
        env.update(SECRET_KEY=secrets.token_hex(32), TESTING="true",
                   DATABASE_URL="sqlite:///" + (root / "api.db").as_posix(),
                   UPLOAD_DIR=str(root / "uploads"), OUTPUT_DIR=str(root / "outputs"))
        subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=ROOT, env=env, check=True)
        seed = """
from app.database.session import SessionLocal
from app.models import User
from app.core.security import hash_password
with SessionLocal() as db:
    db.add(User(full_name="Contract Admin",email="contract-admin@example.org",
                password_hash=hash_password("contract-test-password-123"),role="Admin",is_active=True))
    db.commit()
"""
        subprocess.run([sys.executable, "-c", seed], cwd=ROOT, env=env, check=True)
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        env["VASCUAI_API_URL"] = f"http://127.0.0.1:{port}/api/v1"
        with (root / "server.log").open("w") as log:
            server = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app",
                                       "--host", "127.0.0.1", "--port", str(port)],
                                      cwd=ROOT, env=env, stdout=log, stderr=log)
            try:
                for _ in range(100):
                    if server.poll() is not None:
                        raise RuntimeError("Uvicorn failed to start")
                    try:
                        with urlopen(f"http://127.0.0.1:{port}/health/ready", timeout=1) as response:
                            if response.status == 200:
                                break
                    except OSError:
                        time.sleep(0.1)
                else:
                    raise RuntimeError("Uvicorn readiness timed out")
                return subprocess.run(["node", "--test", "tests/auth-live.test.js"],
                                      cwd=ROOT.parent / "frontend-react", env=env).returncode
            finally:
                if os.name == "nt":
                    # The Windows venv launcher can spawn a child interpreter.
                    subprocess.run(["taskkill", "/PID", str(server.pid), "/T", "/F"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else:
                    server.terminate()
                server.wait(timeout=10)


if __name__ == "__main__":
    raise SystemExit(main())
