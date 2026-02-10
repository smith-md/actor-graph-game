"""
Daily Puzzle Manager for Movie Links

Manages deterministic daily puzzle generation with actor reuse exclusion.
Ensures all users get the same puzzle on the same day.
"""

import logging
import os
import pickle
import random
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Tuple, Dict

logger = logging.getLogger("movielinks.daily_puzzle")


class DailyPuzzleManager:
    """
    Manages daily puzzle generation with 20-day actor reuse exclusion.

    Features:
    - Deterministic puzzle per day (same puzzle_id = same actors for all users)
    - 20-day exclusion window for used actors
    - Graceful fallback to 15/10/0 days if pool exhausted
    - State persistence across server restarts via pickle
    """

    def __init__(self, graph, state_file="daily_puzzle_state.pickle"):
        """
        Initialize the daily puzzle manager.

        Args:
            graph: NetworkX graph with actor nodes
            state_file: Path to pickle file for state persistence
        """
        self.graph = graph
        self.state_file = state_file
        self.state = self._load_state()

    def _load_state(self) -> Dict:
        """Load puzzle state from disk or initialize new state."""
        if os.path.exists(self.state_file):
            try:
                with open(self.state_file, "rb") as f:
                    state = pickle.load(f)
                    logger.info("Loaded state with %d puzzles", len(state.get('puzzles', {})))
                    return state
            except Exception as e:
                logger.error("Failed to load state: %s, initializing fresh", e)

        return {"puzzles": {}, "recent_actors": {}}

    def _save_state(self):
        """Persist puzzle state to disk."""
        try:
            with open(self.state_file, "wb") as f:
                pickle.dump(self.state, f)
        except Exception as e:
            logger.error("Failed to save state: %s", e)

    def _cleanup_old_actors(self, cutoff_date: str):
        """
        Remove actors older than cutoff_date from recent_actors.

        Args:
            cutoff_date: Date string in YYYYMMDD format
        """
        original_count = len(self.state["recent_actors"])
        self.state["recent_actors"] = {
            actor_id: used_date
            for actor_id, used_date in self.state["recent_actors"].items()
            if used_date >= cutoff_date
        }
        removed = original_count - len(self.state["recent_actors"])
        if removed > 0:
            logger.info("Cleaned up %d old actor entries", removed)

    def _get_available_actors(self, exclude_days: int) -> list:
        """
        Get actors not used in past N days from starting pool.

        Args:
            exclude_days: Number of days to exclude recently used actors

        Returns:
            List of actor node IDs available for selection
        """
        cutoff_date = (datetime.now() - timedelta(days=exclude_days)).strftime("%Y%m%d")
        recent_actor_ids = set(
            actor_id for actor_id, used_date in self.state["recent_actors"].items()
            if used_date >= cutoff_date
        )

        all_starting_actors = [
            n for n in self.graph.nodes()
            if self.graph.nodes[n].get('in_starting_pool', False)
        ]

        available = [a for a in all_starting_actors if a not in recent_actor_ids]
        logger.info("Available actors (exclude %dd): %d/%d", exclude_days, len(available), len(all_starting_actors))
        return available

    def _is_valid_pair(self, actor_a: str, actor_b: str) -> bool:
        """
        Check if two actors form a valid puzzle.

        Actors are valid if:
        - They are different actors
        - They are not directly connected (no shared movie)

        Args:
            actor_a: First actor node ID
            actor_b: Second actor node ID

        Returns:
            True if pair is valid for puzzle, False otherwise
        """
        if actor_a == actor_b:
            return False
        if self.graph.has_edge(actor_a, actor_b):
            return False
        return True

    def get_daily_puzzle(self, puzzle_id: str) -> Tuple[str, str]:
        """
        Get or generate puzzle for given puzzle_id (YYYYMMDD).

        Uses deterministic seeding (puzzle_id as seed) to ensure
        all users get the same puzzle for a given day.

        Algorithm:
        1. Check if puzzle already generated for this date
        2. If not, try with 20-day exclusion
        3. If pool too small, try 15-day, then 10-day, then 0-day
        4. Find valid pair (different actors, not directly connected)
        5. Save puzzle and update recent_actors

        Args:
            puzzle_id: Date string in YYYYMMDD format

        Returns:
            Tuple of (start_actor_id, target_actor_id)
        """
        # Check if puzzle already exists for this date
        if puzzle_id in self.state["puzzles"]:
            puzzle = self.state["puzzles"][puzzle_id]
            logger.info("Using cached puzzle for %s", puzzle_id)
            return puzzle["start_actor"], puzzle["target_actor"]

        logger.info("Generating new puzzle for %s", puzzle_id)

        # Generate new puzzle with deterministic seed
        puzzle_seed = int(puzzle_id)  # YYYYMMDD as integer seed
        random.seed(puzzle_seed)

        # Try with decreasing exclusion windows
        for exclusion_days in [20, 15, 10, 0]:
            available_actors = self._get_available_actors(exclusion_days)

            if len(available_actors) < 2:
                logger.info("Not enough actors for %d-day exclusion, trying shorter window", exclusion_days)
                continue  # Try shorter exclusion window

            # Try up to 100 random pairs to find valid combination
            attempts = 0
            for _ in range(100):
                attempts += 1
                start_actor, target_actor = random.sample(available_actors, 2)

                if self._is_valid_pair(start_actor, target_actor):
                    # Valid puzzle found - save it
                    logger.info("Found valid pair after %d attempts (exclusion: %dd)", attempts, exclusion_days)

                    self.state["puzzles"][puzzle_id] = {
                        "start_actor": start_actor,
                        "target_actor": target_actor,
                        "generated_at": datetime.now().isoformat(),
                        "exclusion_days": exclusion_days
                    }
                    self.state["recent_actors"][start_actor] = puzzle_id
                    self.state["recent_actors"][target_actor] = puzzle_id

                    # Cleanup old entries (keep only 25 days for safety buffer)
                    cutoff = (datetime.now() - timedelta(days=25)).strftime("%Y%m%d")
                    self._cleanup_old_actors(cutoff)

                    self._save_state()

                    # Reset random seed to restore normal randomness
                    random.seed()

                    return start_actor, target_actor

        # Fallback: if no valid pair found even without exclusion, use any two
        logger.warning("Using fallback (any pair) for %s", puzzle_id)
        all_starting_actors = [
            n for n in self.graph.nodes()
            if self.graph.nodes[n].get('in_starting_pool', False)
        ]
        start_actor, target_actor = random.sample(all_starting_actors, 2)

        self.state["puzzles"][puzzle_id] = {
            "start_actor": start_actor,
            "target_actor": target_actor,
            "generated_at": datetime.now().isoformat(),
            "exclusion_days": 0,
            "fallback": True
        }
        self.state["recent_actors"][start_actor] = puzzle_id
        self.state["recent_actors"][target_actor] = puzzle_id
        self._save_state()

        random.seed()  # Reset seed
        return start_actor, target_actor
