"""
Graph Export Pipeline for Edge Architecture

Transforms the NetworkX actor-actor graph into per-actor JSON files
optimized for edge delivery (Cloudflare R2 / Workers).

Output structure:
/graph/{version}/
  /neighbors/
    {actorId}.json    # Neighbor data for each actor
  /metadata/
    actors.json       # Lightweight actor metadata
    movies.json       # Movie metadata lookup
    starting_pool.json # Starting pool actor IDs
    manifest.json     # Version info and stats

Usage:
  python export_graph_for_edge.py --graph ../backend/global_actor_actor_graph.gpickle --out ./edge_data
"""

import argparse
import json
import os
import pickle
import gzip
import hashlib
from datetime import datetime
from pathlib import Path
from collections import defaultdict


def load_graph(graph_path: str, index_path: str = None):
    """Load the NetworkX graph and actor-movie index."""
    print(f"Loading graph from: {graph_path}")
    with open(graph_path, "rb") as f:
        graph = pickle.load(f)
    print(f"  Nodes: {graph.number_of_nodes()}")
    print(f"  Edges: {graph.number_of_edges()}")

    actor_movie_index = None
    if index_path and os.path.exists(index_path):
        print(f"Loading actor-movie index from: {index_path}")
        with open(index_path, "rb") as f:
            actor_movie_index = pickle.load(f)
        print(f"  Movies: {len(actor_movie_index.get('movies', {}))}")
        print(f"  Actors: {len(actor_movie_index.get('actor_movies', {}))}")

    return graph, actor_movie_index


def extract_actor_id(node: str) -> int:
    """Extract numeric actor ID from node string (e.g., 'actor_12345' -> 12345)."""
    return int(node.split('_')[-1])


def build_neighbors_data(graph, actor_movie_index):
    """
    Build per-actor neighbor data.

    Returns dict: actor_id -> {
        "actorId": int,
        "neighbors": [{"actorId": int, "movies": [{"id": int, "title": str}]}]
    }
    """
    neighbors_data = {}

    for node in graph.nodes():
        actor_id = extract_actor_id(node)
        neighbors = []

        for neighbor_node in graph.neighbors(node):
            neighbor_id = extract_actor_id(neighbor_node)
            edge_data = graph.edges[node, neighbor_node]

            # Get movies connecting these actors
            movies = edge_data.get('movies', [])
            movie_list = []
            for m in movies:
                movie_list.append({
                    "id": m['id'],
                    "title": m['title'],
                    "poster": m.get('poster_path') or '',
                    "pop": round(m.get('popularity', 0), 1)  # Compact popularity
                })

            # Sort by popularity (descending) and limit to top 5 movies per edge
            movie_list.sort(key=lambda x: x['pop'], reverse=True)
            movie_list = movie_list[:5]

            neighbors.append({
                "actorId": neighbor_id,
                "movies": movie_list
            })

        # Sort neighbors by number of shared movies (most connected first)
        neighbors.sort(key=lambda x: len(x['movies']), reverse=True)

        neighbors_data[actor_id] = {
            "actorId": actor_id,
            "neighbors": neighbors
        }

    return neighbors_data


def build_actors_metadata(graph):
    """
    Build lightweight actor metadata.

    Returns dict: actor_id -> {
        "id": int,
        "name": str,
        "image": str (profile path only, not full URL),
        "inStartingPool": bool
    }
    """
    actors = {}

    for node, data in graph.nodes(data=True):
        actor_id = extract_actor_id(node)
        actors[actor_id] = {
            "id": actor_id,
            "name": data.get('name', 'Unknown'),
            "image": data.get('profile_path') or data.get('image', ''),
            "pool": data.get('in_starting_pool', False)
        }

    return actors


def _extract_year(release_date):
    """Extract 4-digit year from a release_date string like '1999-10-15'."""
    if release_date and isinstance(release_date, str) and len(release_date) >= 4:
        return release_date[:4]
    return None


def build_movies_metadata(graph, actor_movie_index):
    """
    Build movie metadata lookup.

    Returns dict: movie_id -> {
        "id": int,
        "title": str,
        "poster": str,
    }

    Movies with duplicate titles get "(YYYY)" appended for disambiguation.
    """
    movies = {}

    # Extract from edge data
    for u, v, edge_data in graph.edges(data=True):
        for m in edge_data.get('movies', []):
            movie_id = m['id']
            if movie_id not in movies:
                movies[movie_id] = {
                    "id": movie_id,
                    "title": m['title'],
                    "poster": m.get('poster_path') or '',
                    "_year": _extract_year(m.get('release_date')),
                }

    # Supplement with actor_movie_index if available (fill missing posters/years)
    if actor_movie_index:
        for movie_id, m in actor_movie_index.get('movies', {}).items():
            poster = m.get('poster_path') or ''
            year = _extract_year(m.get('release_date'))
            if movie_id not in movies:
                movies[movie_id] = {
                    "id": movie_id,
                    "title": m['title'],
                    "poster": poster,
                    "_year": year,
                }
            else:
                if not movies[movie_id].get('poster') and poster:
                    movies[movie_id]['poster'] = poster
                if not movies[movie_id].get('_year') and year:
                    movies[movie_id]['_year'] = year

    # Disambiguate duplicate titles by appending year
    from collections import defaultdict
    title_ids = defaultdict(list)
    for movie_id, m in movies.items():
        title_ids[m['title']].append(movie_id)

    for title, ids in title_ids.items():
        if len(ids) > 1:
            for movie_id in ids:
                year = movies[movie_id].get('_year')
                if year:
                    movies[movie_id]['title'] = f"{title} ({year})"

    # Remove internal _year field
    for m in movies.values():
        m.pop('_year', None)

    return movies


def build_starting_pool(graph):
    """Get list of actor IDs in the starting pool."""
    return [
        extract_actor_id(n)
        for n in graph.nodes()
        if graph.nodes[n].get('in_starting_pool', False)
    ]


def compute_checksum(data: dict) -> str:
    """Compute SHA256 checksum of JSON data."""
    json_str = json.dumps(data, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(json_str.encode()).hexdigest()[:16]


def write_json(path: Path, data: dict, compress: bool = True):
    """Write JSON file, optionally gzip compressed."""
    path.parent.mkdir(parents=True, exist_ok=True)

    json_str = json.dumps(data, separators=(',', ':'), ensure_ascii=False)

    if compress:
        gz_path = path.with_suffix('.json.gz')
        with gzip.open(gz_path, 'wt', encoding='utf-8') as f:
            f.write(json_str)
        return gz_path, len(json_str)
    else:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(json_str)
        return path, len(json_str)


def export_graph(graph_path: str, output_dir: str, version: str = None, compress: bool = True):
    """
    Export graph to edge-optimized format.

    Args:
        graph_path: Path to .gpickle file
        output_dir: Output directory
        version: Version string (default: vYYYYMMDD)
        compress: Whether to gzip compress files
    """
    # Derive index path from graph path
    index_path = graph_path.replace('.gpickle', '_actor_movie_index.pickle')

    # Load data
    graph, actor_movie_index = load_graph(graph_path, index_path)

    # Generate version if not provided
    if not version:
        version = f"v{datetime.now().strftime('%Y%m%d')}"

    print(f"\nExporting graph version: {version}")

    # Build all data structures
    print("\nBuilding neighbor data...")
    neighbors_data = build_neighbors_data(graph, actor_movie_index)

    print("Building actor metadata...")
    actors_data = build_actors_metadata(graph)

    print("Building movie metadata...")
    movies_data = build_movies_metadata(graph, actor_movie_index)

    print("Building starting pool...")
    starting_pool = build_starting_pool(graph)

    # Output paths
    base_path = Path(output_dir) / "graph" / version
    neighbors_path = base_path / "neighbors"
    metadata_path = base_path / "metadata"

    # Stats tracking
    stats = {
        "version": version,
        "actors": len(actors_data),
        "movies": len(movies_data),
        "edges": graph.number_of_edges(),
        "starting_pool": len(starting_pool),
        "files": 0,
        "total_size_bytes": 0,
        "neighbor_files": {
            "count": 0,
            "min_size": float('inf'),
            "max_size": 0,
            "avg_size": 0
        }
    }

    neighbor_sizes = []

    # Write neighbor files
    print(f"\nWriting neighbor files to {neighbors_path}...")
    for actor_id, data in neighbors_data.items():
        file_path = neighbors_path / f"{actor_id}.json"
        ext = '.json.gz' if compress else '.json'
        written_path, size = write_json(file_path, data, compress)

        neighbor_sizes.append(size)
        stats["files"] += 1
        stats["total_size_bytes"] += size

    stats["neighbor_files"]["count"] = len(neighbor_sizes)
    stats["neighbor_files"]["min_size"] = min(neighbor_sizes) if neighbor_sizes else 0
    stats["neighbor_files"]["max_size"] = max(neighbor_sizes) if neighbor_sizes else 0
    stats["neighbor_files"]["avg_size"] = sum(neighbor_sizes) // len(neighbor_sizes) if neighbor_sizes else 0

    # Write metadata files
    print(f"Writing metadata files to {metadata_path}...")

    # actors.json - full actor metadata
    write_json(metadata_path / "actors.json", actors_data, compress)
    stats["files"] += 1

    # movies.json - movie lookup
    write_json(metadata_path / "movies.json", movies_data, compress)
    stats["files"] += 1

    # starting_pool.json - list of starting pool actor IDs
    write_json(metadata_path / "starting_pool.json", {"actors": starting_pool}, compress)
    stats["files"] += 1

    # manifest.json - version info (always uncompressed for easy reading)
    manifest = {
        "version": version,
        "generated_at": datetime.now().isoformat(),
        "stats": {
            "actors": stats["actors"],
            "movies": stats["movies"],
            "edges": stats["edges"],
            "starting_pool": stats["starting_pool"],
        },
        "checksum": compute_checksum({"actors": actors_data, "movies": movies_data})
    }
    write_json(metadata_path / "manifest.json", manifest, compress=False)
    stats["files"] += 1

    # Print summary
    print(f"\n{'='*60}")
    print(f"EXPORT COMPLETE")
    print(f"{'='*60}")
    print(f"Version:        {version}")
    print(f"Output:         {base_path}")
    print(f"Total files:    {stats['files']}")
    print(f"Actors:         {stats['actors']}")
    print(f"Movies:         {stats['movies']}")
    print(f"Edges:          {stats['edges']}")
    print(f"Starting pool:  {stats['starting_pool']}")
    print(f"\nNeighbor files:")
    print(f"  Count:        {stats['neighbor_files']['count']}")
    print(f"  Min size:     {stats['neighbor_files']['min_size']:,} bytes")
    print(f"  Max size:     {stats['neighbor_files']['max_size']:,} bytes")
    print(f"  Avg size:     {stats['neighbor_files']['avg_size']:,} bytes")
    print(f"{'='*60}")

    # Also write a "latest" symlink/file for easy access
    latest_path = Path(output_dir) / "graph" / "latest.json"
    write_json(latest_path, {"version": version}, compress=False)

    return stats


def main():
    parser = argparse.ArgumentParser(
        description="Export graph for edge architecture"
    )
    parser.add_argument(
        "--graph",
        type=str,
        default="../backend/global_actor_actor_graph.gpickle",
        help="Path to graph pickle file"
    )
    parser.add_argument(
        "--out",
        type=str,
        default="./edge_data",
        help="Output directory"
    )
    parser.add_argument(
        "--version",
        type=str,
        default=None,
        help="Version string (default: vYYYYMMDD)"
    )
    parser.add_argument(
        "--no-compress",
        action="store_true",
        help="Skip gzip compression"
    )

    args = parser.parse_args()

    if not os.path.exists(args.graph):
        print(f"ERROR: Graph file not found: {args.graph}")
        return 1

    export_graph(
        graph_path=args.graph,
        output_dir=args.out,
        version=args.version,
        compress=not args.no_compress
    )

    return 0


if __name__ == "__main__":
    exit(main())
