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
build_actor_actor_graph.py (Data Pipeline)
   ↓
global_actor_actor_graph.gpickle (NetworkX Actor-Actor Graph)
   ↓
FastAPI Backend (game logic + REST API)
   ↓
React Frontend (UI + API client)
```

### Key Components

**Graph Structure**: An actor-actor NetworkX graph where:
- **Nodes**: Actors (format `actor_{tmdb_id}`) with attributes like `name`, `profile_path`, `in_playable_graph`, `in_starting_pool`
- **Edges**: Connect actors who appeared in the same movie
- **Edge metadata**: Contains list of movies the actors co-starred in with movie details (title, poster, popularity, vote_count)
- **Actor-Movie Index**: Separate pickle file (`global_actor_actor_graph_actor_movie_index.pickle`) maps actors to their movies for autocomplete

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
# Install backend dependencies (used for both backend AND build)
cd backend
python -m venv venv
# Windows: .\venv\Scripts\Activate.ps1
# Unix: source venv/bin/activate
pip install -r requirements.txt
```

```bash
# Create .env for TMDb API access
cd build
echo "TMDB_API_KEY=your_key_here" > .env

# Build the actor-actor graph from TMDb API
# Uses backend venv (consolidated setup)
cd build
..\backend\venv\Scripts\Activate.ps1  # Windows
# source ../backend/venv/bin/activate  # Unix

# Build graph (first run: ~10-15 minutes with API calls, subsequent runs: seconds with cache)
# --min-votes 100: Fetch movies with 100+ votes (cast to larger pool)
# --max-pages 100: Fetch up to 100 pages of popular movies
python build_actor_actor_graph.py --out ../backend/global_actor_actor_graph.gpickle --min-votes 100 --max-pages 100

# The build creates two files:
# - global_actor_actor_graph.gpickle (the graph)
# - global_actor_actor_graph_actor_movie_index.pickle (actor-movie index for autocomplete)
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
- `build_actor_actor_graph.py` - Fetches TMDb data, constructs actor-actor graph
- `list_actors_by_popularity.py` - Utility to list top actors
- `tmdb_cache/` - Cached API responses (movie credits, details, actor credits) for fast rebuilds
- `.env` - TMDb API credentials
- Note: Uses backend venv (no separate venv required)

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

**Movie Vote Threshold** (`build/build_actor_actor_graph.py` line 442):
- `MIN_VOTE_COUNT = 3000` (current): Includes moderately popular movies for more interesting pathways
- Increase to 10000 for only blockbuster movies (easier, more recognizable)
- Decrease to 1000-2000 for more obscure indie films (harder, more diverse)
- This filters which movies count toward actor selection and graph building

**Graph Size** (`build/build_actor_actor_graph.py --min-votes N --max-pages N`):
- `--min-votes 100 --max-pages 100` (default): Fetches movies with 100+ votes from up to 100 pages
- Decrease pages for smaller dataset (faster build)
- Increase pages for larger variety (more actors/movies)
- First build: 10-15 minutes (API calls), subsequent builds: seconds (uses cache)

**Caching** (`build/tmdb_cache/`):
- Movie credits and details are cached automatically
- Delete cache files to force refresh from TMDb API
- Cache makes rebuilds instant when tweaking MIN_VOTE_COUNT or other processing parameters
- Pass `--refresh-cache` to force re-fetch from API

**Game Difficulty** (edit `backend/main.py`, search for `MovieConnectionGame`):
- `max_incorrect_guesses=3` (default)
- Change to 1 for hard mode, 5+ for easier mode

**CORS** (`backend/main.py`):
- Currently allows all origins (`allow_origins=["*"]`)
- In production, restrict to specific domains

## Important Files to Know

- **`backend/main.py`**: All backend logic - modify here for new endpoints, game rules, API behavior
- **`backend/game_logic.py`**: Game move validation - modify here to change how moves are validated
- **`backend/daily_puzzle.py`**: Daily puzzle generation with 20-day actor exclusion
- **`frontend/src/App.jsx`**: All UI - modify for visual changes, new features, layout
- **`build/build_actor_actor_graph.py`**: Graph construction - modify MIN_VOTE_COUNT (line 442) to adjust movie inclusion threshold
- **`cinelinks-readme.md`**, **`cinelinks-api.md`**, **`cinelinks-game-rules.md`**: Project documentation with detailed info

## Dependencies Summary

**Backend** (`backend/requirements.txt`) - Consolidated for both backend and build:
- `fastapi==0.128.0` - Web framework
- `uvicorn==0.40.0` - ASGI server
- `networkx==3.6.1` - Graph algorithms
- `matplotlib==3.10.8` - Visualization
- `pydantic==2.12.5` - Data validation
- `requests==2.32.5` - HTTP client
- `python-multipart==0.0.21` - Form parsing
- `pandas==2.3.3` - Data manipulation (for build)
- `tqdm==4.67.1` - Progress bars (for build)
- `python-dotenv==1.2.1` - Load .env files (for build)

**Frontend** (`frontend/package.json`):
- `react==18.3.1` - UI framework
- `react-dom==18.3.1` - DOM rendering
- `vite==5.3.3` - Build tool (dev only)
- `@vitejs/plugin-react==4.3.1` - React support (dev only)

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

**Rebuild the graph** (e.g., after changing MIN_VOTE_COUNT or other parameters):
1. Update `build/build_actor_actor_graph.py` as needed (e.g., change MIN_VOTE_COUNT on line 442)
2. Activate backend venv: `cd build && ..\backend\venv\Scripts\Activate.ps1`
3. Run: `python build_actor_actor_graph.py --out ../backend/global_actor_actor_graph.gpickle`
4. First run fetches from API (~10-15 min), subsequent runs use cache (seconds)
5. Backend will reload graph on next restart

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
