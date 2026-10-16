"""Exercise the checked-in nginx routes using a built SPA and a disposable API.

Usage: python deploy/verify_routing.py --nginx /path/to/nginx
No application database, account, or uploaded study is accessed.
"""
import argparse
from contextlib import ExitStack
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class ProbeAPI(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/health":
            body, status = {"status": "healthy"}, 200
        elif self.path == "/health/ready":
            body, status = {"status": "ready"}, 200
        elif self.path.startswith("/api/v1/cases"):
            body, status = {"path": self.path, "authorization": self.headers.get("Authorization")}, 200
        elif self.path == "/api/v1/unavailable":
            body, status = {"detail": "Service unavailable"}, 503
        else:
            body, status = {"detail": "Not found"}, 404
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_POST(self):
        # Consume a small multipart probe; production volumes are never involved.
        size = int(self.headers.get("Content-Length", "0"))
        payload = self.rfile.read(size)
        body = json.dumps({"path": self.path, "size": len(payload), "contains_probe": b"synthetic-probe" in payload}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def stop_process(process):
    if process.poll() is None:
        process.terminate()
        process.wait(timeout=10)


def verify(executable: Path):
    repo = Path(__file__).resolve().parents[1]
    dist = repo / "frontend-react/dist"
    assert (dist / "index.html").is_file(), "Run npm run build in frontend-react first."
    upstream = ThreadingHTTPServer(("127.0.0.1", 0), ProbeAPI)
    thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    thread.start()
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    process = None
    try:
        with tempfile.TemporaryDirectory(prefix="vascuai-routing-") as folder, ExitStack() as processes:
            root = Path(folder).resolve()
            assert root.parent == Path(tempfile.gettempdir()).resolve()
            (root / "logs").mkdir()
            (root / "temp").mkdir()
            server = (repo / "deploy/nginx.conf").read_text()
            server = server.replace("listen 8080;", f"listen 127.0.0.1:{port};")
            server = server.replace("http://api:8000", f"http://127.0.0.1:{upstream.server_port}")
            server = server.replace("root /usr/share/nginx/html;", f'root "{dist.as_posix()}";')
            mime = executable.parent / "conf/mime.types"
            mime_line = f'include "{mime.as_posix()}";' if mime.is_file() else ""
            config = f"pid logs/nginx.pid;\nerror_log logs/error.log;\nevents {{}}\nhttp {{ {mime_line}\n{server}\n}}"
            (root / "nginx.conf").write_text(config)
            command = [str(executable), "-p", root.as_posix() + "/", "-c", "nginx.conf"]
            checked = subprocess.run(command + ["-t"], capture_output=True, text=True, creationflags=flags)
            assert checked.returncode == 0, checked.stderr
            process = subprocess.Popen(command + ["-g", "daemon off; master_process off;"], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, creationflags=flags)
            # Stop nginx before TemporaryDirectory removes its open log files,
            # including when an assertion fails on Windows.
            processes.callback(stop_process, process)
            base = f"http://127.0.0.1:{port}"
            deadline = time.monotonic() + 10
            while True:
                try:
                    with urlopen(base + "/health", timeout=1) as response:
                        assert json.load(response) == {"status": "healthy"}
                    break
                except URLError:
                    if process.poll() is not None or time.monotonic() > deadline:
                        raise RuntimeError("Disposable nginx did not start.")
                    time.sleep(.05)
            with urlopen(base + "/health/ready") as response:
                assert json.load(response) == {"status": "ready"}
            with urlopen(Request(base + "/api/v1/cases?limit=2", headers={"Authorization": "Bearer routing-test-token"})) as response:
                body = json.load(response)
                assert body == {"path": "/api/v1/cases?limit=2", "authorization": "Bearer routing-test-token"}
            for path, expected in [("/api/v1/missing", 404), ("/api/v1/unavailable", 503), ("/assets/missing.js", 404), ("/health/not-a-probe", 404)]:
                try:
                    urlopen(base + path)
                except HTTPError as error:
                    assert error.code == expected
                    assert b'<div id="root">' not in error.read()
                else:
                    raise AssertionError(f"Expected {expected} for {path}")
            with urlopen(base + "/dashboard") as response:
                assert response.read() == (dist / "index.html").read_bytes()
                assert response.headers.get("Cache-Control") == "no-store"
            javascript = next((dist / "assets").glob("index-*.js"))
            with urlopen(base + "/assets/" + javascript.name) as response:
                assert response.status == 200
                assert "immutable" in response.headers.get("Cache-Control", "")
            payload = b"--probe\r\nContent-Disposition: form-data; name=\"file\"; filename=\"probe.nii\"\r\n\r\nsynthetic-probe\r\n--probe--\r\n"
            with urlopen(Request(base + "/api/v1/cases/1/volume?probe=true", data=payload, headers={"Content-Type": "multipart/form-data; boundary=probe"}, method="POST")) as response:
                body = json.load(response)
                assert body == {"path": "/api/v1/cases/1/volume?probe=true", "size": len(payload), "contains_probe": True}
            print("PASS: nginx syntax, API prefix/query/auth, liveness, readiness, SPA refresh, asset caching, multipart forwarding, and 404/503 propagation.")
    finally:
        if process is not None:
            stop_process(process)
        upstream.shutdown()
        upstream.server_close()
        thread.join(timeout=5)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--nginx", type=Path, required=True)
    args = parser.parse_args()
    verify(args.nginx.resolve())
