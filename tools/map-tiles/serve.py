# Tiny static server with HTTP Range support (python -m http.server has none; PMTiles needs byte ranges).
# usage: python3 serve.py [port]   (serves the current directory)
import http.server, os, re, sys
class H(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        rng = self.headers.get('Range'); path = self.translate_path(self.path)
        if not rng or not os.path.isfile(path): return super().send_head()
        m = re.match(r'bytes=(\d+)-(\d*)', rng); size = os.path.getsize(path)
        a = int(m.group(1)); b = min(int(m.group(2)) if m.group(2) else size - 1, size - 1)
        f = open(path, 'rb'); f.seek(a)
        self.send_response(206); self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Accept-Ranges', 'bytes'); self.send_header('Content-Range', f'bytes {a}-{b}/{size}')
        self.send_header('Content-Length', str(b - a + 1)); self.end_headers()
        self._left = b - a + 1; return f
    def copyfile(self, src, dst):
        if hasattr(self, '_left'): dst.write(src.read(self._left)); del self._left
        else: super().copyfile(src, dst)
    def log_message(self, *a): pass
port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
http.server.ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
