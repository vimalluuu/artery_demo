"""Route-scoped total-body admission control, before FastAPI multipart parsing."""
from starlette.responses import JSONResponse

MAX_EVALUATION_FILE_BYTES = 2 * 1024 * 1024
MAX_EVALUATION_BODY_BYTES = MAX_EVALUATION_FILE_BYTES + 64 * 1024


class EvaluationUploadBodyLimit:
    def __init__(self, app, *, path):
        self.app = app
        self.path = path

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        root = scope.get("root_path", "")
        if root and path.startswith(root + "/"):
            path = path[len(root):]
        if scope["type"] != "http" or scope.get("method") != "POST" or path.rstrip("/") != self.path:
            return await self.app(scope, receive, send)

        async def reject(status, detail):
            await JSONResponse({"detail": detail}, status_code=status,
                headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})(scope, receive, send)

        lengths = [value for key, value in scope.get("headers", []) if key.lower() == b"content-length"]
        if lengths:
            if len(lengths) != 1 or not lengths[0].isdigit():
                return await reject(400, "Invalid Content-Length")
            declared = lengths[0].lstrip(b"0") or b"0"
            bound = str(MAX_EVALUATION_BODY_BYTES).encode()
            if len(declared) > len(bound) or (len(declared) == len(bound) and declared > bound):
                return await reject(413, "Evaluation upload body exceeds 2112 KiB (2 MiB JSON plus 64 KiB framing)")

        # Nothing reaches the multipart parser until the COMPLETE body passes
        # this byte limit. Content-Length is only an early optimization.
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > MAX_EVALUATION_BODY_BYTES:
                return await reject(413, "Evaluation upload body exceeds 2112 KiB (2 MiB JSON plus 64 KiB framing)")
            # Do not retain per-chunk dictionaries: many tiny/empty chunks
            # must not turn a bounded body into an unbounded message buffer.
            body.extend(chunk)
            if not message.get("more_body", False):
                break
        iterator = iter([{"type": "http.request", "body": bytes(body), "more_body": False}])

        async def replay():
            message = next(iterator, None)
            return message if message is not None else await receive()

        await self.app(scope, replay, send)
