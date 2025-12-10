#!/bin/bash

echo "🛑 Stopping CineLinks..."

# Kill processes on ports 8000 and 5173
echo "Stopping backend (port 8000)..."
lsof -ti:8000 | xargs kill -9 2>/dev/null

echo "Stopping frontend (port 5173)..."
lsof -ti:5173 | xargs kill -9 2>/dev/null

echo "✅ CineLinks stopped!"