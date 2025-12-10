#!/bin/bash

echo "🔧 Starting CineLinks in Development Mode..."

# Function to cleanup on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    exit
}
trap cleanup EXIT INT TERM

# Start backend
echo "📡 Starting backend..."
cd backend
source venv/bin/activate
uvicorn main:app --reload --log-level debug &
BACKEND_PID=$!
cd ..

# Wait for backend
sleep 3

# Start frontend
echo "🌐 Starting frontend..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "✅ Development servers running!"
echo "   Backend:  http://localhost:8000"
echo "   Frontend: http://localhost:5173"
echo "   API Docs: http://localhost:8000/docs"
echo ""
echo "🔍 Watching for file changes..."
echo "Press Ctrl+C to stop"

# Keep script running
wait