import unicodedata
import networkx as nx
from typing import Callable, List, Optional, Tuple, Dict, Any

Resolver = Callable[[str], List[str]]  # returns list of node IDs or titles


def norm(s: str) -> str:
    """Normalize string for case-insensitive comparison."""
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii").lower().strip()


def get_movies_between_actors(graph, actor1: str, actor2: str) -> List[Dict[str, Any]]:
    """
    Get list of movies connecting two actors from edge metadata.

    Args:
        graph: NetworkX graph (actor-actor)
        actor1: First actor node ID
        actor2: Second actor node ID

    Returns:
        List of movie dicts with keys: id, title, poster_path, popularity, cast_size, release_date
    """
    if not graph.has_edge(actor1, actor2):
        return []
    return graph.edges[actor1, actor2].get('movies', [])


def _validate_with_comprehensive_index(
    graph,
    current_actor: str,
    candidate_actor: str,
    movie_id: int,
    actor_movie_index: Dict
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Validate movie-actor guess using comprehensive actor-movie index.

    Checks if both actors appear in the movie by looking up their filmographies.

    Args:
        graph: NetworkX graph (for node attributes)
        current_actor: Current actor node ID (format: "actor_{tmdb_id}")
        candidate_actor: Candidate actor node ID
        movie_id: TMDb movie ID
        actor_movie_index: Dict with "movies" and "actor_movies" keys

    Returns:
        Tuple of (movie_dict, actor_node) if valid, else (None, None)
    """
    # Extract TMDb IDs from node IDs (format: "actor_{tmdb_id}")
    try:
        current_actor_tmdb_id = int(current_actor.split("_")[1])
        candidate_actor_tmdb_id = int(candidate_actor.split("_")[1])
    except (IndexError, ValueError):
        # Invalid node ID format, fall back
        return None, None

    # Check if movie exists in comprehensive index
    if movie_id not in actor_movie_index.get("movies", {}):
        return None, None

    # Get actor filmographies from index
    current_actor_movies = actor_movie_index.get("actor_movies", {}).get(current_actor_tmdb_id, [])
    candidate_actor_movies = actor_movie_index.get("actor_movies", {}).get(candidate_actor_tmdb_id, [])

    # Check if both actors appear in the movie
    current_has_movie = any(m["movie_id"] == movie_id for m in current_actor_movies)
    candidate_has_movie = any(m["movie_id"] == movie_id for m in candidate_actor_movies)

    if current_has_movie and candidate_has_movie:
        # Both actors in movie - construct movie_dict from index
        movie_data = actor_movie_index["movies"][movie_id]
        movie_dict = {
            "id": movie_id,
            "title": movie_data["title"],
            "poster_path": movie_data.get("poster_path"),
            "popularity": movie_data.get("popularity", 0),
            "cast_size": movie_data.get("cast_size", 0),
            "release_date": movie_data.get("release_date", "")
        }
        return movie_dict, candidate_actor

    return None, None


def pick_movie_and_actor(
    graph,
    current_actor: str,
    movie_id: int,
    candidate_actors: List[str],
    actor_movie_index: Optional[Dict] = None  # NEW: Comprehensive index
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Validate that movie+actor guess is valid in actor-actor graph.

    Checks if:
    1. Current actor and candidate actor are connected (neighbors)
    2. The specified movie ID exists in their shared filmography

    Uses comprehensive actor_movie_index if available, falls back to edge metadata.

    Args:
        graph: NetworkX graph (actor-actor)
        current_actor: Current actor node ID
        movie_id: TMDb movie ID to validate
        candidate_actors: List of candidate actor node IDs
        actor_movie_index: Optional comprehensive actor-movie index

    Returns:
        Tuple of (movie_dict, actor_node) if valid, else (None, None)
    """
    for candidate_actor in candidate_actors:
        # Check if actors are connected
        if not graph.has_edge(current_actor, candidate_actor):
            continue

        # NEW: Try comprehensive index first (if available)
        if actor_movie_index is not None:
            movie_dict, next_actor = _validate_with_comprehensive_index(
                graph, current_actor, candidate_actor, movie_id, actor_movie_index
            )
            if movie_dict is not None:
                return movie_dict, next_actor

        # EXISTING: Fallback to edge metadata
        movies = get_movies_between_actors(graph, current_actor, candidate_actor)
        for movie in movies:
            if movie['id'] == movie_id:
                return movie, candidate_actor

    return None, None

class MovieConnectionGame:
    """
    Game logic for actor connection game using actor-actor graph.

    Players guess movie + actor to traverse the graph.
    The game validates that:
    1. The movie actually connects the current actor to the guessed actor
    2. Both actors exist in the graph

    Path tracks actors only, with movies_used tracking which movies were used.
    """

    def __init__(
        self,
        graph,
        start_actor_node: str,
        target_actor_node: str,
        max_incorrect_guesses: int = 3,
        resolve_actor: Optional[Resolver] = None,
        resolve_movie: Optional[Resolver] = None,
        actor_movie_index: Optional[Dict] = None,  # NEW: Comprehensive index
    ):
        self.graph = graph
        self.start = start_actor_node
        self.target = target_actor_node
        self.current = start_actor_node

        # NEW: path now stores only actor nodes
        self.path = [start_actor_node]

        # NEW: track movies used between actors
        self.movies_used = []  # List of movie dicts

        self.completed = False
        self.max_incorrect = max_incorrect_guesses
        self.incorrect_guesses = 0
        self.total_guesses = 0

        self.resolve_actor = resolve_actor or (lambda name: [])
        self.resolve_movie = resolve_movie or (lambda title: [])

        # NEW: Store comprehensive index for validation
        self.actor_movie_index = actor_movie_index

    def guess(self, movie_id: int, actor_name: str):  # CHANGED: Accept movie_id
        """
        Process a movie+actor guess in actor-actor graph.

        Args:
            movie_id: TMDb movie ID connecting actors
            actor_name: Name of actor to move to

        Returns:
            Tuple of (success: bool, message: str, poster_url: Optional[str])
        """
        if self.completed:
            return False, "Game is already complete.", None

        self.total_guesses += 1

        # Resolve actor name to candidate node IDs
        candidate_actors = self.resolve_actor(actor_name)
        if not candidate_actors:
            self._inc_incorrect()
            return False, f"❌ I couldn't find an actor matching \"{actor_name}\". Try the autocomplete.", None

        # Validate movie_id+actor against edge metadata
        movie_dict, next_actor_node = pick_movie_and_actor(
            self.graph, self.current, movie_id, candidate_actors, self.actor_movie_index
        )

        if not movie_dict:
            self._inc_incorrect()

            # Get movie title for error message
            movie_title = self._get_movie_title(movie_id)  # NEW: Helper to get title from ID

            # Check if it's a movie problem or connection problem
            actor_exists = any(
                self.graph.has_edge(self.current, candidate)
                for candidate in candidate_actors
            )

            if actor_exists:
                # Actors are connected, but wrong movie
                return False, f"❌ \"{movie_title}\" doesn't connect {self._label(self.current)} and {actor_name}. They might have worked together in a different movie.", None
            else:
                # Actors aren't connected at all
                return False, f"❌ {self._label(self.current)} and {actor_name} aren't directly connected in this graph. Try a different actor.", None

        # Valid move!
        poster_url = f"https://image.tmdb.org/t/p/w500{movie_dict['poster_path']}" if movie_dict.get('poster_path') else None

        self.current = next_actor_node
        self.path.append(next_actor_node)
        self.movies_used.append(movie_dict)

        # Check win condition
        if self.current == self.target:
            self.completed = True
            return True, f"🎉 Connected to {self._label(self.current)} — you win!", poster_url

        return True, f"✅ Valid move to {self._label(self.current)}.", poster_url

    def _get_movie_title(self, movie_id: int) -> str:
        """
        Get movie title from ID for error messages.

        Searches movies_used first, then all edges in the graph.

        Args:
            movie_id: TMDb movie ID

        Returns:
            Movie title or placeholder string
        """
        # Check movies already used in this game
        for movie in self.movies_used:
            if movie['id'] == movie_id:
                return movie['title']

        # Search all edges for the movie
        for u, v, data in self.graph.edges(data=True):
            for movie in data.get('movies', []):
                if movie['id'] == movie_id:
                    return movie['title']

        # Fallback if not found
        return f"Movie #{movie_id}"

    def _inc_incorrect(self):
        """Increment incorrect guess counter and check if game over."""
        self.incorrect_guesses += 1
        if self.incorrect_guesses >= self.max_incorrect:
            self.completed = True

    def _label(self, node: str) -> str:
        """Get display label from node (name from node attributes or node ID)."""
        if node in self.graph.nodes:
            return self.graph.nodes[node].get("name", node.split("_")[-1])
        return node.split("_")[-1]

    def get_state(self):
        """
        Get current game state.

        Returns:
            Dict with current_actor, target_actor, path (actors only),
            movies_used, completion status, and guess counts
        """
        return {
            "current_actor": self.current,
            "target_actor": self.target,
            "path": self.path,  # Now only actors
            "movies_used": self.movies_used,  # List of movie dicts
            "completed": self.completed,
            "total_guesses": self.total_guesses,
            "incorrect_guesses": self.incorrect_guesses,
            "remaining_attempts": self.max_incorrect - self.incorrect_guesses,
        }
