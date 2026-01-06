"""
BEST OPTION: Hybrid ranking that combines multiple factors to ensure 
consistently famous, recognizable actors are included.
"""

import requests
import time
import networkx as nx
import pickle
import argparse
from collections import defaultdict
import os
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("TMDB_API_KEY")
BASE_URL = "https://api.themoviedb.org/3"

def get_actor_details(actor_id):
    """Get detailed info about an actor including movie credits."""
    url = f"{BASE_URL}/person/{actor_id}/movie_credits"
    params = {"api_key": API_KEY}
    
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        cast = data.get("cast", [])
        
        # Calculate metrics
        movie_count = len(cast)
        total_popularity = sum(m.get("popularity", 0) for m in cast)
        avg_vote = sum(m.get("vote_average", 0) for m in cast if m.get("vote_count", 0) > 100) / max(1, len([m for m in cast if m.get("vote_count", 0) > 100]))
        
        return {
            "movie_count": movie_count,
            "total_movie_popularity": total_popularity,
            "avg_movie_rating": avg_vote
        }
    except Exception as e:
        print(f"Error fetching details for actor {actor_id}: {e}")
        return None

def calculate_actor_score(actor, details):
    """
    Calculate a composite score that balances:
    - Current popularity (so we get recent actors)
    - Total movies (experience/fame)
    - Quality of movies (avg rating)
    
    This ensures we get both classic stars AND current popular actors.
    """
    if not details:
        return 0
    
    # Normalize scores (rough approximations)
    popularity_score = actor.get("popularity", 0) / 100  # 0-100 range typically
    movie_count_score = min(details["movie_count"] / 50, 10)  # Cap at 50 movies = max score
    quality_score = details["avg_movie_rating"]  # 0-10 range
    
    # Weighted combination
    # 40% current popularity, 40% movie count (experience), 20% quality
    composite_score = (
        0.4 * popularity_score +
        0.4 * movie_count_score +
        0.2 * quality_score
    )
    
    return composite_score

def fetch_actors_with_hybrid_ranking(num_actors=500):
    """
    Fetch actors using a hybrid ranking system that ensures
    consistently famous actors are included.
    """
    print(f"Fetching initial pool of {num_actors * 2} actors...")
    
    actors = []
    page = 1
    
    # Fetch 2x the number we need
    while len(actors) < num_actors * 2:
        url = f"{BASE_URL}/person/popular"
        params = {"api_key": API_KEY, "page": page}
        
        try:
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            for person in data.get("results", []):
                if person.get("known_for_department") == "Acting":
                    actors.append({
                        "id": person["id"],
                        "name": person["name"],
                        "profile_path": person.get("profile_path"),
                        "popularity": person.get("popularity", 0)
                    })
            
            page += 1
            time.sleep(0.25)
            
            if page > 50:  # Safety limit
                break
                
        except Exception as e:
            print(f"Error fetching page {page}: {e}")
            break
    
    print(f"Fetched {len(actors)} actors. Now calculating hybrid scores...")
    
    # Calculate composite scores
    scored_actors = []
    for i, actor in enumerate(actors):
        if i % 50 == 0:
            print(f"Scoring actor {i}/{len(actors)}...")
        
        details = get_actor_details(actor["id"])
        if details:
            score = calculate_actor_score(actor, details)
            scored_actors.append({
                **actor,
                **details,
                "composite_score": score
            })
        
        time.sleep(0.1)
    
    # Sort by composite score
    scored_actors.sort(key=lambda x: x["composite_score"], reverse=True)
    
    # Take top N
    top_actors = scored_actors[:num_actors]
    
    print(f"\nTop 15 actors by hybrid score:")
    for i, actor in enumerate(top_actors[:15]):
        print(f"{i+1}. {actor['name']}")
        print(f"   Score: {actor['composite_score']:.2f} | Movies: {actor['movie_count']} | Popularity: {actor['popularity']:.1f}")
    
    return top_actors

def get_actor_movies(actor_id):
    """Get all movies for an actor."""
    url = f"{BASE_URL}/person/{actor_id}/movie_credits"
    params = {"api_key": API_KEY}
    
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        movies = []
        for movie in data.get("cast", []):
            if movie.get("release_date") and movie.get("vote_count", 0) > 10:
                movies.append({
                    "id": movie["id"],
                    "title": movie["title"],
                    "release_date": movie.get("release_date"),
                    "poster_path": movie.get("poster_path")
                })
        
        return movies
    except Exception as e:
        print(f"Error fetching movies for actor {actor_id}: {e}")
        return []

def build_graph(num_actors=500):
    """Build the actor-movie graph using hybrid ranking."""
    print(f"\n=== Building graph with top {num_actors} actors (HYBRID RANKING) ===")
    print("This combines popularity, experience, and quality for best results!\n")
    
    actors = fetch_actors_with_hybrid_ranking(num_actors)
    
    if not actors:
        print("Failed to fetch actors!")
        return None
    
    print(f"\nBuilding graph with {len(actors)} actors...")
    
    G = nx.Graph()
    
    # Add actor nodes
    for actor in actors:
        G.add_node(
            f"actor_{actor['id']}",
            type="actor",
            name=actor["name"],
            image=f"https://image.tmdb.org/t/p/w185{actor['profile_path']}" if actor['profile_path'] else None,
            movie_count=actor.get("movie_count", 0),
            composite_score=actor.get("composite_score", 0)
        )
    
    # Fetch movies and build connections
    for i, actor in enumerate(actors):
        print(f"Processing actor {i+1}/{len(actors)}: {actor['name']}")
        
        movies = get_actor_movies(actor["id"])
        
        for movie in movies:
            movie_id = f"movie_{movie['id']}"
            actor_id = f"actor_{actor['id']}"
            
            if movie_id not in G:
                G.add_node(
                    movie_id,
                    type="movie",
                    title=movie["title"],
                    release_date=movie.get("release_date"),
                    poster_path=movie.get("poster_path")
                )
            
            G.add_edge(actor_id, movie_id)
        
        time.sleep(0.25)
    
    print(f"\nGraph built successfully!")
    print(f"Total nodes: {G.number_of_nodes()}")
    print(f"Total edges: {G.number_of_edges()}")
    print(f"Actors: {sum(1 for n in G.nodes() if G.nodes[n]['type'] == 'actor')}")
    print(f"Movies: {sum(1 for n in G.nodes() if G.nodes[n]['type'] == 'movie')}")
    
    return G

def main():
    parser = argparse.ArgumentParser(
        description="Build actor-movie graph using HYBRID RANKING (RECOMMENDED)"
    )
    parser.add_argument(
        "--top",
        type=int,
        default=500,
        help="Number of top actors to include (default: 500)"
    )
    parser.add_argument(
        "--out",
        type=str,
        default="actor_movie_graph.gpickle",
        help="Output file path"
    )
    
    args = parser.parse_args()
    
    if not API_KEY:
        print("ERROR: TMDB_API_KEY not found in environment!")
        return
    
    print(f"API Key found: {API_KEY[:10]}...")

    
    G = build_graph(args.top)
    
    if G:
        print(f"\nSaving graph to {args.out}...")
        with open(args.out, "wb") as f:
            pickle.dump(G, f)
        print("Done!")
        print(f"\nGraph saved to: {args.out}")
        print(f"File size: {os.path.getsize(args.out) / (1024*1024):.2f} MB")
    else:
        print("Failed to build graph!")

if __name__ == "__main__":
    main()