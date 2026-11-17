"""Static file server with HTTP Range support (like GitHub Pages), used by the browser tests. Usage: serve.py PORT DIR

DuckDB in the browser reads Parquet files with Range requests, which Python's built-in server doesn't support.
"""
import http.server
import os
import re
import sys


class RangeHandler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        rng = self.headers.get("Range")
        path = self.translate_path(self.path)
        if not rng or not os.path.isfile(path):
            return super().send_head()
        m = re.match(r"bytes=(\d*)-(\d*)", rng)
        size = os.path.getsize(path)
        start = int(m.group(1)) if m.group(1) else size - int(m.group(2))
        end = int(m.group(2)) if m.group(1) and m.group(2) else size - 1
        end = min(end, size - 1)
        f = open(path, "rb")  # noqa: SIM115 - closed by the base class after copyfile
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self._remaining = end - start + 1
        return f

    def copyfile(self, src, dst):
        n = getattr(self, "_remaining", None)
        if n is None:
            return super().copyfile(src, dst)
        while n > 0:
            chunk = src.read(min(65536, n))
            if not chunk:
                break
            dst.write(chunk)
            n -= len(chunk)
        self._remaining = None

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def log_message(self, *args):          # keep test output quiet
        pass


if __name__ == "__main__":
    os.chdir(sys.argv[2])
    http.server.ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), RangeHandler).serve_forever()
