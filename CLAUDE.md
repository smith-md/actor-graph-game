# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**CineLinks** is a full-stack web application where players find connections between actors through movies they've appeared in (inspired by "Six Degrees of Kevin Bacon"). The architecture consists of:

- **Backend**: FastAPI Python server with game logic and graph algorithms
- **Frontend**: React + Vite single-page application
- **Data Pipeline**: Python scripts to fetch TMDb data and build an actor-actor collaboration graph

## Core Architecture

### How It Works

```
TMDb API
   ↓
build_actor_actor_graph.py (Data Pipeline)
   ↓
global_actor_actor_graph.gpickle (NetworkX Actor-Actor Graph)
global_actor_actor_graph_actor_movie_index.pickle (Comprehensive Filmography Index)
   ↓
FastAPI Backend (game logic + REST API)
   ↓
React Frontend (UI + API client)
```

### Key Components

**Graph Structure**: Actor-actor collaboration graph with three-tier actor selection:

- **Nodes**: Actors only (format: `actor_{tmdb_id}`)
  - Attributes: `name`, `tmdb_id`, `image`, `profile_path`, centrality scores
  - Flags: `in_playable_graph` (1,000 actors), `in_starting_pool` (100 actors)
- **Edges**: Weighted connections between actors who worked together
  - Weight: `popularity / sqrt(cast_size)` per movie
  - Metadata: Up to 50 shared movies per edge (sorted by weight)
- **Comprehensive Index**: Separate pickle file with ALL actor filmographies
  - Validates movies beyond the 50-movie edge limit
  - Enables StartActorScore computation for starting pool selection

**Three-Tier Actor Selection**:
1. **Full Graph** (~9,720 actors): All actors from popular movies (vote threshold)
2. **Playable Pool** (1,000 actors): Top by centrality (70% degree + 30% betweenness)
3. **Starting Pool** (100 actors): Top by StartActorScore (prominence in high-visibility films)

Design philosophy: "Structure over popularity, measure once play many"

**Game Logic** (`backend/game_logic.py`):
- `MovieConnectionGame` class manages a single game instance
- Validates moves using comprehensive index: both actors must appear in the specified movie
- Path tracks actors only; movies stored in separate `movies_used` list
- Tracks guesses, remaining attempts, and win/loss states
- Default: 3 incorrect guesses allowed before losing

**Backend Server** (`backend/main.py`):
- Loads actor-actor graph AND comprehensive index from pickled files on startup
- Manages game sessions in a `games` dict (keyed by `game_id`)
- Builds searchable indexes for actor/movie autocomplete from graph + index
- Computes graph fingerprint for consistency checking
- Renders path visualization (actor-only) as base64-encoded matplotlib PNG

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
# Build the actor-actor graph from TMDb API
cd build
python -m venv venv
# Windows: .\venv\Scripts\Activate.ps1
# Unix: source venv/bin/activate
pip install -r requirements-build.txt

# Create .env with your TMDb API key
echo "TMDB_API_KEY=your_key_here" > .env

# Build actor-actor graph (~15 minutes, produces 3 files)
# Produces: graph (~11 MB), index (~1 MB), audit CSV
python build_actor_actor_graph.py \
  --out ../backend/global_actor_actor_graph.gpickle \
  --top 750 \        # Playable actors (centrality-based)
  --starting 100 \   # Starting pool (StartActorScore-based)
  --min-votes 100 \  # Movie quality threshold
  --max-pages 100    # ~2,000 movies to process

# Verify graph integrity (optional)
python verify_graph.py ../backend/global_actor_actor_graph.gpickle
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
- `global_actor_actor_graph.gpickle` - Pre-built actor-actor graph (loaded on startup)
- `global_actor_actor_graph_actor_movie_index.pickle` - Comprehensive filmography index
- `venv/` - Python virtual environment

**Frontend** (`frontend/`):
- `src/App.jsx` - All UI logic (state, API calls, rendering)
- `src/main.jsx` - React entry point
- `src/index.css` - Global styles (note: README mentions Tailwind but not currently used)
- `vite.config.js` - Build tool configuration
- `.env` - API URL configuration

**Build** (`build/`):
- `build_actor_actor_graph.py` - Fetches TMDb data, constructs actor-actor graph
- `verify_graph.py` - Validates graph integrity
- `requirements-build.txt` - Build-only dependencies
- `tmdb_cache/` - Cached API responses for offline/reproducible builds
- `.env` - TMDb API credentials
- **Deprecated**: `build_actor_movie_graph.py` (see `deprecated_bipartite_architecture/`)

## Key Implementation Details

### Graph Loading & Initialization

Backend loads graph and index once at startup (`main.py` module initialization):
1. Load pickled NetworkX actor-actor graph from disk
2. Load comprehensive actor-movie index from companion pickle file
3. Build actor/movie indexes for autocomplete (uses both graph + index)
4. Create lookup maps for fast autocomplete queries
5. Compute graph fingerprint for integrity checking

**Environment Variable**: `CINELINKS_GRAPH_PATH` (defaults to `global_actor_actor_graph.gpickle`)
**Index File**: Automatically loaded from `{GRAPH_PATH}_actor_movie_index.pickle`

### Name Normalization

Uses Unicode NFKD normalization + ASCII encoding for case/diacritic-insensitive autocomplete:
```python
def norm(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii").lower().strip()
```

This handles accents (é → e), case differences, and whitespace.

### Game Move Validation

When a player guesses a movie (by ID) and actor (by name):
1. Resolve actor name to candidate node IDs using normalized lookup
2. Check if current actor and candidate actor are neighbors (have an edge)
3. Validate movie using comprehensive index:
   - Extract TMDb IDs from node IDs (format: `actor_{tmdb_id}`)
   - Check if both actors appear in movie (filmography lookup from index)
   - Falls back to edge metadata if index unavailable
4. If all checks pass, move current position to new actor and add movie to path
5. Check if reached target actor (win condition)

**Why comprehensive index?** Edge metadata only stores top 50 movies between actors.
The index contains ALL filmographies, enabling validation of less popular shared movies.

Invalid guesses increment incorrect counter; 3 incorrect = game over.

### Visualization

Backend generates path graph visualization (actor-only):
- Uses matplotlib to render subgraph of actors on the current path
- Nodes are all actors (sky blue); edges show connections
- Optionally shows movie titles as edge labels (first 20 chars)
- Encodes as base64 PNG
- Frontend displays as inline image data URI

### Actor Selection Algorithms

**Three-Tier System** ensures both connectivity (playable pool) and recognizability (starting pool):

1. **Full Graph Construction** (~9,720 actors):
   - Fetch popular movies from TMDb (vote threshold: 100)
   - Extract all cast members
   - Build actor-actor edges for shared movies
   - Weight edges: `popularity / sqrt(cast_size)` per movie

2. **Playable Pool Selection** (1,000 actors):
   - **Centrality score** = 70% weighted degree + 30% betweenness centrality
   - Filters to actors with high graph connectivity
   - Ensures all actors are reachable from each other (full connectivity check)
   - Flagged with `in_playable_graph=True` in node attributes

3. **Starting Pool Selection** (100 actors):
   - **StartActorScore** = Σ (movie_exposure × movie_HHI) across actor's filmography
     - `movie_exposure` = popularity × sqrt(vote_count)
     - `movie_HHI` = Herfindahl-Hirschman Index (measures star power concentration)
   - Selects actors prominent in high-visibility films (not just total popularity)
   - Flagged with `in_starting_pool=True` in node attributes
   - See `global_actor_actor_graph_start_actor_audit.csv` for ranked list

**Why this approach?** "Structure over popularity, measure once play many":
- Centrality ensures playable graph has good connectivity for puzzle-solving
- StartActorScore ensures starting pairs are recognizable to most players
- Pre-computed flags enable fast game initialization without runtime filtering

## Configuration & Customization

**Graph Size** (`build/build_actor_actor_graph.py` parameters):
- `--top 750` (default): 1,000 playable actors after connectivity filtering
- `--starting 100`: 100 starting pool actors (StartActorScore-based)
- `--min-votes 100`: Movie quality threshold (affects full graph size)
- `--max-pages 100`: Approx. 2,000 movies (~15 min build time, ~11 MB file)

To change size:
- Increase `--top` for more playable actors (e.g., 1000 → ~1,300 playable)
- Increase `--max-pages` for larger full graph (e.g., 200 → ~4,000 movies, longer build)
- Decrease `--min-votes` to include less popular movies (more actors, noisier data)

**Game Difficulty** (edit `backend/main.py`, search for `MovieConnectionGame`):
- `max_incorrect_guesses=3` (default)
- Change to 1 for hard mode, 5+ for easier mode

**CORS** (`backend/main.py`):
- Currently allows all origins (`allow_origins=["*"]`)
- In production, restrict to specific domains

## Important Files to Know

- **`backend/main.py`**: All backend logic - modify here for new endpoints, game rules, API behavior
- **`backend/game_logic.py`**: Game move validation - modify here to change how moves are validated
- **`frontend/src/App.jsx`**: All UI - modify for visual changes, new features, layout
- **`build/build_actor_actor_graph.py`**: Actor-actor graph construction - modify for selection algorithms or dataset parameters
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

**Rebuild the graph** (e.g., after changing parameters or fetching fresh data):
1. Update `build/build_actor_actor_graph.py` if modifying selection algorithms
2. Run build script with desired parameters:
   ```bash
   cd build
   python build_actor_actor_graph.py \
     --out ../backend/global_actor_actor_graph.gpickle \
     --top 750 --starting 100 --min-votes 100 --max-pages 100
   ```
3. Verify output: graph file (~11 MB), index file (~1 MB), audit CSV
4. Restart backend to load new graph

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
