import os, io, base64, json, hashlib, unicodedata, random, pickle
from uuid import uuid4
from typing import Dict
from collections import defaultdict

import networkx as nx
import matplotlib.pyplot as plt
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from game_logic import MovieConnectionGame

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
GRAPH_PATH = os.getenv("CINELINKS_GRAPH_PATH", "global_actor_movie_graph.gpickle")
ACTOR_INDEX, MOVIE_INDEX = [], []
ACTOR_BY_NORM, MOVIE_BY_NORM = {}, {}

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

def build_indexes(G):
    actors, movies = [], []
    for n, d in G.nodes(data=True):
        if d.get("type") == "actor":
            name = n.split("::")[-1]
            actors.append({
                "node": n,
                "name": name,
                "name_norm": norm(name),
                "image": tmdb_img(d.get("profile_path"), "w185"),
            })
        elif d.get("type") == "movie":
            title = n.split("::")[-1]
            movies.append({
                "node": n,
                "title": title,
                "title_norm": norm(title),
                "image": tmdb_img(d.get("poster_path"), "w185"),
            })
    return actors, movies

def build_lookup_maps(G, actor_index, movie_index):
    actor_by_norm = defaultdict(list)
    movie_by_norm = defaultdict(list)
    for a in actor_index:
        actor_by_norm[a["name_norm"]].append(a["node"])
    for m in movie_index:
        movie_by_norm[m["title_norm"]].append(m["node"])
    return actor_by_norm, movie_by_norm

def load_graph():
    """Load the prebuilt graph using pickle for version compatibility."""
    global GRAPH, GRAPH_READY, GRAPH_CHECKSUM, ACTOR_INDEX, MOVIE_INDEX, ACTOR_BY_NORM, MOVIE_BY_NORM
    if not os.path.exists(GRAPH_PATH):
        print(f"[CineLinks] Graph file not found at {GRAPH_PATH}")
        GRAPH_READY = False
        return

    try:
        with open(GRAPH_PATH, "rb") as f:
            GRAPH = pickle.load(f)
        GRAPH_READY = True
        GRAPH_CHECKSUM = compute_graph_fingerprint(GRAPH)
        ACTOR_INDEX, MOVIE_INDEX = build_indexes(GRAPH)
        ACTOR_BY_NORM, MOVIE_BY_NORM = build_lookup_maps(GRAPH, ACTOR_INDEX, MOVIE_INDEX)
        print(f"[CineLinks] Loaded graph: {GRAPH_PATH}")
        print(f"[CineLinks] Nodes={GRAPH.number_of_nodes()} | Edges={GRAPH.number_of_edges()}")
    except Exception as e:
        print(f"[CineLinks] Failed to load graph: {e}")
        GRAPH = None
        GRAPH_READY = False
        GRAPH_CHECKSUM = ""

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
    return resolve_from_map_loose(name, ACTOR_BY_NORM, contains=True, limit=50)

def resolve_movie_nodes(title: str):
    return resolve_from_map_loose(title, MOVIE_BY_NORM, contains=True, limit=50)

# ---------- Models / Sessions ----------
class GuessInput(BaseModel):
    game_id: str
    movie: str
    actor: str

games: Dict[str, MovieConnectionGame] = {}

# ---------- Helpers ----------
def render_current_path(graph, path_nodes):
    sub = graph.subgraph(path_nodes)
    pos = nx.spring_layout(sub, seed=42)
    plt.figure(figsize=(8, 6))
    plt.title("CineLinks – Current Path", fontsize=12)
    node_colors = ['skyblue' if n.startswith('actor::') else 'lightgreen' for n in sub.nodes()]
    labels = {n: n.split("::")[-1] for n in sub.nodes()}
    nx.draw(sub, pos, labels=labels, node_color=node_colors, with_labels=True,
            node_size=2000, font_size=10, edge_color='gray')
    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight')
    plt.close()
    buf.seek(0)
    return base64.b64encode(buf.read()).decode('utf-8')

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
    actors = sum(1 for _, d in GRAPH.nodes(data=True) if d.get("type") == "actor")
    movies = sum(1 for _, d in GRAPH.nodes(data=True) if d.get("type") == "movie")
    return {"ready": True, "actors": actors, "movies": movies, "edges": GRAPH.number_of_edges(), "checksum": GRAPH_CHECKSUM}

@app.get("/start_game")
def start_game():
    if not GRAPH_READY:
        return graph_not_ready_response()

    actor_nodes = [n for n, d in GRAPH.nodes(data=True) if d.get("type") == "actor"]
    for _ in range(100):
        a1, a2 = random.sample(actor_nodes, 2)
        # ensure they haven't co-starred directly
        if set(GRAPH.neighbors(a1)).isdisjoint(set(GRAPH.neighbors(a2))):
            game_id = str(uuid4())
            games[game_id] = MovieConnectionGame(
                GRAPH, a1, a2,
                max_incorrect_guesses=3,
                resolve_actor=resolve_actor_nodes,
                resolve_movie=resolve_movie_nodes,
            )
            d1, d2 = GRAPH.nodes[a1], GRAPH.nodes[a2]
            return {
                "game_id": game_id,
                "game_name": "CineLinks",
                "start_actor": {"name": d1.get("name"), "image": d1.get("image")},
                "target_actor": {"name": d2.get("name"), "image": d2.get("image")},
            }
    raise HTTPException(status_code=500, detail="Failed to find a valid actor pair")

@app.post("/guess")
def guess(input: GuessInput):
    if not GRAPH_READY:
        return graph_not_ready_response()
    game = games.get(input.game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found.")
    success, message, poster_url = game.guess(input.movie, input.actor)
    image_data = render_current_path(GRAPH, game.path)
    return {"success": success, "message": message, "poster_url": poster_url, "graph_image_base64": image_data, "state": game.get_state()}

@app.get("/state")
def state(game_id: str = Query(...)):
    if not GRAPH_READY:
        return graph_not_ready_response()
    game = games.get(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found.")
    return game.get_state()

@app.get("/autocomplete/actors")
def autocomplete_actors(q: str = Query(..., min_length=1), limit: int = 10):
    if not GRAPH_READY:
        return graph_not_ready_response()
    needle = norm(q)
    out = []
    for item in ACTOR_INDEX:
        if needle in item["name_norm"]:
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
    for item in MOVIE_INDEX:
        if needle in item["title_norm"]:
            tmdb_id = GRAPH.nodes[item["node"]].get("tmdb_id")
            out.append({"title": item["title"], "image": item["image"], "tmdb_id": tmdb_id})
            if len(out) >= limit:
                break
    return {"query": q, "results": out}

# ---------- Initialize ----------
try:
    load_graph()
except Exception as e:
    print(f"[CineLinks] Startup: could not load graph ({e})")
    GRAPH_READY = False
