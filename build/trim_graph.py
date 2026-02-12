"""
Trim Graph to Playable Actors Only

Reduces the full actor-actor graph (~125K actors, ~336 MB) to only the
playable subgraph (~2,740 actors, ~12 MB) by removing actors that are
never used at runtime. Also trims the actor-movie index accordingly.

Usage:
    cd build
    ..\\backend\\venv\\Scripts\\Activate.ps1
    python trim_graph.py                          # writes trimmed files
    python trim_graph.py --dry-run                # stats only, no write
"""

import os
import sys
import pickle
import argparse
import networkx as nx


# ---------------------------------------------------------------------------
# Default paths (relative to build/ directory)
# ---------------------------------------------------------------------------
DEFAULT_GRAPH_PATH = "../backend/global_actor_actor_graph.gpickle"
DEFAULT_OUT_SUFFIX = "_trimmed"

# Attributes only used during build, not at runtime
BUILD_ONLY_NODE_ATTRS = [
    "weighted_degree",
    "betweenness",
    "composite_score",
    "start_actor_score",
]
BUILD_ONLY_EDGE_ATTRS = [
    "weight",
]


# ---------------------------------------------------------------------------
# Core trimming functions
# ---------------------------------------------------------------------------

def extract_playable_subgraph(G):
    """
    Keep only nodes with in_playable_graph=True.

    Returns a fresh copy (the original is not modified).
    """
    playable_nodes = [
        n for n, d in G.nodes(data=True)
        if d.get("in_playable_graph", False)
    ]
    subgraph = G.subgraph(playable_nodes).copy()
    return subgraph


def prune_degree_one_nodes_safe(G, protect=None):
    """
    Iteratively remove degree <= 1 nodes (dead-ends), but never remove
    nodes in the *protect* set (starting pool actors).

    Modifies G in place. Returns count of nodes removed.
    """
    if protect is None:
        protect = set()

    total_removed = 0
    changed = True
    while changed:
        changed = False
        to_remove = [
            n for n in G.nodes()
            if G.degree(n) <= 1 and n not in protect
        ]
        if to_remove:
            G.remove_nodes_from(to_remove)
            total_removed += len(to_remove)
            changed = True

    # Warn about any protected nodes that ended up with degree <= 1
    for n in protect:
        if n in G and G.degree(n) <= 1:
            name = G.nodes[n].get("name", n)
            print(f"  WARNING: Starting pool actor '{name}' has degree {G.degree(n)}")

    return total_removed


def remove_orphan_components(G, protect=None):
    """
    Remove connected components that contain no protected (starting pool) nodes.
    These are islands unreachable from any game start pair.

    Modifies G in place. Returns count of nodes removed.
    """
    if protect is None:
        protect = set()

    total_removed = 0
    for component in list(nx.connected_components(G)):
        if not component & protect:
            G.remove_nodes_from(component)
            total_removed += len(component)

    return total_removed


def strip_build_attributes(G):
    """
    Remove node/edge attributes that are only used during graph building
    and are never read at runtime.
    """
    node_stripped = 0
    for _, data in G.nodes(data=True):
        for attr in BUILD_ONLY_NODE_ATTRS:
            if attr in data:
                del data[attr]
                node_stripped += 1

    edge_stripped = 0
    for _, _, data in G.edges(data=True):
        for attr in BUILD_ONLY_EDGE_ATTRS:
            if attr in data:
                del data[attr]
                edge_stripped += 1

    return node_stripped, edge_stripped


def trim_actor_movie_index(index, playable_tmdb_ids):
    """
    Keep only playable actors' filmographies and the movies they reference.

    Args:
        index: Original actor-movie index dict with "movies", "actor_movies", "metadata"
        playable_tmdb_ids: Set of TMDb actor IDs (ints) to keep

    Returns:
        New trimmed index dict
    """
    # Keep only playable actors' filmographies
    trimmed_actor_movies = {}
    referenced_movie_ids = set()

    for actor_id, filmography in index["actor_movies"].items():
        if actor_id in playable_tmdb_ids:
            trimmed_actor_movies[actor_id] = filmography
            for entry in filmography:
                referenced_movie_ids.add(entry["movie_id"])

    # Keep only movies referenced by playable actors
    trimmed_movies = {
        mid: mdata for mid, mdata in index["movies"].items()
        if mid in referenced_movie_ids
    }

    trimmed_index = {
        "movies": trimmed_movies,
        "actor_movies": trimmed_actor_movies,
        "metadata": {
            **index.get("metadata", {}),
            "trimmed": True,
            "trimmed_actors": len(trimmed_actor_movies),
            "trimmed_movies": len(trimmed_movies),
        },
    }
    return trimmed_index


def validate_trimmed_graph(G):
    """
    Verify the trimmed graph is valid for runtime use:
    - All nodes have in_playable_graph=True
    - Graph is connected (single component)
    - Starting pool actors are all reachable from each other
    - No zero-degree nodes
    """
    errors = []

    # Check all nodes are playable
    non_playable = [
        n for n, d in G.nodes(data=True)
        if not d.get("in_playable_graph", False)
    ]
    if non_playable:
        errors.append(f"{len(non_playable)} nodes missing in_playable_graph=True")

    # Check connectivity
    if G.number_of_nodes() > 0:
        num_components = nx.number_connected_components(G)
        if num_components > 1:
            components = sorted(nx.connected_components(G), key=len, reverse=True)
            errors.append(
                f"Graph has {num_components} components "
                f"(largest: {len(components[0])}, smallest: {len(components[-1])})"
            )

    # Check starting pool reachability
    starting_pool = [
        n for n, d in G.nodes(data=True)
        if d.get("in_starting_pool", False)
    ]
    if starting_pool:
        # All starting pool actors should be in the same component
        first = starting_pool[0]
        reachable = nx.node_connected_component(G, first)
        unreachable = [n for n in starting_pool if n not in reachable]
        if unreachable:
            errors.append(
                f"{len(unreachable)} starting pool actors unreachable from others"
            )
    else:
        errors.append("No starting pool actors found")

    # Check for zero-degree nodes
    zero_degree = [n for n in G.nodes() if G.degree(n) == 0]
    if zero_degree:
        errors.append(f"{len(zero_degree)} nodes with degree 0 (isolated)")

    return errors


# ---------------------------------------------------------------------------
# Helper to extract TMDb IDs from graph nodes
# ---------------------------------------------------------------------------

def get_playable_tmdb_ids(G):
    """Extract TMDb actor IDs (ints) from graph nodes."""
    ids = set()
    for node, data in G.nodes(data=True):
        tmdb_id = data.get("tmdb_id")
        if tmdb_id is not None:
            ids.add(tmdb_id)
        elif node.startswith("actor_"):
            try:
                ids.add(int(node.split("_", 1)[1]))
            except ValueError:
                pass
    return ids


# ---------------------------------------------------------------------------
# File size helper
# ---------------------------------------------------------------------------

def fmt_size(path):
    """Format file size in MB."""
    if os.path.exists(path):
        return f"{os.path.getsize(path) / (1024 * 1024):.2f} MB"
    return "N/A"


# ---------------------------------------------------------------------------
# Main trimming pipeline (reusable from build script)
# ---------------------------------------------------------------------------

def trim_pipeline(graph_path, index_path, out_graph_path, out_index_path, dry_run=False):
    """
    Run the full trim pipeline. Can be called standalone or from build script.

    Args:
        graph_path: Path to input graph pickle
        index_path: Path to input actor-movie index pickle
        out_graph_path: Path to write trimmed graph
        out_index_path: Path to write trimmed index
        dry_run: If True, print stats only without writing files

    Returns:
        Tuple of (trimmed_graph, trimmed_index) or None if dry_run
    """
    sep = "=" * 60

    # Load graph
    print(f"\n{sep}")
    print("TRIM GRAPH TO PLAYABLE ACTORS ONLY")
    print(sep)

    print(f"\nLoading graph: {graph_path}")
    with open(graph_path, "rb") as f:
        G = pickle.load(f)
    print(f"  Nodes: {G.number_of_nodes():,}")
    print(f"  Edges: {G.number_of_edges():,}")
    print(f"  Size:  {fmt_size(graph_path)}")

    # Load index
    has_index = os.path.exists(index_path)
    index = None
    if has_index:
        print(f"\nLoading index: {index_path}")
        with open(index_path, "rb") as f:
            index = pickle.load(f)
        print(f"  Movies: {len(index['movies']):,}")
        print(f"  Actors: {len(index['actor_movies']):,}")
        print(f"  Size:   {fmt_size(index_path)}")
    else:
        print(f"\nWARNING: Index not found at {index_path} — skipping index trim")

    # Count before stats
    before_nodes = G.number_of_nodes()
    before_edges = G.number_of_edges()
    playable_before = sum(1 for _, d in G.nodes(data=True) if d.get("in_playable_graph", False))
    starting_before = sum(1 for _, d in G.nodes(data=True) if d.get("in_starting_pool", False))

    # Step 1: Extract playable subgraph
    print(f"\n--- Step 1: Extract playable subgraph ---")
    G_trimmed = extract_playable_subgraph(G)
    print(f"  Nodes: {before_nodes:,} -> {G_trimmed.number_of_nodes():,}")
    print(f"  Edges: {before_edges:,} -> {G_trimmed.number_of_edges():,}")

    # Step 2: Prune dead-ends (protect starting pool)
    print(f"\n--- Step 2: Prune degree <= 1 nodes (protect starting pool) ---")
    protect = {
        n for n, d in G_trimmed.nodes(data=True)
        if d.get("in_starting_pool", False)
    }
    nodes_before_prune = G_trimmed.number_of_nodes()
    removed = prune_degree_one_nodes_safe(G_trimmed, protect=protect)
    print(f"  Removed: {removed} dead-end nodes")
    print(f"  Nodes: {nodes_before_prune:,} -> {G_trimmed.number_of_nodes():,}")
    print(f"  Edges: {G_trimmed.number_of_edges():,}")

    # Step 3: Remove orphan components (no starting pool actors)
    print(f"\n--- Step 3: Remove orphan components ---")
    nodes_before_orphan = G_trimmed.number_of_nodes()
    orphan_removed = remove_orphan_components(G_trimmed, protect=protect)
    if orphan_removed:
        print(f"  Removed: {orphan_removed} nodes in disconnected islands")
        print(f"  Nodes: {nodes_before_orphan:,} -> {G_trimmed.number_of_nodes():,}")
    else:
        print(f"  No orphan components found")

    # Step 4: Strip build-only attributes
    print(f"\n--- Step 4: Strip build-only attributes ---")
    node_stripped, edge_stripped = strip_build_attributes(G_trimmed)
    print(f"  Node attrs removed: {node_stripped}")
    print(f"  Edge attrs removed: {edge_stripped}")

    # Step 5: Trim actor-movie index
    trimmed_index = None
    if index:
        print(f"\n--- Step 5: Trim actor-movie index ---")
        playable_ids = get_playable_tmdb_ids(G_trimmed)
        trimmed_index = trim_actor_movie_index(index, playable_ids)
        print(f"  Movies: {len(index['movies']):,} -> {len(trimmed_index['movies']):,}")
        print(f"  Actors: {len(index['actor_movies']):,} -> {len(trimmed_index['actor_movies']):,}")

    # Step 6: Validate
    print(f"\n--- Step 6: Validate trimmed graph ---")
    errors = validate_trimmed_graph(G_trimmed)
    starting_after = sum(1 for _, d in G_trimmed.nodes(data=True) if d.get("in_starting_pool", False))
    print(f"  Starting pool: {starting_before} -> {starting_after}")
    if errors:
        for e in errors:
            print(f"  ERROR: {e}")
    else:
        print(f"  OK: All validation checks passed")

    # Summary
    print(f"\n{sep}")
    print("TRIM SUMMARY")
    print(sep)
    print(f"  Graph nodes:  {before_nodes:>10,} -> {G_trimmed.number_of_nodes():>8,}  ({G_trimmed.number_of_nodes()/before_nodes*100:.1f}%)")
    print(f"  Graph edges:  {before_edges:>10,} -> {G_trimmed.number_of_edges():>8,}  ({G_trimmed.number_of_edges()/before_edges*100:.1f}%)")
    if index and trimmed_index:
        print(f"  Index movies: {len(index['movies']):>10,} -> {len(trimmed_index['movies']):>8,}")
        print(f"  Index actors: {len(index['actor_movies']):>10,} -> {len(trimmed_index['actor_movies']):>8,}")
    print(f"  Starting pool: {starting_after} actors preserved")

    if dry_run:
        print(f"\n  DRY RUN — no files written")
        print(sep)
        return None

    # Step 6: Write trimmed files
    print(f"\n--- Writing trimmed files ---")
    with open(out_graph_path, "wb") as f:
        pickle.dump(G_trimmed, f, protocol=4)
    print(f"  Graph: {out_graph_path} ({fmt_size(out_graph_path)})")

    if trimmed_index:
        with open(out_index_path, "wb") as f:
            pickle.dump(trimmed_index, f, protocol=4)
        print(f"  Index: {out_index_path} ({fmt_size(out_index_path)})")

    if errors:
        print(f"\n  WARNING: {len(errors)} validation error(s) — review output above")
    else:
        print(f"\n  OK: Trim complete!")
    print(sep)

    return G_trimmed, trimmed_index


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Trim actor-actor graph to playable actors only"
    )
    parser.add_argument(
        "--graph",
        type=str,
        default=DEFAULT_GRAPH_PATH,
        help="Path to input graph pickle (default: %(default)s)"
    )
    parser.add_argument(
        "--out",
        type=str,
        default=None,
        help="Path for trimmed graph output (default: <graph>_trimmed.gpickle)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print stats only, do not write files"
    )
    args = parser.parse_args()

    graph_path = args.graph
    if not os.path.exists(graph_path):
        print(f"ERROR: Graph not found at {graph_path}")
        sys.exit(1)

    # Derive paths
    index_path = graph_path.replace(".gpickle", "_actor_movie_index.pickle")

    if args.out:
        out_graph_path = args.out
    else:
        base, ext = os.path.splitext(graph_path)
        out_graph_path = f"{base}{DEFAULT_OUT_SUFFIX}{ext}"

    out_index_path = out_graph_path.replace(".gpickle", "_actor_movie_index.pickle")

    result = trim_pipeline(
        graph_path=graph_path,
        index_path=index_path,
        out_graph_path=out_graph_path,
        out_index_path=out_index_path,
        dry_run=args.dry_run,
    )

    if result is None and not args.dry_run:
        sys.exit(1)


if __name__ == "__main__":
    main()
