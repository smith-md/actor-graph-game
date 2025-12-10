# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**CineLinks** is a full-stack web application where players find connections between actors through movies they've appeared in (inspired by "Six Degrees of Kevin Bacon"). The architecture consists of:

- **Backend**: FastAPI Python server with game logic and graph algorithms
- **Frontend**: React + Vite single-page application
- **Data Pipeline**: Python scripts to fetch TMDb data and build an actor-movie graph

## Core Architecture

### How It Works

```
TMDb API
   ↓
build_actor_movie_graph.py (Data Pipeline)
   ↓
global_actor_movie_graph.gpickle (NetworkX Bipartite Graph)
   ↓
FastAPI Backend (game logic + REST API)
   ↓
React Frontend (UI + API client)
```

### Key Components

**Graph Structure**: A bipartite NetworkX graph with two node types:
- **Actor nodes**: Format `actor::tmdb_id::name` with attributes like `profile_path`
- **Movie nodes**: Format `movie::tmdb_id::title` with attributes like `poster_path`
- **Edges**: Connect actors to movies they appeared in

**Game Logic** (`backend/game_logic.py`):
- `MovieConnectionGame` class manages a single game instance
- Validates moves: movie must connect from current actor, actor must appear in that movie
- Tracks path, guesses, and win/loss states
- Default: 3 incorrect guesses allowed before losing

**Backend Server** (`backend/main.py`):
- Loads graph from pickled file on startup
- Manages game sessions in a `games` dict (keyed by `game_id`)
- Builds searchable indexes for actor/movie autocomplete
- Computes graph fingerprint for consistency checking
- Renders path visualization as base64-encoded matplotlib PNG

**Frontend** (`frontend/src/App.jsx`):
- Single React component with game state management
- Autocomplete for actors/movies via API
- Displays game visualization (path graph from backend)
- Shows movie posters from TMDb

### API Endpoints

All endpoints documented at `http://localhost:8000/docs` when backend is running.

Key endpoints:
- `GET /health` - Health check
- `GET /meta` - Graph statistics (node counts, checksum)
- `GET /start_game` - Initialize new game with random actor pair
- `POST /guess` - Submit actor-movie guess
- `GET /state` - Get current game state
- `GET /autocomplete/actors?q=...` - Search actors
- `GET /autocomplete/movies?q=...` - Search movies

## Development Commands

### Setup (One-time)

```bash
# Build the actor-movie graph from TMDb API
cd build
python -m venv venv
# Windows: .\venv\Scripts\Activate.ps1
# Unix: source venv/bin/activate
pip install -r requirements-build.txt

# Create .env with your TMDb API key
echo "TMDB_API_KEY=your_key_here" > .env

# Build graph (~8 minutes, ~4-5 MB file)
# --top 150 (default): ~150 actors, ~2,700 movies
# Adjust --top to change dataset size (100 for faster build, 200 for larger)
python build_actor_movie_graph.py --out ../backend/global_actor_movie_graph.gpickle --top 150

# Verify graph integrity (optional)
python verify_graph.py ../backend/global_actor_movie_graph.gpickle
```

```bash
# Install backend dependencies
cd backend
python -m venv venv
# Windows: .\venv\Scripts\Activate.ps1
# Unix: source venv/bin/activate
pip install -r requirements.txt
```

```bash
# Install frontend dependencies
cd frontend
npm install
echo "VITE_API_URL=http://localhost:8000" > .env
```

### Running

**Quick Start (Windows)**:
```bash
# Root directory
.\start.ps1
# Opens separate windows for backend and frontend
# Backend: http://localhost:8000
# Frontend: http://localhost:5173
```

**Quick Start (Unix/Linux/Mac)**:
```bash
# Root directory
./start-sh.sh
# Or for development mode with debug logging:
./dev-sh.sh
```

**Manual Start**:

Backend:
```bash
cd backend
.\venv\Scripts\Activate.ps1  # Windows
# source venv/bin/activate  # Unix
uvicorn main:app --reload
# Runs on http://localhost:8000
# Docs: http://localhost:8000/docs
```

Frontend:
```bash
cd frontend
npm run dev
# Runs on http://localhost:5173
```

### Building for Production

```bash
# Frontend
cd frontend
npm run build
# Output in dist/

# Backend
# No special build step; deploy using uvicorn or gunicorn
# In production, set environment variables:
# - CINELINKS_GRAPH_PATH (path to graph file)
# - Update CORS origins from "*" to specific domains
```

### Testing & Debugging

```bash
# Backend API documentation (when running)
# Interactive: http://localhost:8000/docs
# ReDoc:      http://localhost:8000/redoc

# Get graph metadata
curl http://localhost:8000/meta

# Check backend is healthy
curl http://localhost:8000/health

# Search actors
curl "http://localhost:8000/autocomplete/actors?q=tom"

# Start a game
curl http://localhost:8000/start_game
```

### Code Organization

**Backend** (`backend/`):
- `main.py` - FastAPI app, endpoints, graph loading, session management
- `game_logic.py` - `MovieConnectionGame` class with validation logic
- `cinelinks_meta.py` - Metadata/verification utility
- `global_actor_movie_graph.gpickle` - Pre-built graph (loaded on startup)
- `venv/` - Python virtual environment

**Frontend** (`frontend/`):
- `src/App.jsx` - All UI logic (state, API calls, rendering)
- `src/main.jsx` - React entry point
- `src/index.css` - Global styles (note: README mentions Tailwind but not currently used)
- `vite.config.js` - Build tool configuration
- `.env` - API URL configuration

**Build** (`build/`):
- `build_actor_movie_graph.py` - Fetches TMDb data, constructs graph
- `verify_graph.py` - Validates graph integrity
- `requirements-build.txt` - Build-only dependencies
- `tmdb_cache/` - Cached API responses for offline/reproducible builds
- `.env` - TMDb API credentials

## Key Implementation Details

### Graph Loading & Initialization

Backend loads graph once at startup (`main.py` startup event):
1. Load pickled NetworkX graph from disk
2. Build actor/movie indexes (sorted lists with normalized names)
3. Create lookup maps for fast autocomplete queries
4. Compute graph fingerprint for integrity checking

**Environment Variable**: `CINELINKS_GRAPH_PATH` (defaults to `global_actor_movie_graph.gpickle`)

### Name Normalization

Uses Unicode NFKD normalization + ASCII encoding for case/diacritic-insensitive autocomplete:
```python
def norm(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii").lower().strip()
```

This handles accents (é → e), case differences, and whitespace.

### Game Move Validation

When a player guesses a movie and actor:
1. Resolve movie name to candidate nodes using normalized lookup
2. Check if any candidate movie is a neighbor of current actor
3. Resolve actor name to candidate nodes
4. Check if any candidate actor is in the selected movie
5. If both checks pass, move current position and extend path
6. Check if reached target actor (win condition)

Invalid guesses increment incorrect counter; 3 incorrect = game over.

### Visualization

Backend generates path graph visualization:
- Uses matplotlib to render subgraph of actors/movies on the path
- Encodes as base64 PNG
- Frontend displays as inline image data URI

## Configuration & Customization

**Graph Size** (`build/build_actor_movie_graph.py --top N`):
- `--top 150` (default): ~150 actors, 2,700 movies, 8 minutes to build
- `--top 100`: Smaller/faster (5-6 minutes)
- `--top 200`: Larger/more variety (10+ minutes)

**Game Difficulty** (edit `backend/main.py`, search for `MovieConnectionGame`):
- `max_incorrect_guesses=3` (default)
- Change to 1 for hard mode, 5+ for easier mode

**Increase Actor Dataset** (`build_actor_movie_graph.py`):
- Edit `PAGES` constant to fetch more popular actors
- Default is 8 pages × 20 actors = ~150 actors
- More pages = more build time and larger file

**CORS** (`backend/main.py`):
- Currently allows all origins (`allow_origins=["*"]`)
- In production, restrict to specific domains

## Important Files to Know

- **`backend/main.py`**: All backend logic - modify here for new endpoints, game rules, API behavior
- **`backend/game_logic.py`**: Game move validation - modify here to change how moves are validated
- **`frontend/src/App.jsx`**: All UI - modify for visual changes, new features, layout
- **`build/build_actor_movie_graph.py`**: Graph construction - modify for different data sources or dataset sizes
- **`cinelinks-readme.md`**, **`cinelinks-api.md`**, **`cinelinks-game-rules.md`**: Project documentation with detailed info

## Dependencies Summary

**Backend** (`backend/requirements.txt`):
- `fastapi==0.115.0` - Web framework
- `uvicorn==0.30.3` - ASGI server
- `networkx==3.3` - Graph algorithms
- `matplotlib==3.9.2` - Visualization
- `pydantic==2.8.2` - Data validation
- `requests==2.32.3` - HTTP client
- `python-multipart==0.0.9` - Form parsing

**Frontend** (`frontend/package.json`):
- `react==18.3.1` - UI framework
- `react-dom==18.3.1` - DOM rendering
- `vite==5.3.3` - Build tool (dev only)
- `@vitejs/plugin-react==4.3.1` - React support (dev only)

**Build** (`build/requirements-build.txt`):
- `requests` - Fetch TMDb API
- `tqdm` - Progress bars
- `pandas` - Data manipulation
- `networkx` - Graph construction
- `python-dotenv` - Load .env files

## Common Tasks

**Add a new API endpoint**:
1. Define request/response Pydantic models in `backend/main.py`
2. Write endpoint function with `@app.get()` or `@app.post()` decorator
3. Use `GRAPH`, `ACTOR_INDEX`, `MOVIE_INDEX` globals as needed
4. Frontend can call via `fetch(VITE_API_URL + '/endpoint')`

**Change game rules** (e.g., incorrect guess limit):
1. Edit `backend/main.py` - find `MovieConnectionGame` instantiation
2. Change `max_incorrect_guesses` parameter
3. Or edit `backend/game_logic.py` - modify `guess()` validation logic

**Rebuild the graph** (e.g., after changing data sources):
1. Update `build/build_actor_movie_graph.py` as needed
2. Run: `python build_actor_movie_graph.py --out ../backend/global_actor_movie_graph.gpickle --top 150`
3. Backend will reload graph on next restart (or poll for changes)

**Add UI features** (autocomplete, animations, etc.):
1. Edit `frontend/src/App.jsx`
2. Add useState hooks for state management
3. Add fetch calls to new/existing API endpoints
4. Update JSX rendering as needed

**Debug game logic**:
1. Check `backend/main.py` - verify game state is correct
2. Check `backend/game_logic.py` - verify move validation logic
3. Use FastAPI docs (`http://localhost:8000/docs`) to test endpoints
4. Check console for Python errors (uvicorn output)
