"""
Build Actor-Actor Graph with Centrality Measures

This script constructs an actor-actor graph from TMDb data where:
- Nodes are actors
- Edges connect actors who appeared in the same movie
- Edge weights represent collaboration strength (based on movie popularity and cast size)
- Centrality measures (weighted degree + betweenness) determine actor importance
- Three-tier selection: full graph → 500 playable → 100 starting pool

Per PRD: Structure over popularity, measure once play many.
"""

import os
import pickle
import time
import argparse
import random
import math
from collections import defaultdict
from dotenv import load_dotenv
import requests
import networkx as nx
from tqdm import tqdm

load_dotenv()

API_KEY = os.getenv("TMDB_API_KEY")
BASE_URL = "https://api.themoviedb.org/3"

def fetch_popular_movies(min_votes=100, max_pages=100):
    """
    Fetch popular movies from TMDb (global).

    Args:
        min_votes: Minimum vote count threshold
        max_pages: Maximum pages to fetch

    Returns:
        List of movie dicts with id, title, popularity, etc.
    """
    print(f"\n=== Fetching Popular Movies (min {min_votes} votes, up to {max_pages} pages) ===")
    movies = []
    page = 1

    while page <= max_pages:
        url = f"{BASE_URL}/discover/movie"
        params = {
            "api_key": API_KEY,
            "page": page,
            "sort_by": "popularity.desc",
            "vote_count.gte": min_votes
        }

        try:
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()

            results = data.get("results", [])
            if not results:
                break

            for movie in results:
                movies.append({
                    "id": movie["id"],
                    "title": movie["title"],
                    "popularity": movie.get("popularity", 0),
                    "release_date": movie.get("release_date", "")
                })

            if page % 10 == 0:
                print(f"  Fetched {len(movies)} movies (page {page})...")

            page += 1
            time.sleep(0.25)

        except Exception as e:
            print(f"Error fetching page {page}: {e}")
            break

    print(f"OK: Fetched {len(movies)} movies (global popular)\n")
    return movies


def extract_cast_from_movies(movies, top_n_cast=10):
    """
    Extract cast with billing order (cast_order) and vote_count from each movie.

    NEW: Captures cast_order for StartActorScore computation and vote_count
    for audience validation threshold.

    Args:
        movies: List of movie dicts
        top_n_cast: Number of top-billed cast to extract per movie

    Returns:
        Dict mapping movie_id -> dict with cast list (including cast_order) and metadata
    """
    print(f"=== Extracting Top {top_n_cast} Cast with Billing Order from {len(movies)} Movies ===")

    movie_cast_data = {}

    for i, movie in enumerate(tqdm(movies, desc="Fetching cast & details")):
        movie_id = movie["id"]

        try:
            # Get credits (cast with billing order)
            credits_url = f"{BASE_URL}/movie/{movie_id}/credits"
            params = {"api_key": API_KEY}
            credits_response = requests.get(credits_url, params=params, timeout=10)
            credits_response.raise_for_status()
            credits_data = credits_response.json()

            # Get movie details (for vote_count)
            details_url = f"{BASE_URL}/movie/{movie_id}"
            details_response = requests.get(details_url, params=params, timeout=10)
            details_response.raise_for_status()
            details_data = details_response.json()

            cast_list = []
            for person in credits_data.get("cast", [])[:top_n_cast]:
                cast_list.append({
                    "id": person["id"],
                    "name": person["name"],
                    "profile_path": person.get("profile_path"),
                    "cast_order": person.get("order", 999)  # NEW: Billing position
                })

            if cast_list:
                movie_cast_data[movie_id] = {
                    "title": movie["title"],
                    "popularity": movie["popularity"],
                    "release_date": movie["release_date"],
                    "vote_count": details_data.get("vote_count", 0),  # NEW: For StartActorScore
                    "poster_path": details_data.get("poster_path"),  # Added for completeness
                    "cast": cast_list,
                    "cast_size": len(cast_list)
                }

            time.sleep(0.15)  # Longer delay due to 2 API calls

        except Exception as e:
            print(f"Error fetching data for movie {movie_id}: {e}")
            continue

    print(f"OK: Extracted cast with billing order from {len(movie_cast_data)} movies\n")
    return movie_cast_data


def build_actor_movie_index(movie_cast_data, min_votes=100, max_pages=100):
    """
    Build comprehensive actor-movie index for StartActorScore computation.

    Creates a complete index of ALL movies and their cast relationships,
    including cast_order for billing-weighted exposure calculations.

    Args:
        movie_cast_data: Dict from extract_cast_from_movies() with cast_order
        min_votes: Min vote threshold used during ingestion (for metadata)
        max_pages: Max pages fetched (for metadata)

    Returns:
        Dict with structure:
        {
            "movies": {movie_id: {id, title, popularity, vote_count, ...}},
            "actor_movies": {actor_id: [{movie_id, cast_order, ...}]},
            "metadata": {build_date, total_actors, total_movies, ...}
        }
    """
    from datetime import datetime

    print("=== Building Actor-Movie Index ===")

    index = {
        "movies": {},
        "actor_movies": defaultdict(list),
        "metadata": {}
    }

    # Build movies dict
    print("Indexing all movies...")
    for movie_id, movie_data in movie_cast_data.items():
        index["movies"][movie_id] = {
            "id": movie_id,
            "title": movie_data["title"],
            "popularity": movie_data["popularity"],
            "vote_count": movie_data.get("vote_count", 0),
            "poster_path": movie_data.get("poster_path"),
            "release_date": movie_data["release_date"],
            "cast_size": movie_data["cast_size"]
        }

    # Build actor_movies dict (reverse index)
    print("Building actor filmographies with billing order...")
    for movie_id, movie_data in movie_cast_data.items():
        for cast_member in movie_data["cast"]:
            actor_id = cast_member["id"]
            index["actor_movies"][actor_id].append({
                "movie_id": movie_id,
                "cast_order": cast_member["cast_order"],
                "popularity": movie_data["popularity"],
                "vote_count": movie_data.get("vote_count", 0),
                "title": movie_data["title"]
            })

    # Convert defaultdict to regular dict for pickling
    index["actor_movies"] = dict(index["actor_movies"])

    # Add metadata
    index["metadata"] = {
        "build_date": datetime.now().isoformat(),
        "total_actors": len(index["actor_movies"]),
        "total_movies": len(index["movies"]),
        "min_votes": min_votes,
        "max_pages": max_pages
    }

    print(f"OK: Actor-movie index built:")
    print(f"  Movies: {len(index['movies'])}")
    print(f"  Actors: {len(index['actor_movies'])}")
    print(f"  Avg movies per actor: {sum(len(v) for v in index['actor_movies'].values()) / len(index['actor_movies']):.1f}\n")

    return index


def compute_start_actor_score(actor_id, actor_movies_list):
    """
    Compute StartActorScore for a single actor based on exposure-weighted credits.

    Implements PRD scoring methodology:
    - Eligibility: vote_count >= 10k, cast_order <= 5, min 3 qualifying credits
    - Per-credit exposure: log(1 + vote_count) * billing_weight
    - Top-K aggregation (K=15)
    - HHI concentration metric

    Args:
        actor_id: TMDb actor ID
        actor_movies_list: List of movie dicts with movie_id, cast_order, vote_count

    Returns:
        Dict with:
        - eligibility_met: bool
        - top_k_credits: List of top credits (sorted by exposure)
        - exposure_score: float (sum of top K exposures)
        - hhi_score: float (concentration metric)
        - hhi_normalized: float (0-1 normalized HHI)
        - final_score: float (weighted combination)
        - num_eligible_credits: int
        - K: int (credits used)
        - reason: str (if not eligible)
    """
    # Thresholds (per PRD)
    MIN_VOTE_COUNT = 10000
    MAX_CAST_ORDER = 5
    MIN_ELIGIBLE_CREDITS = 3
    K = 15  # Top-K aggregation

    # Filter to eligible credits
    eligible_credits = []
    for credit in actor_movies_list:
        if credit["vote_count"] >= MIN_VOTE_COUNT and credit["cast_order"] <= MAX_CAST_ORDER:
            # Compute billing weight
            billing_weight = 1.0 / (1.0 + credit["cast_order"])

            # Compute exposure score
            exposure = math.log(1 + credit["vote_count"]) * billing_weight

            # Store computed values
            credit_copy = credit.copy()
            credit_copy["billing_weight"] = billing_weight
            credit_copy["exposure_score"] = exposure
            eligible_credits.append(credit_copy)

    # Check eligibility threshold
    if len(eligible_credits) < MIN_ELIGIBLE_CREDITS:
        return {
            "eligibility_met": False,
            "final_score": 0.0,
            "reason": f"Insufficient prominent credits ({len(eligible_credits)} < {MIN_ELIGIBLE_CREDITS})",
            "num_eligible_credits": len(eligible_credits),
            "exposure_score": 0.0,
            "hhi_score": 0.0,
            "hhi_normalized": 0.0,
            "K": K,
            "top_k_credits": []
        }

    # Sort by exposure and take top K
    eligible_credits.sort(key=lambda c: c["exposure_score"], reverse=True)
    top_k = eligible_credits[:K]

    # Compute aggregate exposure score
    total_exposure = sum(c["exposure_score"] for c in top_k)

    # Compute HHI concentration score
    if total_exposure > 0:
        shares = [(c["exposure_score"] / total_exposure) for c in top_k]
        hhi = sum(s**2 for s in shares)
    else:
        hhi = 0.0

    # Normalize HHI to [0, 1]
    # HHI ranges from 1/K (perfectly balanced) to 1.0 (all in one credit)
    # We want higher concentration to be a positive signal, so we keep HHI as-is
    # But normalize to 0-1 range for weighting
    min_hhi = 1.0 / K if K > 0 else 0.0
    max_hhi = 1.0
    if max_hhi > min_hhi:
        hhi_normalized = (hhi - min_hhi) / (max_hhi - min_hhi)
    else:
        hhi_normalized = 0.5

    # Compute final score (weighted combination)
    # PRD: Exposure dominates (85%), HHI as tie-breaker (15%)
    final_score = (0.85 * total_exposure) + (0.15 * hhi_normalized * 100)

    return {
        "eligibility_met": True,
        "top_k_credits": top_k,
        "exposure_score": total_exposure,
        "hhi_score": hhi,
        "hhi_normalized": hhi_normalized,
        "final_score": final_score,
        "num_eligible_credits": len(eligible_credits),
        "K": K
    }


def rank_actors_by_start_score(actor_movie_index):
    """
    Rank all actors by StartActorScore.

    Args:
        actor_movie_index: Dict with "actor_movies" mapping actor_id -> filmography

    Returns:
        List of (actor_id, final_score, metrics_dict) tuples, sorted descending by score
    """
    print("=== Computing StartActorScore for All Actors ===")

    actor_scores = []

    for actor_id, movies_list in tqdm(actor_movie_index["actor_movies"].items(), desc="Scoring actors"):
        result = compute_start_actor_score(actor_id, movies_list)
        if result["eligibility_met"]:
            actor_scores.append((actor_id, result["final_score"], result))

    # Sort by final_score descending
    actor_scores.sort(key=lambda x: x[1], reverse=True)

    print(f"OK: Scored {len(actor_scores)} eligible actors")
    if actor_scores:
        print(f"  Score range: [{actor_scores[-1][1]:.2f}, {actor_scores[0][1]:.2f}]\n")

    return actor_scores


def apply_start_actor_scores_to_graph(G, actor_scores_ranked, actor_movie_index, top_n=100):
    """
    Mark top N actors in graph with in_starting_pool=True based on StartActorScore.

    Args:
        G: NetworkX graph
        actor_scores_ranked: List of (actor_id, score, metrics) tuples from rank_actors_by_start_score()
        actor_movie_index: Actor-movie index (for name lookup)
        top_n: Number of actors for starting pool

    Returns:
        Modified graph (in place), list of starting pool actor node IDs
    """
    print(f"=== Marking Top {top_n} Actors by StartActorScore ===")

    # Reset all actors
    for node in G.nodes():
        G.nodes[node]['in_starting_pool'] = False

    # Mark top N by StartActorScore
    starting_pool_nodes = []
    for actor_id, score, metrics in actor_scores_ranked[:top_n]:
        actor_node = f"actor_{actor_id}"
        if actor_node in G.nodes():
            G.nodes[actor_node]['in_starting_pool'] = True
            G.nodes[actor_node]['start_actor_score'] = score
            starting_pool_nodes.append(actor_node)

    print(f"OK: Starting pool marked: {len(starting_pool_nodes)} actors")
    if actor_scores_ranked:
        print(f"  Score range: [{actor_scores_ranked[min(top_n-1, len(actor_scores_ranked)-1)][1]:.2f}, "
              f"{actor_scores_ranked[0][1]:.2f}]\n")

    return G, starting_pool_nodes


def generate_audit_csv(actor_scores_ranked, actor_movie_index, output_path):
    """
    Generate CSV audit report with top 100 actors and all metrics.

    CSV format per PRD requirements.

    Args:
        actor_scores_ranked: List of (actor_id, score, metrics) tuples
        actor_movie_index: Actor-movie index (for name lookup)
        output_path: CSV file path

    Returns:
        None (writes CSV file)
    """
    import csv

    print(f"=== Generating Audit Report: {output_path} ===")

    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow([
            "rank", "actor_id", "actor_name", "final_score",
            "exposure_score", "hhi_score", "hhi_normalized",
            "num_eligible_credits", "top_k_count",
            "top_movie_1", "top_movie_2", "top_movie_3"
        ])

        for rank, (actor_id, score, metrics) in enumerate(actor_scores_ranked[:100], start=1):
            # Get actor name from first movie in their filmography
            actor_name = "Unknown"
            if actor_id in actor_movie_index["actor_movies"] and actor_movie_index["actor_movies"][actor_id]:
                # Try to get name from movies, but we don't have it stored
                # We'll need to look it up from the graph or store it
                actor_name = f"Actor_{actor_id}"  # Placeholder

            top_movies = metrics["top_k_credits"][:3]

            writer.writerow([
                rank,
                actor_id,
                actor_name,
                f"{score:.4f}",
                f"{metrics['exposure_score']:.4f}",
                f"{metrics['hhi_score']:.4f}",
                f"{metrics['hhi_normalized']:.4f}",
                metrics["num_eligible_credits"],
                metrics["K"],
                top_movies[0]["title"] if len(top_movies) > 0 else "",
                top_movies[1]["title"] if len(top_movies) > 1 else "",
                top_movies[2]["title"] if len(top_movies) > 2 else ""
            ])

    print(f"OK: Audit CSV generated with {min(100, len(actor_scores_ranked))} actors\n")


def persist_actor_movie_index(index, output_path):
    """
    Save actor-movie index to disk using pickle.

    Args:
        index: Actor-movie index dict
        output_path: Pickle file path (derived from graph path)

    Returns:
        None (writes pickle file)
    """
    print(f"=== Saving Actor-Movie Index to {output_path} ===")

    with open(output_path, 'wb') as f:
        pickle.dump(index, f, protocol=4)

    file_size = os.path.getsize(output_path) / (1024 * 1024)
    print(f"OK: Actor-movie index saved ({file_size:.2f} MB)\n")


def calculate_edge_weight(movie_popularity, cast_size):
    """
    Calculate edge weight for a single movie collaboration.

    Formula: movie_popularity / sqrt(cast_size)

    Rationale: Smaller casts and more popular movies = stronger bonds
    """
    if cast_size == 0:
        return 0.0
    return movie_popularity / math.sqrt(cast_size)


def build_full_actor_graph(movie_cast_data):
    """
    Build actor-actor graph from movie cast data.

    Creates:
    - Actor nodes with basic attributes
    - Edges between actors who worked together
    - Edge attributes: weight, movies list

    Returns:
        NetworkX Graph with actor nodes and weighted edges
    """
    print("=== Building Full Actor-Actor Graph ===")

    G = nx.Graph()

    # Track actor info
    actor_info = {}

    # Track edges and their movie lists
    edge_movies = defaultdict(list)
    edge_weights = defaultdict(float)

    # Process each movie
    for movie_id, movie_data in tqdm(movie_cast_data.items(), desc="Processing movies"):
        cast = movie_data["cast"]

        # Store actor info
        for actor in cast:
            actor_id = f"actor_{actor['id']}"
            if actor_id not in actor_info:
                actor_info[actor_id] = {
                    "name": actor["name"],
                    "tmdb_id": actor["id"],
                    "profile_path": actor["profile_path"]
                }

        # Create edges between all cast pairs (co-stars)
        for i in range(len(cast)):
            for j in range(i + 1, len(cast)):
                actor1_id = f"actor_{cast[i]['id']}"
                actor2_id = f"actor_{cast[j]['id']}"

                # Create edge key (sorted for undirected graph)
                edge = tuple(sorted([actor1_id, actor2_id]))

                # Calculate weight for this movie
                weight = calculate_edge_weight(
                    movie_data["popularity"],
                    movie_data["cast_size"]
                )

                # Accumulate weight
                edge_weights[edge] += weight

                # Add movie to edge metadata
                edge_movies[edge].append({
                    "id": movie_id,
                    "title": movie_data["title"],
                    "poster_path": None,  # Will be populated if needed
                    "popularity": movie_data["popularity"],
                    "cast_size": movie_data["cast_size"],
                    "release_date": movie_data["release_date"]
                })

    # Add nodes
    print("Adding actor nodes...")
    for actor_id, info in actor_info.items():
        G.add_node(
            actor_id,
            type="actor",
            name=info["name"],
            tmdb_id=info["tmdb_id"],
            profile_path=info["profile_path"],
            image=f"https://image.tmdb.org/t/p/w185{info['profile_path']}" if info["profile_path"] else None
        )

    # Add edges
    print("Adding weighted edges...")
    for edge, weight in edge_weights.items():
        actor1, actor2 = edge
        movies = edge_movies[edge]

        # Limit to top 50 most popular shared movies (increased from 10 for better validation)
        TOP_K_MOVIES_PER_EDGE = 50
        movies_sorted = sorted(movies, key=lambda m: m["popularity"], reverse=True)[:TOP_K_MOVIES_PER_EDGE]

        G.add_edge(
            actor1,
            actor2,
            weight=weight,
            movies=movies_sorted
        )

    print(f"OK: Graph built:")
    print(f"  Actors: {G.number_of_nodes()}")
    print(f"  Edges: {G.number_of_edges()}")
    print(f"  Avg degree: {2 * G.number_of_edges() / G.number_of_nodes():.2f}\n")

    return G


def minmax_normalize(values_dict):
    """Min-max normalization to [0, 1]."""
    if not values_dict:
        return {}

    vals = list(values_dict.values())
    min_v = min(vals)
    max_v = max(vals)

    if max_v == min_v:
        return {k: 0.5 for k in values_dict.keys()}

    return {k: (v - min_v) / (max_v - min_v) for k, v in values_dict.items()}


def compute_centrality_measures(G):
    """
    Compute centrality measures on the full actor graph.

    Computes:
    1. Weighted degree centrality (sum of edge weights)
    2. Betweenness centrality (approximate, k-sampled)
    3. Composite score = 0.7 * norm_wd + 0.3 * norm_bw

    Adds attributes to nodes:
    - weighted_degree: Raw weighted degree
    - betweenness: Normalized betweenness [0,1]
    - composite_score: Final ranking score [0,1]
    """
    print("=== Computing Centrality Measures ===")

    # 1. Weighted Degree Centrality
    print("Computing weighted degree centrality...")
    weighted_degrees = {}
    for node in G.nodes():
        wd = sum(G[node][neighbor]['weight'] for neighbor in G.neighbors(node))
        weighted_degrees[node] = wd

    print(f"  Range: [{min(weighted_degrees.values()):.2f}, {max(weighted_degrees.values()):.2f}]")

    # 2. Betweenness Centrality (Approximate)
    print("Computing betweenness centrality (approximate, k=100)...")

    # Create distance graph (inverse of weights for shortest path)
    G_dist = G.copy()
    for u, v in G_dist.edges():
        G_dist[u][v]['distance'] = 1.0 / G_dist[u][v]['weight']

    # Sample k nodes for approximate betweenness
    k = min(100, G.number_of_nodes())
    sampled_nodes = random.sample(list(G.nodes()), k)

    betweenness = nx.betweenness_centrality_subset(
        G_dist,
        sources=sampled_nodes,
        targets=sampled_nodes,
        weight='distance',
        normalized=True
    )

    # Fill in zero for nodes not sampled
    for node in G.nodes():
        if node not in betweenness:
            betweenness[node] = 0.0

    print(f"  Range: [{min(betweenness.values()):.4f}, {max(betweenness.values()):.4f}]")

    # 3. Normalize and create composite score
    print("Creating composite scores...")

    norm_wd = minmax_normalize(weighted_degrees)
    norm_bw = minmax_normalize(betweenness)

    composite_scores = {}
    for node in G.nodes():
        composite_scores[node] = 0.7 * norm_wd[node] + 0.3 * norm_bw[node]

    print(f"  Composite range: [{min(composite_scores.values()):.4f}, {max(composite_scores.values()):.4f}]")

    # 4. Add to node attributes
    print("Adding centrality attributes to nodes...")
    for node in G.nodes():
        G.nodes[node]['weighted_degree'] = weighted_degrees[node]
        G.nodes[node]['betweenness'] = betweenness[node]
        G.nodes[node]['composite_score'] = composite_scores[node]

    print("OK: Centrality computation complete\n")

    return G


def select_playable_actors(G, top_n=500):
    """
    Select top N actors by composite score for playable graph.

    Creates induced subgraph and validates connectivity.
    Marks nodes with in_playable_graph=True.

    Args:
        G: Full actor graph with centrality measures
        top_n: Number of actors to select

    Returns:
        Graph (modified in place), list of selected actor nodes
    """
    print(f"=== Selecting Top {top_n} Actors for Playable Graph ===")

    # Rank by composite score
    ranked_actors = sorted(
        G.nodes(),
        key=lambda n: G.nodes[n].get('composite_score', 0),
        reverse=True
    )

    # Try different cutoffs if needed for connectivity
    cutoff = top_n
    max_attempts = 5

    for attempt in range(1, max_attempts + 1):
        if cutoff > len(ranked_actors):
            cutoff = len(ranked_actors)

        selected = ranked_actors[:cutoff]
        G_playable = G.subgraph(selected).copy()

        print(f"  Attempt {attempt}: Testing {cutoff} actors...")
        print(f"    Nodes: {G_playable.number_of_nodes()}")
        print(f"    Edges: {G_playable.number_of_edges()}")

        # Check connectivity
        if nx.is_connected(G_playable):
            print(f"  OK: Graph is connected!")

            # Mark nodes
            for node in selected:
                G.nodes[node]['in_playable_graph'] = True

            # Mark remaining as not in playable graph
            for node in G.nodes():
                if node not in selected:
                    G.nodes[node]['in_playable_graph'] = False

            print(f"OK: Playable graph selected: {len(selected)} actors\n")
            return G, selected
        else:
            print(f"  X: Graph not fully connected, increasing cutoff...")
            cutoff += 50

    # Fallback: use what we have even if not fully connected
    print(f"  Warning: Could not achieve full connectivity, using {cutoff} actors anyway")
    selected = ranked_actors[:cutoff]
    for node in selected:
        G.nodes[node]['in_playable_graph'] = True
    for node in G.nodes():
        if node not in selected:
            G.nodes[node]['in_playable_graph'] = False

    return G, selected


def select_starting_pool(G, playable_actors, top_n=100):
    """
    Select top N actors from playable actors for starting pool.

    Simply takes top N by composite score.
    Marks nodes with in_starting_pool=True.

    Args:
        G: Full graph
        playable_actors: List of playable actor nodes
        top_n: Number of actors for starting pool

    Returns:
        Graph (modified in place), list of starting pool actors
    """
    print(f"=== Selecting Top {top_n} Actors for Starting Pool ===")

    # Rank playable actors by composite score
    ranked = sorted(
        playable_actors,
        key=lambda n: G.nodes[n].get('composite_score', 0),
        reverse=True
    )

    starting_pool = ranked[:min(top_n, len(ranked))]

    # Mark nodes
    for node in G.nodes():
        G.nodes[node]['in_starting_pool'] = (node in starting_pool)

    print(f"OK: Starting pool selected: {len(starting_pool)} actors")
    print(f"  Score range: [{G.nodes[starting_pool[-1]]['composite_score']:.4f}, "
          f"{G.nodes[starting_pool[0]]['composite_score']:.4f}]\n")

    return G, starting_pool


def print_top_actors(G, n=20):
    """Print top N actors by composite score for manual review."""
    print(f"=== Top {n} Actors by Composite Score ===")

    ranked = sorted(
        G.nodes(),
        key=lambda node: G.nodes[node].get('composite_score', 0),
        reverse=True
    )

    for i, node in enumerate(ranked[:n], 1):
        data = G.nodes[node]
        print(f"{i:2d}. {data['name']:30s} | Score: {data['composite_score']:.4f} | "
              f"WD: {data['weighted_degree']:6.1f} | BW: {data['betweenness']:.4f}")
    print()


def persist_graph(G, output_path):
    """Save graph to disk using pickle."""
    print(f"=== Saving Graph to {output_path} ===")

    with open(output_path, 'wb') as f:
        pickle.dump(G, f, protocol=4)

    file_size = os.path.getsize(output_path) / (1024 * 1024)
    print(f"OK: Graph saved ({file_size:.2f} MB)\n")


def main():
    parser = argparse.ArgumentParser(
        description="Build actor-actor graph with centrality measures (US region)"
    )
    parser.add_argument(
        "--out",
        type=str,
        default="../backend/global_actor_actor_graph.gpickle",
        help="Output file path"
    )
    parser.add_argument(
        "--top",
        type=int,
        default=500,
        help="Number of top actors for playable graph"
    )
    parser.add_argument(
        "--starting",
        type=int,
        default=100,
        help="Number of actors for starting pool"
    )
    parser.add_argument(
        "--min-votes",
        type=int,
        default=100,
        help="Minimum vote count for movies"
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=100,
        help="Maximum pages of movies to fetch"
    )

    args = parser.parse_args()

    if not API_KEY:
        print("ERROR: TMDB_API_KEY not found in environment!")
        print("Please create a .env file with your TMDb API key.")
        return

    print(f"\n{'='*70}")
    print(f"BUILDING ACTOR-ACTOR GRAPH WITH CENTRALITY MEASURES")
    print(f"{'='*70}")
    print(f"API Key: {API_KEY[:10]}...")
    print(f"Target: {args.top} playable actors, {args.starting} starting pool")
    print(f"{'='*70}\n")

    # Step 1: Fetch popular movies (global)
    movies = fetch_popular_movies(min_votes=args.min_votes, max_pages=args.max_pages)

    if not movies:
        print("ERROR: No movies fetched!")
        return

    # Step 2: Extract cast
    movie_cast_data = extract_cast_from_movies(movies, top_n_cast=10)

    if not movie_cast_data:
        print("ERROR: No cast data extracted!")
        return

    # Step 3: Build full actor graph
    G = build_full_actor_graph(movie_cast_data)

    # Step 4: Compute centrality measures
    G = compute_centrality_measures(G)

    # Step 5: Select playable actors (top 500)
    G, playable_actors = select_playable_actors(G, top_n=args.top)

    # Step 6: Build actor-movie index (NEW - for StartActorScore)
    actor_movie_index = build_actor_movie_index(
        movie_cast_data,
        min_votes=args.min_votes,
        max_pages=args.max_pages
    )

    # Step 7: Compute StartActorScore (NEW - replaces centrality-based selection)
    actor_scores_ranked = rank_actors_by_start_score(actor_movie_index)

    # Step 8: Apply StartActorScore to graph (NEW - mark top N actors)
    G, starting_pool_nodes = apply_start_actor_scores_to_graph(
        G, actor_scores_ranked, actor_movie_index, top_n=args.starting
    )

    # Step 9: Generate audit CSV (NEW - PRD requirement)
    csv_path = args.out.replace('.gpickle', '_start_actor_audit.csv')
    generate_audit_csv(actor_scores_ranked, actor_movie_index, csv_path)

    # Step 10: Print top actors by StartActorScore for review
    print("=== Top 20 Actors by StartActorScore ===")
    for i, (actor_id, score, metrics) in enumerate(actor_scores_ranked[:20], 1):
        actor_node = f"actor_{actor_id}"
        if actor_node in G.nodes():
            name = G.nodes[actor_node].get('name', f'Actor_{actor_id}')
            print(f"{i:2d}. {name:30s} | Score: {score:7.2f} | "
                  f"Exposure: {metrics['exposure_score']:7.2f} | HHI: {metrics['hhi_score']:.4f}")
    print()

    # Step 11: Persist both graph and actor-movie index
    persist_graph(G, args.out)
    index_path = args.out.replace('.gpickle', '_actor_movie_index.pickle')
    persist_actor_movie_index(actor_movie_index, index_path)

    # Final summary
    print("="*70)
    print("SUMMARY")
    print("="*70)
    print(f"Total actors in graph:    {G.number_of_nodes()}")
    print(f"Total edges:              {G.number_of_edges()}")
    print(f"Playable actors:          {len(playable_actors)}")
    print(f"Starting pool:            {len(starting_pool_nodes)} (by StartActorScore)")
    print(f"Graph file:               {args.out}")
    print(f"  Size:                   {os.path.getsize(args.out) / (1024*1024):.2f} MB")
    print(f"Index file:               {index_path}")
    print(f"  Size:                   {os.path.getsize(index_path) / (1024*1024):.2f} MB")
    print(f"Audit CSV:                {csv_path}")
    print("="*70)
    print("\nOK: Graph build complete with StartActorScore system!")


if __name__ == "__main__":
    main()
