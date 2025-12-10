"""
Extract and display actors sorted by popularity/composite score from the graph.
"""

import pickle
import argparse
from pathlib import Path

def load_graph(filepath):
    """Load the pickled graph."""
    with open(filepath, "rb") as f:
        return pickle.load(f)

def get_actors_sorted_by_score(graph):
    """Extract all actors and sort by composite score."""
    actors = []
    
    for node_id, node_data in graph.nodes(data=True):
        if node_data.get('type') == 'actor':
            actors.append({
                'id': node_id,
                'name': node_data.get('name', 'Unknown'),
                'composite_score': node_data.get('composite_score', 0),
                'movie_count': node_data.get('movie_count', 0),
                'image': node_data.get('image', '')
            })
    
    # Sort by composite score (descending)
    actors.sort(key=lambda x: x['composite_score'], reverse=True)
    
    return actors

def print_actors(actors, limit=None):
    """Print actors in a formatted list."""
    if limit:
        actors = actors[:limit]
    
    print(f"\n{'Rank':<6} {'Name':<40} {'Score':<10} {'Movies':<8}")
    print("=" * 70)
    
    for i, actor in enumerate(actors, 1):
        print(f"{i:<6} {actor['name']:<40} {actor['composite_score']:<10.2f} {actor['movie_count']:<8}")
    
    print(f"\nTotal actors: {len(actors)}")

def save_to_csv(actors, output_file):
    """Save actors to a CSV file."""
    import csv
    
    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=['rank', 'name', 'composite_score', 'movie_count', 'image'])
        writer.writeheader()
        
        for i, actor in enumerate(actors, 1):
            writer.writerow({
                'rank': i,
                'name': actor['name'],
                'composite_score': actor['composite_score'],
                'movie_count': actor['movie_count'],
                'image': actor['image']
            })
    
    print(f"\nActors saved to: {output_file}")

def main():
    parser = argparse.ArgumentParser(
        description="List actors from graph sorted by popularity score"
    )
    parser.add_argument(
        "--graph",
        type=str,
        default="actor_movie_graph_hybrid.gpickle",
        help="Path to the graph pickle file (default: actor_movie_graph_hybrid.gpickle)"
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit number of actors to display (default: all)"
    )
    parser.add_argument(
        "--csv",
        type=str,
        default=None,
        help="Save results to CSV file (optional)"
    )
    
    args = parser.parse_args()
    
    # Check if graph file exists
    if not Path(args.graph).exists():
        print(f"ERROR: Graph file not found: {args.graph}")
        print("\nAvailable .gpickle files:")
        for f in Path(".").glob("*.gpickle"):
            print(f"  - {f}")
        return
    
    print(f"Loading graph from: {args.graph}")
    graph = load_graph(args.graph)
    
    print(f"Graph loaded successfully!")
    print(f"Total nodes: {graph.number_of_nodes()}")
    print(f"Total edges: {graph.number_of_edges()}")
    
    # Extract and sort actors
    actors = get_actors_sorted_by_score(graph)
    
    # Display results
    print_actors(actors, args.limit)
    
    # Save to CSV if requested
    if args.csv:
        save_to_csv(actors, args.csv)

if __name__ == "__main__":
    main()