"""Run tests in a disposable PostgreSQL cluster, without touching installed services.

Usage: python scripts/test_postgres.py --bin "C:/Program Files/PostgreSQL/18/bin"
Requires installed PostgreSQL binaries; credentials are generated in memory.
"""
import argparse
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bin", required=True, type=Path)
    args = parser.parse_args()
    suffix = ".exe" if os.name == "nt" else ""
    def executable(name):
        return str(args.bin / (name + suffix))
    with tempfile.TemporaryDirectory(prefix="vascuai-pg-test-") as folder:
        root = Path(folder)
        password = secrets.token_hex(32)
        password_file = root / "password"
        password_file.write_text(password, encoding="utf-8")
        data = root / "data"
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        subprocess.run([executable("initdb"), "-D", str(data), "-U", "vascuai_test",
                        "--auth=scram-sha-256", "--encoding=UTF8", "--locale=C",
                        "--pwfile", str(password_file)], check=True, stdout=subprocess.DEVNULL)
        password_file.unlink()
        started = False
        try:
            subprocess.run([executable("pg_ctl"), "-D", str(data), "-l", str(root / "server.log"),
                            "-o", f"-h 127.0.0.1 -p {port}", "-w", "start"],
                           check=True, stdout=subprocess.DEVNULL)
            started = True
            environment = os.environ.copy()
            environment["PGPASSWORD"] = password
            subprocess.run([executable("createdb"), "-h", "127.0.0.1", "-p", str(port),
                            "-U", "vascuai_test", "vascuai_auth_test"], env=environment, check=True)
            environment.pop("PGPASSWORD")
            environment["TEST_DATABASE_URL"] = f"postgresql+psycopg://vascuai_test:{password}@127.0.0.1:{port}/vascuai_auth_test"
            print("Running integration tests against an isolated PostgreSQL cluster.", flush=True)
            result = subprocess.run([sys.executable, "-m", "pytest", "-q", "--cov=app", "--cov-report=term-missing"],
                                    env=environment)
            return result.returncode
        finally:
            if started:
                subprocess.run([executable("pg_ctl"), "-D", str(data), "-m", "fast", "-w", "stop"],
                               check=True, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    raise SystemExit(main())
