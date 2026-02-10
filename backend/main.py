import os, json, hashlib, unicodedata, random, pickle, itertools, time, logging
from uuid import uuid4
from typing import Dict, Optional, List, Tuple
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

import networkx as nx
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from pydantic import BaseModel

logger = logging.getLogger("movielinks")

from game_logic import MovieConnectionGame
from daily_puzzle import DailyPuzzleManager

is_prod = os.getenv("ENV", "dev") == "production"

app = FastAPI(
    title="Movie Links API",
    description="Movie Links — connect two actors through shared movies.",
    version="0.1.0",
    docs_url=None if is_prod else "/docs",
    redoc_url=None if is_prod else "/redoc",
)

# ---------- Security Headers ----------
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response

app.add_middleware(SecurityHeadersMiddleware)

# ---------- CORS ----------
ALLOWED_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
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
        print(f"[Movie Links] Graph file not found at {GRAPH_PATH}")
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
            print(f"[Movie Links] Loaded actor-movie index: {index_path}")
            print(f"[Movie Links]   Movies: {len(ACTOR_MOVIE_INDEX['movies'])}, Actors: {len(ACTOR_MOVIE_INDEX['actor_movies'])}")
        else:
            print(f"[Movie Links] WARNING: Actor-movie index not found at {index_path}")
            print(f"[Movie Links] Movie autocomplete will have limited coverage (edge metadata only)")
            ACTOR_MOVIE_INDEX = None

        GRAPH_READY = True
        GRAPH_CHECKSUM = compute_graph_fingerprint(GRAPH)
        ACTOR_INDEX, MOVIE_INDEX = build_indexes(GRAPH, ACTOR_MOVIE_INDEX)  # Pass index to build_indexes
        ACTOR_BY_NORM, MOVIE_BY_NORM = build_lookup_maps(GRAPH, ACTOR_INDEX, MOVIE_INDEX)
        print(f"[Movie Links] Loaded graph: {GRAPH_PATH}")
        print(f"[Movie Links] Nodes={GRAPH.number_of_nodes()} | Edges={GRAPH.number_of_edges()} | Movies indexed={len(MOVIE_INDEX)}")

        # Log playable and starting pool counts
        playable_count = sum(1 for _, d in GRAPH.nodes(data=True) if d.get("in_playable_graph", False))
        starting_count = sum(1 for _, d in GRAPH.nodes(data=True) if d.get("in_starting_pool", False))
        print(f"[Movie Links] Playable actors: {playable_count}")
        print(f"[Movie Links] Starting pool: {starting_count}")

        # Initialize daily puzzle manager
        DAILY_PUZZLE_MANAGER = DailyPuzzleManager(GRAPH)
        print(f"[Movie Links] Daily puzzle manager initialized")
    except Exception as e:
        print(f"[Movie Links] Failed to load graph: {e}")
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
    movieId: Optional[int] = None
    actorName: Optional[str] = None

class CreateGameRequest(BaseModel):
    startActorId: Optional[str] = None
    targetActorId: Optional[str] = None

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

games: Dict[str, Tuple[MovieConnectionGame, float]] = {}  # game_id -> (game, created_at)
GAME_TTL_SECONDS = 7200  # 2 hours
MAX_GAMES = 5000

def cleanup_expired_games():
    now = time.time()
    expired = [gid for gid, (_, ts) in games.items() if now - ts > GAME_TTL_SECONDS]
    for gid in expired:
        del games[gid]

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
    # Get poster_path from movie_data, or fall back to ACTOR_MOVIE_INDEX
    poster_path = movie_data.get('poster_path')
    if not poster_path and ACTOR_MOVIE_INDEX:
        indexed_movie = ACTOR_MOVIE_INDEX.get('movies', {}).get(movie_id)
        if indexed_movie:
            poster_path = indexed_movie.get('poster_path')

    return {
        "id": movie_id,
        "title": movie_data.get('title', 'Unknown'),
        "posterUrl": tmdb_img(poster_path, 'w500')
    }

def calculate_path_similarity(path1, path2, graph):
    """Calculate Jaccard similarity between two paths (0=different, 1=identical)."""
    # Extract movie IDs from edges (using most popular movie per edge)
    movies1 = set()
    for i in range(len(path1) - 1):
        edge_data = graph.edges[path1[i], path1[i + 1]]
        movies = edge_data.get('movies', [])
        if movies:
            movie = max(movies, key=lambda m: m.get('popularity', 0))
            movies1.add(movie['id'])

    movies2 = set()
    for i in range(len(path2) - 1):
        edge_data = graph.edges[path2[i], path2[i + 1]]
        movies = edge_data.get('movies', [])
        if movies:
            movie = max(movies, key=lambda m: m.get('popularity', 0))
            movies2.add(movie['id'])

    # Extract intermediate actors (exclude start/end)
    actors1 = set(path1[1:-1])
    actors2 = set(path2[1:-1])

    # Weighted Jaccard: movies 70%, actors 30%
    movie_jaccard = len(movies1 & movies2) / len(movies1 | movies2) if (movies1 or movies2) else 0
    actor_jaccard = len(actors1 & actors2) / len(actors1 | actors2) if (actors1 or actors2) else 0

    return 0.7 * movie_jaccard + 0.3 * actor_jaccard

def select_diverse_paths(all_paths, max_paths=3):
    """Greedy algorithm to select diverse paths."""
    if len(all_paths) <= max_paths:
        return all_paths

    selected = []

    # Step 1: Start with most popular path
    best_path = max(all_paths, key=lambda p: sum(
        max((m.get('popularity', 0) for m in GRAPH.edges[p[i], p[i+1]].get('movies', [])), default=0)
        for i in range(len(p) - 1)
    ))
    selected.append(best_path)
    remaining = [p for p in all_paths if p != best_path]

    # Step 2: Greedily add most diverse paths
    while len(selected) < max_paths and remaining:
        best_candidate = max(
            remaining,
            key=lambda c: min(
                calculate_path_similarity(c, s, GRAPH) for s in selected
            )
        )
        selected.append(best_candidate)
        remaining.remove(best_candidate)

    return selected

def build_path_response(game: MovieConnectionGame) -> dict:
    """Convert game state to frontend path structure."""
    segments = []
    for i, movie in enumerate(game.movies_used):
        segments.append({
            "movie": build_movie_dict(movie['id'], movie),
            "actor": build_actor_node_dict(game.path[i + 1])
        })

    # Include pending movie if one has been guessed but not yet paired with actor
    pending_movie = None
    if game.pending_movie_dict:
        pending_movie = build_movie_dict(game.pending_movie_dict['id'], game.pending_movie_dict)

    return {
        "startActor": build_actor_node_dict(game.start),
        "targetActor": build_actor_node_dict(game.target),
        "segments": segments,
        "pendingMovie": pending_movie
    }

def graph_not_ready_response():
    return JSONResponse(
        status_code=503,
        content={
            "error": "Graph not ready",
            "message": "The Movie Links data graph is still loading or missing. Please refresh in a few seconds."
        },
    )

# ---------- Routes ----------
@app.get("/health")
def health():
    return {"ok": True, "ready": GRAPH_READY, "service": "Movie Links API"}

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

    # Get current date in Central Time as puzzle ID
    central_tz = ZoneInfo("America/Chicago")
    puzzle_id = datetime.now(central_tz).strftime("%Y%m%d")

    # Get or generate today's puzzle
    start_actor, target_actor = DAILY_PUZZLE_MANAGER.get_daily_puzzle(puzzle_id)

    return {
        "puzzleId": puzzle_id,
        "startActor": build_actor_node_dict(start_actor),
        "targetActor": build_actor_node_dict(target_actor)
    }

@app.get("/autocomplete/actors")
def autocomplete_actors(q: str = Query(..., min_length=1, max_length=100), limit: int = Query(10, ge=1, le=50)):
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
def autocomplete_movies(q: str = Query(..., min_length=1, max_length=100), limit: int = Query(10, ge=1, le=50)):
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
def create_game(request: CreateGameRequest = CreateGameRequest()):
    """Create new game with specified or random actor pair."""
    if not GRAPH_READY:
        return graph_not_ready_response()

    # Use provided actors if given, otherwise select random pair
    if request.startActorId and request.targetActorId:
        # Validate provided actors exist in graph
        if request.startActorId not in GRAPH.nodes():
            raise HTTPException(status_code=400, detail=f"Start actor not found: {request.startActorId}")
        if request.targetActorId not in GRAPH.nodes():
            raise HTTPException(status_code=400, detail=f"Target actor not found: {request.targetActorId}")

        start = request.startActorId
        target = request.targetActorId
    else:
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

    cleanup_expired_games()

    game_id = str(uuid4())
    games[game_id] = (MovieConnectionGame(
        GRAPH, start, target,
        resolve_actor=resolve_actor_nodes,
        resolve_movie=resolve_movie_nodes,
        actor_movie_index=ACTOR_MOVIE_INDEX,
    ), time.time())

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

    entry = games.get(game_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Game not found")
    game = entry[0]

    # Validate guess using existing logic
    success, message, poster_url = game.guess(input.movieId, input.actorName)

    path_response = build_path_response(game)

    return {
        "success": success,
        "message": message,
        "path": path_response,
        "state": {
            "completed": game.completed,
            "totalGuesses": game.total_guesses,
            "moves_taken": len(game.movies_used),
            "incorrectGuesses": game.incorrect_guesses
        }
    }

@app.post("/api/game/{game_id}/swap-actors")
def swap_actors(game_id: str):
    """Swap starting and target actors (only allowed before first move)."""
    if not GRAPH_READY:
        return graph_not_ready_response()

    entry = games.get(game_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Game not found")
    game = entry[0]

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

@app.post("/api/game/{game_id}/give-up")
def give_up_game(game_id: str):
    """Give up on the current game (counts as a loss)."""
    if not GRAPH_READY:
        return graph_not_ready_response()

    entry = games.get(game_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Game not found")
    game = entry[0]

    success, message = game.give_up()

    if not success:
        raise HTTPException(status_code=400, detail=message)

    return {
        "success": True,
        "message": message,
        "state": {
            "completed": game.completed,
            "totalGuesses": game.total_guesses,
            "moves_taken": len(game.movies_used),
            "incorrectGuesses": game.incorrect_guesses,
            "gaveUp": game.gave_up
        }
    }

@app.get("/api/game/{game_id}/optimal-path")
def get_optimal_path(game_id: str):
    """
    Compute shortest path using NetworkX.
    Picks path with highest total movie popularity when multiple paths exist.
    Can be called for incomplete games (e.g., after giving up).
    """
    if not GRAPH_READY:
        return graph_not_ready_response()

    entry = games.get(game_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Game not found")
    game = entry[0]

    # Compute ALL shortest paths
    try:
        all_shortest_paths = list(nx.all_shortest_paths(GRAPH, game.start, game.target))
    except nx.NetworkXNoPath:
        raise HTTPException(status_code=500, detail="No path exists")

    # Pick path with highest total movie popularity
    if len(all_shortest_paths) == 1:
        actor_path = all_shortest_paths[0]
    else:
        best_path = None
        best_popularity = -1

        for path in all_shortest_paths:
            total_popularity = 0
            for i in range(len(path) - 1):
                edge_data = GRAPH.edges[path[i], path[i + 1]]
                movies = edge_data.get('movies', [])
                if movies:
                    max_movie_popularity = max(m.get('popularity', 0) for m in movies)
                    total_popularity += max_movie_popularity

            if total_popularity > best_popularity:
                best_popularity = total_popularity
                best_path = path

        actor_path = best_path if best_path else all_shortest_paths[0]

    # Build segments with most popular movies
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

@app.get("/api/game/{game_id}/optimal-paths")
def get_optimal_paths(game_id: str, max_paths: int = 3):
    """Return up to 3 diverse shortest paths."""
    if not GRAPH_READY:
        return graph_not_ready_response()

    entry = games.get(game_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Game not found")
    game = entry[0]

    # Get all shortest paths (limit to 100 for performance)
    try:
        all_paths_iter = nx.all_shortest_paths(GRAPH, game.start, game.target)
        all_paths = list(itertools.islice(all_paths_iter, 100))
    except nx.NetworkXNoPath:
        raise HTTPException(status_code=500, detail="No path exists")

    # Select diverse paths
    selected_paths = select_diverse_paths(all_paths, max_paths)

    # Build response for each path
    paths_response = []
    for actor_path in selected_paths:
        segments = []
        for i in range(len(actor_path) - 1):
            current_actor = actor_path[i]
            next_actor = actor_path[i + 1]
            edge_data = GRAPH.edges[current_actor, next_actor]
            movies = edge_data.get('movies', [])

            if movies:
                # Pick most popular movie
                movie = max(movies, key=lambda m: m.get('popularity', 0))
                segments.append({
                    "movie": build_movie_dict(movie['id'], movie),
                    "actor": build_actor_node_dict(next_actor)
                })

        paths_response.append({
            "startActor": build_actor_node_dict(game.start),
            "targetActor": build_actor_node_dict(game.target),
            "segments": segments
        })

    return {"paths": paths_response, "count": len(paths_response)}

# ---------- Initialize ----------
try:
    load_graph()
except Exception as e:
    print(f"[Movie Links] Startup: could not load graph ({e})")
    GRAPH_READY = False
