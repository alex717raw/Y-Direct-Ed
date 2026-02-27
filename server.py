import http.server
import socketserver
import os

PORT = 5511

# Get directory of the current script
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
HTML_PATH = os.path.join(BASE_DIR, "index.html")

class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # Default to index.html for root
        if self.path == '/':
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            with open(HTML_PATH, 'rb') as f:
                self.wfile.write(f.read())
        elif self.path == '/data':
            # This is a placeholder since the client usually selects the file manually
            csv_path = os.path.join(BASE_DIR, "Directtext_dush_kab.csv")
            if os.path.exists(csv_path):
                self.send_response(200)
                self.send_header('Content-type', 'text/csv; charset=utf-8')
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                with open(csv_path, 'rb') as f:
                    self.wfile.write(f.read())
            else:
                self.send_error(404, "Default CSV not found")
        elif self.path == '/events':
            self.send_error(404)
        else:
            original_cwd = os.getcwd()
            os.chdir(BASE_DIR)
            try:
                super().do_GET()
            finally:
                os.chdir(original_cwd)

if __name__ == "__main__":
    try:
        with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
            print(f"Serving at http://127.0.0.1:{PORT}")
            print(f"Base Directory: {BASE_DIR}")
            httpd.serve_forever()
    except Exception as e:
        print(f"Failed to start server: {e}")
