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
import json
from collections import defaultdict
from dotenv import load_dotenv
import requests
import networkx as nx
from tqdm import tqdm

load_dotenv()

API_KEY = os.getenv("TMDB_API_KEY")
BASE_URL = "https://api.themoviedb.org/3"
CACHE_DIR = "tmdb_cache"

# Starting Pool Filter Thresholds (applied to top 100 selection only)
MIN_ENGLISH_LANGUAGE_PERCENT = 80.0  # % of movies that must be English-language
MAX_VOICE_ACTING_PERCENT = 20.0      # Max % of roles that can be voice acting
STARTING_MIN_VOTE_COUNT = 7000       # Middle ground: moderate expansion without flooding
STARTING_MIN_ELIGIBLE_CREDITS = 3    # Lowered from 5 for broader coverage


def get_cache_path(cache_type, min_votes=None, max_pages=None):
    """Generate cache file path based on parameters."""
    if cache_type == "movies":
        return os.path.join(CACHE_DIR, f"movies_minvotes{min_votes}_pages{max_pages}.json")
    return os.path.join(CACHE_DIR, f"{cache_type}.json")


def load_from_cache(cache_path):
    """Load data from cache file if it exists."""
    if os.path.exists(cache_path):
        print(f"[CACHE] Loading from cache: {cache_path}")
        with open(cache_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        print(f"[CACHE] Loaded {len(data)} items from cache")
        return data
    return None


def save_to_cache(cache_path, data):
    """Save data to cache file."""
    os.makedirs(CACHE_DIR, exist_ok=True)
    print(f"[CACHE] Saving {len(data)} items to cache: {cache_path}")
    with open(cache_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"[CACHE] Cache saved successfully")


def fetch_popular_movies(min_votes=100, max_pages=100, use_cache=True, refresh_cache=False):
    """
    Fetch popular movies from TMDb (global).

    Args:
        min_votes: Minimum vote count threshold
        max_pages: Maximum pages to fetch
        use_cache: Whether to use cached data if available
        refresh_cache: Force re-fetch even if cache exists

    Returns:
        List of movie dicts with id, title, popularity, etc.
    """
    print(f"\n=== Fetching Popular Movies (min {min_votes} votes, up to {max_pages} pages) ===")

    # Check cache first (unless refresh requested)
    cache_path = get_cache_path("movies", min_votes, max_pages)
    if use_cache and not refresh_cache:
        cached_movies = load_from_cache(cache_path)
        if cached_movies is not None:
            return cached_movies

    # Fetch from API
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

    # Save to cache for future use
    if use_cache and movies:
        save_to_cache(cache_path, movies)

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
                    "cast_order": person.get("order", 999),  # NEW: Billing position
                    "character": person.get("character", "")  # NEW: For voice acting detection
                })

            if cast_list:
                movie_cast_data[movie_id] = {
                    "title": movie["title"],
                    "popularity": movie["popularity"],
                    "release_date": movie["release_date"],
                    "vote_count": details_data.get("vote_count", 0),  # NEW: For StartActorScore
                    "poster_path": details_data.get("poster_path"),  # Added for completeness
                    "cast": cast_list,
                    "cast_size": len(cast_list),
                    "original_language": details_data.get("original_language", "")  # NEW: For language filtering
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
                "title": movie_data["title"],
                "original_language": movie_data.get("original_language", ""),  # NEW: For language filtering
                "character": cast_member.get("character", "")  # NEW: For voice acting detection
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


def is_voice_acting_role(character: str) -> bool:
    """
    Detect if a character credit indicates voice acting.

    Args:
        character: Character name/description from TMDb credits

    Returns:
        True if role is voice acting
    """
    if not character:
        return False

    character_lower = character.lower()

    # Common voice acting indicators in TMDb credits
    voice_indicators = [
        "(voice)",
        " (voice)",
        "voice)",
        "- voice",
        "/ voice",
        "(uncredited voice",
        "(archive footage / voice",  # Sometimes combined
    ]

    return any(indicator in character_lower for indicator in voice_indicators)


def is_stunt_worker(character: str) -> bool:
    """
    Detect if a character credit indicates stunt work.

    Args:
        character: Character name/description from TMDb credits

    Returns:
        True if role is stunt work
    """
    if not character:
        return False

    character_lower = character.lower()

    # Common stunt work indicators in TMDb credits
    stunt_indicators = [
        "stunt",
        "stunts",
        "stunt double",
        "stunt coordinator",
        "utility stunts",
        "stunt performer"
    ]

    return any(indicator in character_lower for indicator in stunt_indicators)


def calculate_actor_language_voice_stats(actor_movies_list, min_vote_count=10000, max_cast_order=5):
    """
    Calculate language distribution and voice acting percentage for an actor.

    Only considers movies meeting the same eligibility criteria as StartActorScore
    (vote_count >= 10k, cast_order <= 5) to ensure we're looking at prominent roles.

    Args:
        actor_movies_list: List of movie dicts for actor from actor_movie_index
        min_vote_count: Minimum votes to consider (should match StartActorScore)
        max_cast_order: Max billing position to consider (should match StartActorScore)

    Returns:
        Dict with:
        - total_eligible_movies: int (movies meeting criteria)
        - english_movies: int (count of English-language movies)
        - english_percent: float (% of eligible movies that are English)
        - voice_roles: int (count of voice acting roles)
        - voice_percent: float (% of eligible roles that are voice)
        - non_english_movies: List[str] (titles for debugging)
        - voice_movies: List[str] (titles for debugging)
    """
    eligible_movies = []

    # Filter to same criteria as StartActorScore eligibility
    for credit in actor_movies_list:
        if credit.get("vote_count", 0) >= min_vote_count and credit.get("cast_order", 999) <= max_cast_order:
            eligible_movies.append(credit)

    if not eligible_movies:
        return {
            "total_eligible_movies": 0,
            "english_movies": 0,
            "english_percent": 0.0,
            "voice_roles": 0,
            "voice_percent": 0.0,
            "non_english_movies": [],
            "voice_movies": []
        }

    # Calculate language distribution
    english_count = 0
    non_english_titles = []

    for movie in eligible_movies:
        lang = movie.get("original_language", "").lower()
        # Accept all English variants (en, en-us, en-gb, etc.)
        if lang == "en" or lang.startswith("en-"):
            english_count += 1
        else:
            non_english_titles.append(f"{movie['title']} ({lang})")

    # Calculate voice acting percentage
    voice_count = 0
    voice_titles = []

    for movie in eligible_movies:
        character = movie.get("character", "")
        if is_voice_acting_role(character):
            voice_count += 1
            voice_titles.append(f"{movie['title']} (char: {character[:30]}...)")

    total = len(eligible_movies)

    return {
        "total_eligible_movies": total,
        "english_movies": english_count,
        "english_percent": (english_count / total * 100) if total > 0 else 0.0,
        "voice_roles": voice_count,
        "voice_percent": (voice_count / total * 100) if total > 0 else 0.0,
        "non_english_movies": non_english_titles[:5],  # Limit for readability
        "voice_movies": voice_titles[:5]
    }


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


def filter_starting_pool_candidates(
    actor_scores_ranked,
    actor_movie_index,
    min_english_percent=MIN_ENGLISH_LANGUAGE_PERCENT,
    max_voice_percent=MAX_VOICE_ACTING_PERCENT,
    starting_min_vote_count=STARTING_MIN_VOTE_COUNT,
    starting_min_eligible_credits=STARTING_MIN_ELIGIBLE_CREDITS
):
    """
    Filter actor scores to exclude actors not suitable for starting pool.

    Applies additional filters beyond basic StartActorScore eligibility:
    1. Language filter: Must have >= min_english_percent English movies
    2. Voice acting filter: Must have < max_voice_percent voice roles
    3. Prominence filter: Higher vote count and credit thresholds than base eligibility

    Args:
        actor_scores_ranked: List of (actor_id, score, metrics) from rank_actors_by_start_score()
        actor_movie_index: Actor-movie index for filmography lookup
        min_english_percent: Minimum % of English-language movies (default: 80%)
        max_voice_percent: Maximum % of voice acting roles (default: 20%)
        starting_min_vote_count: Higher vote threshold for starting pool (default: 25k)
        starting_min_eligible_credits: More credits required for starting pool (default: 5)

    Returns:
        Tuple of:
        - filtered_scores: List of (actor_id, score, enhanced_metrics) for qualifying actors
        - filter_report: Dict with filtering statistics
    """
    print(f"\n=== Filtering Starting Pool Candidates ===")
    print(f"  Criteria:")
    print(f"    - English language: >= {min_english_percent}%")
    print(f"    - Voice acting: < {max_voice_percent}%")
    print(f"    - Min vote count: {starting_min_vote_count}")
    print(f"    - Min credits: {starting_min_eligible_credits}")

    filtered_scores = []
    filter_stats = {
        "total_candidates": len(actor_scores_ranked),
        "language_filtered": 0,
        "voice_filtered": 0,
        "vote_count_filtered": 0,
        "credit_count_filtered": 0,
        "passed_all_filters": 0,
        "language_failures": [],  # (actor_id, english_pct, examples)
        "voice_failures": [],     # (actor_id, voice_pct, examples)
    }

    for actor_id, score, metrics in actor_scores_ranked:
        # Get actor filmography
        actor_movies = actor_movie_index["actor_movies"].get(actor_id, [])

        # Calculate language and voice stats
        lang_voice_stats = calculate_actor_language_voice_stats(actor_movies)

        # Apply filters
        filter_reason = None

        # Filter 1: Prominence (stricter vote count)
        # Re-count eligible credits with higher vote threshold
        # NOTE: Removed cast_order filter to include ensemble cast members
        high_vote_credits = [
            m for m in actor_movies
            if m.get("vote_count", 0) >= starting_min_vote_count
        ]

        if len(high_vote_credits) < starting_min_eligible_credits:
            filter_stats["vote_count_filtered"] += 1
            filter_stats["credit_count_filtered"] += 1
            filter_reason = f"Insufficient high-prominence credits ({len(high_vote_credits)} < {starting_min_eligible_credits} at {starting_min_vote_count}+ votes)"
            continue

        # Filter 2: Language distribution
        english_pct = lang_voice_stats["english_percent"]
        if english_pct < min_english_percent:
            filter_stats["language_filtered"] += 1
            filter_stats["language_failures"].append({
                "actor_id": actor_id,
                "english_percent": english_pct,
                "non_english_examples": lang_voice_stats["non_english_movies"][:3]
            })
            filter_reason = f"Low English language % ({english_pct:.1f}% < {min_english_percent}%)"
            continue

        # Filter 3: Voice acting percentage
        voice_pct = lang_voice_stats["voice_percent"]
        if voice_pct >= max_voice_percent:
            filter_stats["voice_filtered"] += 1
            filter_stats["voice_failures"].append({
                "actor_id": actor_id,
                "voice_percent": voice_pct,
                "voice_examples": lang_voice_stats["voice_movies"][:3]
            })
            filter_reason = f"High voice acting % ({voice_pct:.1f}% >= {max_voice_percent}%)"
            continue

        # Filter 4: Stunt work detection
        stunt_roles = sum(1 for m in actor_movies if is_stunt_worker(m.get("character", "")))
        stunt_pct = (stunt_roles / len(actor_movies) * 100) if actor_movies else 0

        if stunt_pct >= 50:  # If majority of roles are stunts
            if "stunt_filtered" not in filter_stats:
                filter_stats["stunt_filtered"] = 0
            filter_stats["stunt_filtered"] += 1
            filter_reason = f"High stunt work % ({stunt_pct:.1f}% >= 50%)"
            continue

        # Passed all filters
        filter_stats["passed_all_filters"] += 1

        # Enhance metrics with language/voice stats
        enhanced_metrics = metrics.copy()
        enhanced_metrics.update({
            "english_percent": english_pct,
            "voice_percent": voice_pct,
            "total_eligible_movies": lang_voice_stats["total_eligible_movies"],
            "passed_filters": True
        })

        filtered_scores.append((actor_id, score, enhanced_metrics))

    # Print summary
    print(f"\n  Filter Results:")
    print(f"    Total candidates: {filter_stats['total_candidates']}")
    print(f"    Passed all filters: {filter_stats['passed_all_filters']}")
    print(f"    Filtered by language: {filter_stats['language_filtered']}")
    print(f"    Filtered by voice acting: {filter_stats['voice_filtered']}")
    print(f"    Filtered by prominence: {filter_stats['vote_count_filtered']}")
    print()

    return filtered_scores, filter_stats


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
            "english_percent", "voice_percent",
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

            # Extract language/voice stats (available if passed through filter)
            english_pct = metrics.get("english_percent", 0.0)
            voice_pct = metrics.get("voice_percent", 0.0)

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
                f"{english_pct:.1f}",
                f"{voice_pct:.1f}",
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

        # Limit to top 100 most popular shared movies (increased for better coverage)
        TOP_K_MOVIES_PER_EDGE = 100
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


def enrich_playable_actor_connections(G, playable_actors, movie_cast_data):
    """
    For each movie, fetch FULL cast (not just top 10) and add connections
    for any actors in the playable set, even if they were outside initial extraction.

    This ensures that if Tom Hanks is in the playable graph and appeared in a movie
    as the 15th billed actor, he'll still be connected to that movie and other actors.

    Args:
        G: NetworkX graph with playable actors
        playable_actors: Set/list of actor node IDs in the playable graph
        movie_cast_data: Dict of movie data from initial extraction

    Returns:
        Updated graph with enriched connections
    """
    print(f"\n=== Enriching Graph with Full Cast for {len(playable_actors)} Playable Actors ===")

    # Get playable actor TMDb IDs (strip "actor_" prefix)
    playable_tmdb_ids = {int(node.replace('actor_', '')) for node in playable_actors}

    added_connections = 0
    movies_processed = 0

    for movie_id, movie_data in tqdm(movie_cast_data.items(), desc="Enriching with full cast"):
        # Fetch FULL cast from TMDb (not just top 10)
        try:
            credits_url = f"{BASE_URL}/movie/{movie_id}/credits"
            params = {"api_key": API_KEY}
            response = requests.get(credits_url, params=params, timeout=10)
            response.raise_for_status()
            credits_data = response.json()

            # Find all cast members who are in playable_actors
            playable_cast_in_movie = []
            for person in credits_data.get("cast", []):  # FULL cast, no slicing
                actor_id = person["id"]
                if actor_id in playable_tmdb_ids:
                    playable_cast_in_movie.append({
                        "id": actor_id,
                        "name": person["name"],
                        "cast_order": person.get("order", 999)
                    })

            # If we found playable actors beyond the initial top 10
            if len(playable_cast_in_movie) > len(movie_data.get("cast", [])):
                # Add/update edges between all pairs of playable actors in this movie
                for i in range(len(playable_cast_in_movie)):
                    for j in range(i + 1, len(playable_cast_in_movie)):
                        actor1_node = f"actor_{playable_cast_in_movie[i]['id']}"
                        actor2_node = f"actor_{playable_cast_in_movie[j]['id']}"

                        # Check if edge already exists
                        if G.has_edge(actor1_node, actor2_node):
                            # Check if this movie is already in the edge metadata
                            edge_movies = G[actor1_node][actor2_node].get('movies', [])
                            if not any(m['id'] == movie_id for m in edge_movies):
                                # Add this movie to existing edge
                                edge_movies.append({
                                    "id": movie_id,
                                    "title": movie_data["title"],
                                    "popularity": movie_data["popularity"],
                                    "poster_path": movie_data.get("poster_path"),
                                    "cast_size": len(playable_cast_in_movie),
                                    "release_date": movie_data["release_date"]
                                })
                                # Re-sort and limit to top 100
                                edge_movies.sort(key=lambda m: m["popularity"], reverse=True)
                                G[actor1_node][actor2_node]['movies'] = edge_movies[:100]
                                added_connections += 1
                        else:
                            # Edge doesn't exist - this is a new connection discovered via enrichment
                            # (rare but possible if both actors were outside top 10)
                            G.add_edge(
                                actor1_node,
                                actor2_node,
                                weight=calculate_edge_weight(movie_data["popularity"], len(playable_cast_in_movie)),
                                movies=[{
                                    "id": movie_id,
                                    "title": movie_data["title"],
                                    "popularity": movie_data["popularity"],
                                    "poster_path": movie_data.get("poster_path"),
                                    "cast_size": len(playable_cast_in_movie),
                                    "release_date": movie_data["release_date"]
                                }]
                            )
                            added_connections += 1

            movies_processed += 1
            time.sleep(0.15)  # Rate limiting

        except Exception as e:
            print(f"Error enriching movie {movie_id}: {e}")
            continue

    print(f"OK: Enriched graph - processed {movies_processed} movies, added {added_connections} connections\n")
    return G


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
        default=2500,
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
        default=20,
        help="Minimum vote count for movies"
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=500,
        help="Maximum pages of movies to fetch (TMDb limit: 500 pages = 10,000 movies)"
    )
    parser.add_argument(
        "--refresh-cache",
        action="store_true",
        help="Force refresh TMDb cache (re-fetch from API)"
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

    # Step 1: Fetch popular movies (global) - with caching
    movies = fetch_popular_movies(
        min_votes=args.min_votes,
        max_pages=args.max_pages,
        use_cache=True,
        refresh_cache=args.refresh_cache
    )

    if not movies:
        print("ERROR: No movies fetched!")
        return

    # Step 2: Extract cast (top 30 to capture supporting roles and cameos)
    movie_cast_data = extract_cast_from_movies(movies, top_n_cast=30)

    if not movie_cast_data:
        print("ERROR: No cast data extracted!")
        return

    # Step 3: Build full actor graph
    G = build_full_actor_graph(movie_cast_data)

    # Step 4: Compute centrality measures
    G = compute_centrality_measures(G)

    # Step 5: Select playable actors (top 500)
    G, playable_actors = select_playable_actors(G, top_n=args.top)

    # Step 5.5: Enrich with full cast for playable actors (NEW - ensures all valid pairings)
    G = enrich_playable_actor_connections(G, playable_actors, movie_cast_data)

    # Step 6: Build actor-movie index (NEW - for StartActorScore)
    actor_movie_index = build_actor_movie_index(
        movie_cast_data,
        min_votes=args.min_votes,
        max_pages=args.max_pages
    )

    # Step 7: Compute StartActorScore (NEW - replaces centrality-based selection)
    actor_scores_ranked = rank_actors_by_start_score(actor_movie_index)

    # Step 7.5: Filter starting pool candidates (NEW - language, voice, prominence filters)
    filtered_scores, filter_report = filter_starting_pool_candidates(
        actor_scores_ranked,
        actor_movie_index,
        min_english_percent=MIN_ENGLISH_LANGUAGE_PERCENT,
        max_voice_percent=MAX_VOICE_ACTING_PERCENT,
        starting_min_vote_count=STARTING_MIN_VOTE_COUNT,
        starting_min_eligible_credits=STARTING_MIN_ELIGIBLE_CREDITS
    )

    # Step 8: Apply filtered StartActorScore to graph (NEW - mark top N actors who passed filters)
    G, starting_pool_nodes = apply_start_actor_scores_to_graph(
        G, filtered_scores, actor_movie_index, top_n=args.starting
    )

    # Step 9: Generate audit CSV (NEW - PRD requirement)
    csv_path = args.out.replace('.gpickle', '_start_actor_audit.csv')
    generate_audit_csv(filtered_scores, actor_movie_index, csv_path)

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
