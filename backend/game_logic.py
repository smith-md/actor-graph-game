import networkx as nx
from typing import Callable, List, Optional

Resolver = Callable[[str], List[str]]  # returns list of node IDs (e.g., "actor::id::Name")

def pick_neighboring_movie(graph, current_actor_node: str, candidate_movie_nodes: List[str]) -> Optional[str]:
    """Pick the movie node that is actually a neighbor of the current actor."""
    if not candidate_movie_nodes:
        return None
    neighbors = set(graph.neighbors(current_actor_node))
    for m in candidate_movie_nodes:
        if m in neighbors:
            return m
    return None

def pick_actor_in_movie(graph, movie_node: str, candidate_actor_nodes: List[str]) -> Optional[str]:
    """Pick the actor node that actually appears in the given movie node."""
    if not candidate_actor_nodes:
        return None
    cast = set(graph.neighbors(movie_node))
    for a in candidate_actor_nodes:
        if a in cast:
            return a
    return None

class MovieConnectionGame:
    def __init__(
        self,
        graph,
        start_actor_node: str,
        target_actor_node: str,
        max_incorrect_guesses: int = 3,
        resolve_actor: Optional[Resolver] = None,
        resolve_movie: Optional[Resolver] = None,
    ):
        self.graph = graph
        self.start = start_actor_node
        self.target = target_actor_node
        self.current = start_actor_node
        self.path = [start_actor_node]
        self.completed = False
        self.max_incorrect = max_incorrect_guesses
        self.incorrect_guesses = 0
        self.total_guesses = 0

        self.resolve_actor = resolve_actor or (lambda name: [])
        self.resolve_movie = resolve_movie or (lambda title: [])

    def guess(self, movie_title: str, actor_name: str):
        if self.completed:
            return False, "Game is already complete.", None

        self.total_guesses += 1

        candidate_movies = self.resolve_movie(movie_title)
        candidate_actors = self.resolve_actor(actor_name)

        if not candidate_movies:
            self._inc_incorrect()
            return False, f"❌ I couldn’t find a movie matching “{movie_title}”. Try the autocomplete.", None

        movie_node = pick_neighboring_movie(self.graph, self.current, candidate_movies)
        if not movie_node:
            self._inc_incorrect()
            return False, f"❌ “{movie_title}” does not connect from {self._label(self.current)}. Try a different movie.", None

        next_actor_node = pick_actor_in_movie(self.graph, movie_node, candidate_actors)
        if not next_actor_node:
            self._inc_incorrect()
            return False, f"❌ {actor_name} isn’t in “{self._node_label(movie_node)}” (or not in this dataset).", None

        poster_path = self.graph.nodes[movie_node].get("poster_path")
        poster_url = f"https://image.tmdb.org/t/p/w500{poster_path}" if poster_path else None

        self.current = next_actor_node
        self.path.extend([movie_node, next_actor_node])

        if self.current == self.target:
            self.completed = True
            return True, f"🎉 Connected to {self._label(self.current)} — you win!", poster_url

        return True, f"✅ Valid move to {self._label(self.current)}.", poster_url

    def _inc_incorrect(self):
        self.incorrect_guesses += 1
        if self.incorrect_guesses >= self.max_incorrect:
            self.completed = True

    def _label(self, node: str) -> str:
        return node.split("::")[-1]

    def _node_label(self, node: str) -> str:
        return self.graph.nodes[node].get("label") or node.split("::")[-1]

    def get_state(self):
        return {
            "current_actor": self.current,
            "target_actor": self.target,
            "path": self.path,
            "completed": self.completed,
            "total_guesses": self.total_guesses,
            "incorrect_guesses": self.incorrect_guesses,
            "remaining_attempts": self.max_incorrect - self.incorrect_guesses,
        }
