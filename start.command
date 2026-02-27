#!/bin/bash
cd "$(dirname "$0")"
echo "Starting Direct Editor Server..."
# Try to run node server, or fallback to python
if command -v node &> /dev/null
then
    (sleep 1 && open http://127.0.0.1:5511) &
    node server.mjs
else
    (sleep 1 && open http://127.0.0.1:5511) &
    python3 server.py
fi
