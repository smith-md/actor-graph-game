import sys, os, networkx as nx, hashlib, random, pickle

def sha256sum(filename, blocksize=65536):
    h = hashlib.sha256()
    with open(filename, "rb") as f:
        for chunk in iter(lambda: f.read(blocksize), b""):
            h.update(chunk)
    return h.hexdigest()

def verify_graph(path):
    if not os.path.exists(path):
        print(f"❌ File not found: {path}")
        return 1
    try:
        with open(path, "rb") as f:
            G = pickle.load(f)
    except Exception as e:
        print(f"❌ Failed to load graph: {e}")
        return 1

    actors = [n for n, d in G.nodes(data=True) if d.get("type") == "actor"]
    movies = [n for n, d in G.nodes(data=True) if d.get("type") == "movie"]
    a, m, e = len(actors), len(movies), G.number_of_edges()

    if a < 400: print(f"⚠️ Low actor count ({a})")
    if m < 200: print(f"⚠️ Low movie count ({m})")
    if e == 0: print("❌ No edges in graph"); return 1

    print("✅ Graph loaded successfully")
    print(f"Actors: {a} | Movies: {m} | Edges: {e}")
    print("Sample actors:", [x.split('::')[-1] for x in random.sample(actors, min(5, a))])
    print("Sample movies:", [x.split('::')[-1] for x in random.sample(movies, min(5, m))])
    print("SHA256:", sha256sum(path))
    return 0

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python verify_graph.py <graph_file.gpickle>")
        sys.exit(1)
    sys.exit(verify_graph(sys.argv[1]))
