import http from 'http';
import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 5511;

// Use relative paths or absolute based on current directory
const CSV_PATH = path.join(__dirname, 'Directtext_dush_kab.csv');
const HTML_PATH = path.join(__dirname, 'index.html');

const events = new EventEmitter();

// Watch the CSV file for changes
if (fs.existsSync(CSV_PATH)) {
    fs.watch(CSV_PATH, (eventType) => {
        if (eventType === 'change') {
            console.log('CSV file changed, notifying clients...');
            events.emit('update');
        }
    });
}

const server = http.createServer((req, res) => {
    if (req.url === '/') {
        fs.readFile(HTML_PATH, (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading index.html');
                return;
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    } else if (req.url === '/data') {
        fs.readFile(CSV_PATH, (err, data) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading CSV');
                return;
            }
            res.writeHead(200, {
                'Content-Type': 'text/csv; charset=utf-8',
                'Cache-Control': 'no-cache'
            });
            res.end(data);
        });
    } else if (req.url === '/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        const onUpdate = () => {
            res.write('data: update\n\n');
        };

        events.on('update', onUpdate);

        req.on('close', () => {
            events.off('update', onUpdate);
        });
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
});

server.on('error', (err) => {
    console.error('Server error:', err);
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`Server running at http://127.0.0.1:${PORT}`);
    console.log(`Watching file: ${CSV_PATH}`);
});
