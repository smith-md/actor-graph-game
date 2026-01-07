import os, json, hashlib, unicodedata, random, pickle
from uuid import uuid4
from typing import Dict, Optional, List
from collections import defaultdict
from datetime import datetime

import networkx as nx
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from game_logic import MovieConnectionGame
from daily_puzzle import DailyPuzzleManager

app = FastAPI(
    title="CineLinks API",
    description="CineLinks — connect two actors through shared movies.",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

# ---------- CORS ----------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- Graph globals ----------
GRAPH = None
GRAPH_READY = False
GRAPH_CHECKSUM = ""
GRAPH_PATH = os.getenv("CINELINKS_GRAPH_PATH", "global_actor_actor_graph.gpickle")
ACTOR_MOVIE_INDEX = None  # NEW: Comprehensive actor-movie index for StartActorScore & full movie coverage
ACTOR_INDEX, MOVIE_INDEX = [], []
ACTOR_BY_NORM, MOVIE_BY_NORM = {}, {}
DAILY_PUZZLE_MANAGER = None  # Daily puzzle generation with 20-day exclusion

# ---------- Utilities ----------
def norm(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii").lower().strip()

def tmdb_img(path, size="w300"):
    return f"https://image.tmdb.org/t/p/{size}{path}" if path else None

def compute_graph_fingerprint(G) -> str:
    nodes = sorted([f"{n}|{G.nodes[n].get('type','')}" for n in G.nodes()])
    edges = sorted([f"{u}->{v}" if u < v else f"{v}->{u}" for u, v in G.edges()])
    blob = json.dumps({"nodes": nodes, "edges": edges}, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()

def build_indexes(G, actor_movie_index=None):
    """
    Build actor and movie indexes for autocomplete.

    For actor-actor graph:
    - Actors come from nodes (all nodes are actors)
    - Movies come from actor_movie_index (if available) for comprehensive coverage,
      otherwise from edge metadata (limited to movies connecting actors)

    Args:
        G: NetworkX graph
        actor_movie_index: Optional actor-movie index dict with 'movies' and 'actor_movies'

    Returns:
        Tuple of (actors list, movies list)
    """
    actors = []
    movies_dict = {}  # Use dict to deduplicate by movie ID

    # Build actor index (all nodes are actors)
    for node, data in G.nodes(data=True):
        name = data.get('name', node.split('_')[-1])
        actors.append({
            "node": node,
            "name": name,
            "name_norm": norm(name),
            "image": data.get('image') or tmdb_img(data.get("profile_path"), "w185"),
            "tmdb_id": data.get("tmdb_id")  # Add for reverse lookup
        })

    # Build movie index from edge metadata (always include all movies in graph)
    for u, v, edge_data in G.edges(data=True):
        movies_list = edge_data.get('movies', [])
        for movie in movies_list:
            movie_id = movie['id']
            if movie_id not in movies_dict:
                movies_dict[movie_id] = {
                    "movie_id": movie_id,
                    "title": movie['title'],
                    "title_norm": norm(movie['title']),
                    "image": tmdb_img(movie.get('poster_path'), "w185"),
                    "poster_path": movie.get('poster_path'),
                }

    # Supplement with actor_movie_index if available (for additional metadata)
    if actor_movie_index:
        for movie_id, movie_data in actor_movie_index["movies"].items():
            if movie_id not in movies_dict:
                movies_dict[movie_id] = {
                    "movie_id": movie_id,
                    "title": movie_data["title"],
                    "title_norm": norm(movie_data["title"]),
                    "image": tmdb_img(movie_data.get("poster_path"), "w185"),
                    "poster_path": movie_data.get("poster_path"),
                }

    movies = list(movies_dict.values())
    return actors, movies

def build_lookup_maps(G, actor_index, movie_index):
    """
    Build lookup maps for autocomplete.

    NEW: Maps movie titles to movie IDs (not title strings) for ID-based validation.
    """
    actor_by_norm = defaultdict(list)
    movie_by_norm = defaultdict(list)

    for a in actor_index:
        actor_by_norm[a["name_norm"]].append(a["node"])

    # NEW: Map to movie IDs instead of titles for ID-based validation
    for m in movie_index:
        movie_by_norm[m["title_norm"]].append(m["movie_id"])

    return actor_by_norm, movie_by_norm

def load_graph():
    """Load the prebuilt graph AND actor-movie index using pickle."""
    global GRAPH, GRAPH_READY, GRAPH_CHECKSUM, ACTOR_INDEX, MOVIE_INDEX, ACTOR_BY_NORM, MOVIE_BY_NORM, ACTOR_MOVIE_INDEX, DAILY_PUZZLE_MANAGER
    if not os.path.exists(GRAPH_PATH):
        print(f"[CineLinks] Graph file not found at {GRAPH_PATH}")
        GRAPH_READY = False
        return

    try:
        # Load graph
        with open(GRAPH_PATH, "rb") as f:
            GRAPH = pickle.load(f)

        # Load actor-movie index (NEW - for comprehensive movie coverage)
        index_path = GRAPH_PATH.replace('.gpickle', '_actor_movie_index.pickle')
        if os.path.exists(index_path):
            with open(index_path, "rb") as f:
                ACTOR_MOVIE_INDEX = pickle.load(f)
            print(f"[CineLinks] Loaded actor-movie index: {index_path}")
            print(f"[CineLinks]   Movies: {len(ACTOR_MOVIE_INDEX['movies'])}, Actors: {len(ACTOR_MOVIE_INDEX['actor_movies'])}")
        else:
            print(f"[CineLinks] WARNING: Actor-movie index not found at {index_path}")
            print(f"[CineLinks] Movie autocomplete will have limited coverage (edge metadata only)")
            ACTOR_MOVIE_INDEX = None

        GRAPH_READY = True
        GRAPH_CHECKSUM = compute_graph_fingerprint(GRAPH)
        ACTOR_INDEX, MOVIE_INDEX = build_indexes(GRAPH, ACTOR_MOVIE_INDEX)  # Pass index to build_indexes
        ACTOR_BY_NORM, MOVIE_BY_NORM = build_lookup_maps(GRAPH, ACTOR_INDEX, MOVIE_INDEX)
        print(f"[CineLinks] Loaded graph: {GRAPH_PATH}")
        print(f"[CineLinks] Nodes={GRAPH.number_of_nodes()} | Edges={GRAPH.number_of_edges()} | Movies indexed={len(MOVIE_INDEX)}")

        # Log playable and starting pool counts
        playable_count = sum(1 for _, d in GRAPH.nodes(data=True) if d.get("in_playable_graph", False))
        starting_count = sum(1 for _, d in GRAPH.nodes(data=True) if d.get("in_starting_pool", False))
        print(f"[CineLinks] Playable actors: {playable_count}")
        print(f"[CineLinks] Starting pool: {starting_count}")

        # Initialize daily puzzle manager
        DAILY_PUZZLE_MANAGER = DailyPuzzleManager(GRAPH)
        print(f"[CineLinks] Daily puzzle manager initialized")
    except Exception as e:
        print(f"[CineLinks] Failed to load graph: {e}")
        GRAPH = None
        GRAPH_READY = False
        GRAPH_CHECKSUM = ""
        ACTOR_MOVIE_INDEX = None
        DAILY_PUZZLE_MANAGER = None

def resolve_from_map_loose(key: str, mapping: dict, contains: bool = True, limit: int = 50):
    """Return list of node IDs by normalized key; supports loose 'contains' fallback."""
    k = norm(key)
    if k in mapping:
        return list(mapping[k])[:limit]
    if contains:
        out = []
        for idx_key, nodes in mapping.items():
            if k in idx_key:
                out.extend(nodes)
                if len(out) >= limit:
                    break
        return out[:limit]
    return []

def resolve_actor_nodes(name: str):
    """Resolve actor name to list of actor node IDs."""
    return resolve_from_map_loose(name, ACTOR_BY_NORM, contains=True, limit=50)

def resolve_movie_nodes(title: str):
    """
    Resolve movie title to list of matching titles.

    Note: Returns titles, not node IDs (movies aren't nodes in actor-actor graph).
    """
    return resolve_from_map_loose(title, MOVIE_BY_NORM, contains=True, limit=50)

# ---------- Models / Sessions ----------
class GuessInput(BaseModel):
    game_id: str
    movie_id: int  # CHANGED: Use TMDb movie ID instead of title string
    actor: str

# New Pydantic models for PRD-compliant API
class ActorNode(BaseModel):
    id: str
    name: str
    imageUrl: Optional[str]

class MovieConnector(BaseModel):
    id: int
    title: str
    posterUrl: Optional[str]

class PathSegment(BaseModel):
    movie: MovieConnector
    actor: ActorNode

class GamePath(BaseModel):
    startActor: ActorNode
    targetActor: ActorNode
    segments: List[PathSegment]

class NewGuessInput(BaseModel):
    movieId: int
    actorName: str

class CreateGameResponse(BaseModel):
    gameId: str
    startActor: ActorNode
    targetActor: ActorNode
    path: GamePath

class GuessResponse(BaseModel):
    success: bool
    message: str
    path: GamePath
    state: dict

class SwapActorsResponse(BaseModel):
    success: bool
    message: str
    startActor: ActorNode
    targetActor: ActorNode
    path: GamePath

games: Dict[str, MovieConnectionGame] = {}

# ---------- Helpers ----------
def build_actor_node_dict(actor_id: str) -> dict:
    """Extract actor data from graph node."""
    data = GRAPH.nodes[actor_id]
    return {
        "id": actor_id,
        "name": data.get('name', actor_id.split('_')[-1]),
        "imageUrl": data.get('image') or tmdb_img(data.get('profile_path'), 'w185')
    }

def build_movie_dict(movie_id: int, movie_data: dict) -> dict:
    """Build movie connector from movie data."""
    return {
        "id": movie_id,
        "title": movie_data.get('title', 'Unknown'),
        "posterUrl": tmdb_img(movie_data.get('poster_path'), 'w500')
    }

def build_path_response(game: MovieConnectionGame) -> dict:
    """Convert game state to frontend path structure."""
    segments = []
    for i, movie in enumerate(game.movies_used):
        segments.append({
            "movie": build_movie_dict(movie['id'], movie),
            "actor": build_actor_node_dict(game.path[i + 1])
        })

    return {
        "startActor": build_actor_node_dict(game.start),
        "targetActor": build_actor_node_dict(game.target),
        "segments": segments
    }

def graph_not_ready_response():
    return JSONResponse(
        status_code=503,
        content={
            "error": "Graph not ready",
            "message": "The CineLinks data graph is still loading or missing. Please refresh in a few seconds."
        },
    )

# ---------- Routes ----------
@app.get("/health")
def health():
    return {"ok": True, "ready": GRAPH_READY, "service": "CineLinks API"}

@app.get("/meta")
def meta():
    if not GRAPH_READY:
        return graph_not_ready_response()

    # For actor-actor graph: all nodes are actors
    actors = GRAPH.number_of_nodes()
    playable_actors = sum(1 for _, d in GRAPH.nodes(data=True) if d.get("in_playable_graph", False))
    starting_pool_actors = sum(1 for _, d in GRAPH.nodes(data=True) if d.get("in_starting_pool", False))
    movies = len(MOVIE_INDEX)  # Count unique movies from edge metadata

    return {
        "ready": True,
        "actors": actors,
        "playable_actors": playable_actors,
        "starting_pool_actors": starting_pool_actors,
        "movies": movies,
        "edges": GRAPH.number_of_edges(),
        "checksum": GRAPH_CHECKSUM
    }

@app.get("/api/daily-pair")
def get_daily_pair():
    """
    Get today's daily puzzle actor pair.

    Returns deterministic puzzle for current date (UTC).
    All users get same puzzle on same day.

    Response:
        {
            "puzzleId": "20260107",
            "startActor": { "id": "...", "name": "...", "imageUrl": "..." },
            "targetActor": { "id": "...", "name": "...", "imageUrl": "..." }
        }
    """
    if not GRAPH_READY:
        return graph_not_ready_response()

    # Get current date in UTC as puzzle ID
    puzzle_id = datetime.utcnow().strftime("%Y%m%d")

    # Get or generate today's puzzle
    start_actor, target_actor = DAILY_PUZZLE_MANAGER.get_daily_puzzle(puzzle_id)

    return {
        "puzzleId": puzzle_id,
        "startActor": build_actor_node_dict(start_actor),
        "targetActor": build_actor_node_dict(target_actor)
    }

@app.get("/autocomplete/actors")
def autocomplete_actors(q: str = Query(..., min_length=1), limit: int = 10):
    if not GRAPH_READY:
        return graph_not_ready_response()
    needle = norm(q)
    out = []
    for item in ACTOR_INDEX:
        if needle in item["name_norm"]:
            # Filter to playable actors only (default True for backwards compatibility)
            if GRAPH.nodes[item["node"]].get("in_playable_graph", True):
                tmdb_id = GRAPH.nodes[item["node"]].get("tmdb_id")
                out.append({"name": item["name"], "image": item["image"], "tmdb_id": tmdb_id})
                if len(out) >= limit:
                    break
    return {"query": q, "results": out}

@app.get("/autocomplete/movies")
def autocomplete_movies(q: str = Query(..., min_length=1), limit: int = 10):
    if not GRAPH_READY:
        return graph_not_ready_response()
    needle = norm(q)
    out = []

    # Search in MOVIE_INDEX (built from edge metadata)
    for item in MOVIE_INDEX:
        if needle in item["title_norm"]:
            out.append({
                "title": item["title"],
                "image": item["image"],
                "movie_id": item.get("movie_id")
            })
            if len(out) >= limit:
                break

    return {"query": q, "results": out}

# ---------- New PRD-Compliant API Endpoints ----------
@app.post("/api/game")
def create_game():
    """Create new game with random actor pair."""
    if not GRAPH_READY:
        return graph_not_ready_response()

    # Select from starting pool (high-quality, well-known actors only)
    starting_actors = [n for n in GRAPH.nodes() if GRAPH.nodes[n].get('in_starting_pool', False)]

    if len(starting_actors) < 2:
        raise HTTPException(status_code=500, detail="Not enough starting actors")

    # Try to find two actors that aren't directly connected
    for _ in range(100):
        start, target = random.sample(starting_actors, 2)
        if not GRAPH.has_edge(start, target):
            break
    else:
        # Fallback: use any two actors if all are connected
        start, target = random.sample(starting_actors, 2)

    game_id = str(uuid4())
    games[game_id] = MovieConnectionGame(
        GRAPH, start, target,
        max_incorrect_guesses=3,
        resolve_actor=resolve_actor_nodes,
        resolve_movie=resolve_movie_nodes,
        actor_movie_index=ACTOR_MOVIE_INDEX,
    )

    return {
        "gameId": game_id,
        "startActor": build_actor_node_dict(start),
        "targetActor": build_actor_node_dict(target),
        "path": {
            "startActor": build_actor_node_dict(start),
            "targetActor": build_actor_node_dict(target),
            "segments": []
        }
    }

@app.post("/api/game/{game_id}/guess")
def submit_guess(game_id: str, input: NewGuessInput):
    """Submit movie + actor guess."""
    if not GRAPH_READY:
        return graph_not_ready_response()

    game = games.get(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    # Validate guess using existing logic
    success, message, poster_url = game.guess(input.movieId, input.actorName)

    return {
        "success": success,
        "message": message,
        "path": build_path_response(game),
        "state": {
            "completed": game.completed,
            "totalGuesses": game.total_guesses,
            "incorrectGuesses": game.incorrect_guesses,
            "remainingAttempts": game.max_incorrect - game.incorrect_guesses
        }
    }

@app.post("/api/game/{game_id}/swap-actors")
def swap_actors(game_id: str):
    """Swap starting and target actors (only allowed before first move)."""
    if not GRAPH_READY:
        return graph_not_ready_response()

    game = games.get(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    # Only allow swap if no moves have been made
    if len(game.movies_used) > 0:
        raise HTTPException(
            status_code=400,
            detail="Cannot swap actors after making a move"
        )

    # Swap the actors
    game.start, game.target = game.target, game.start
    game.current = game.start
    game.path = [game.start]

    return {
        "success": True,
        "message": "Actors swapped successfully",
        "startActor": build_actor_node_dict(game.start),
        "targetActor": build_actor_node_dict(game.target),
        "path": {
            "startActor": build_actor_node_dict(game.start),
            "targetActor": build_actor_node_dict(game.target),
            "segments": []
        }
    }

@app.get("/api/game/{game_id}/optimal-path")
def get_optimal_path(game_id: str):
    """Compute shortest path using NetworkX."""
    if not GRAPH_READY:
        return graph_not_ready_response()

    game = games.get(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    if not game.completed:
        raise HTTPException(status_code=400, detail="Complete the game first")

    # Compute shortest path
    try:
        actor_path = nx.shortest_path(GRAPH, game.start, game.target)
    except nx.NetworkXNoPath:
        raise HTTPException(status_code=500, detail="No path exists")

    # Build segments
    segments = []
    for i in range(len(actor_path) - 1):
        current_actor = actor_path[i]
        next_actor = actor_path[i + 1]

        edge_data = GRAPH.edges[current_actor, next_actor]
        movies = edge_data.get('movies', [])

        # Pick most popular movie
        if movies:
            movie = max(movies, key=lambda m: m.get('popularity', 0))
            segments.append({
                "movie": build_movie_dict(movie['id'], movie),
                "actor": build_actor_node_dict(next_actor)
            })

    return {
        "startActor": build_actor_node_dict(game.start),
        "targetActor": build_actor_node_dict(game.target),
        "segments": segments
    }

# ---------- Initialize ----------
try:
    load_graph()
except Exception as e:
    print(f"[CineLinks] Startup: could not load graph ({e})")
    GRAPH_READY = False
