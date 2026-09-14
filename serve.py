"""Dev server: static files with caching disabled, so edited ES modules
reload without stale-cache surprises. Not used in production (GitHub Pages)."""
import functools
import os
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCache(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    handler = functools.partial(NoCache, directory=ROOT)
    ThreadingHTTPServer(("", port), handler).serve_forever()
