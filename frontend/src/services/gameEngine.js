/**
 * Client-side game engine for CineLinks
 * Manages all game state: path, validation, win/loss tracking
 */

const TMDB_ACTOR_SIZE = '/w185';
const TMDB_POSTER_SIZE = '/w154';

export class GameEngine {
  /**
   * @param {number} startActorId
   * @param {number} targetActorId
   * @param {Object} actorsMetadata - { [id]: { id, name, image, pool } }
   * @param {Object} moviesMetadata - { [id]: { id, title, poster, pop } }
   * @param {string} tmdbImageBase - e.g. "https://image.tmdb.org/t/p"
   */
  constructor(startActorId, targetActorId, actorsMetadata, moviesMetadata, tmdbImageBase) {
    this.startActorId = startActorId;
    this.targetActorId = targetActorId;
    this.actorsMetadata = actorsMetadata;
    this.moviesMetadata = moviesMetadata;
    this.tmdbImageBase = tmdbImageBase;

    this.currentActorId = startActorId;
    this.segments = []; // [{ movie: {id, title, posterUrl}, actor: {id, name, imageUrl} }]
    this.pendingMovie = null; // { id, title, posterUrl } — movie guessed, waiting for actor
    this.pendingNeighbors = null; // neighbors data stored after movie guess for actor validation

    this.usedMovieIds = new Set();
    this.usedActorIds = new Set([startActorId]);

    this.totalGuesses = 0;
    this.completed = false;
    this.gaveUp = false;
  }

  /**
   * Resolve an actor ID to a display object
   */
  resolveActor(actorId) {
    const meta = this.actorsMetadata[actorId];
    if (!meta) {
      return { id: actorId, name: `Actor #${actorId}`, imageUrl: null };
    }
    return {
      id: meta.id,
      name: meta.name,
      imageUrl: meta.image ? `${this.tmdbImageBase}${TMDB_ACTOR_SIZE}${meta.image}` : null
    };
  }

  /**
   * Resolve a movie ID to a display object
   */
  resolveMovie(movieId) {
    const meta = this.moviesMetadata[movieId];
    if (!meta) {
      return { id: movieId, title: `Movie #${movieId}`, posterUrl: null };
    }
    return {
      id: meta.id,
      title: meta.title,
      posterUrl: meta.poster ? `${this.tmdbImageBase}${TMDB_POSTER_SIZE}${meta.poster}` : null
    };
  }

  /**
   * Get current path state for rendering
   */
  getPath() {
    return {
      startActor: this.resolveActor(this.startActorId),
      targetActor: this.resolveActor(this.targetActorId),
      segments: this.segments,
      pendingMovie: this.pendingMovie
    };
  }

  /**
   * Get game state summary
   */
  getState() {
    return {
      completed: this.completed,
      totalGuesses: this.totalGuesses,
      moves_taken: this.segments.length,
      gaveUp: this.gaveUp
    };
  }

  getCurrentActorId() {
    return this.currentActorId;
  }

  /**
   * Guess a movie. Requires neighbors data for the current actor.
   * @param {number} movieId
   * @param {Object} neighborsData - response from /api/actors/{id}/neighbors
   * @returns {{ success: boolean, message?: string }}
   */
  guessMovie(movieId, neighborsData) {
    this.totalGuesses++;

    if (this.completed || this.gaveUp) {
      return { success: false, message: 'Game is already over.' };
    }

    if (this.pendingMovie) {
      return { success: false, message: 'You must guess an actor first.' };
    }

    if (this.usedMovieIds.has(movieId)) {
      return { success: false, message: 'You already used this movie.' };
    }

    // Check if any neighbor shares this movie
    const neighbors = neighborsData.neighbors || [];
    const validNeighbors = neighbors.filter(n =>
      n.movies.some(m => m.id === movieId)
    );

    if (validNeighbors.length === 0) {
      const movieMeta = this.moviesMetadata[movieId];
      const movieTitle = movieMeta ? movieMeta.title : `Movie #${movieId}`;
      const actorMeta = this.actorsMetadata[this.currentActorId];
      const actorName = actorMeta ? actorMeta.name : `Actor #${this.currentActorId}`;
      return {
        success: false,
        message: `${actorName} did not appear in "${movieTitle}".`
      };
    }

    // Valid movie guess
    this.usedMovieIds.add(movieId);
    this.pendingMovie = this.resolveMovie(movieId);
    this.pendingNeighbors = neighborsData;

    return { success: true };
  }

  /**
   * Guess an actor (after a successful movie guess)
   * @param {number} actorId
   * @returns {{ success: boolean, message?: string, completed?: boolean }}
   */
  guessActor(actorId) {
    this.totalGuesses++;

    if (this.completed || this.gaveUp) {
      return { success: false, message: 'Game is already over.' };
    }

    if (!this.pendingMovie) {
      return { success: false, message: 'You must guess a movie first.' };
    }

    if (this.usedActorIds.has(actorId)) {
      return { success: false, message: 'You already visited this actor.' };
    }

    // Check that actor is a neighbor of current actor via the pending movie
    const neighbors = this.pendingNeighbors?.neighbors || [];
    const neighborEntry = neighbors.find(n => n.actorId === actorId);

    if (!neighborEntry) {
      const actorMeta = this.actorsMetadata[actorId];
      const actorName = actorMeta ? actorMeta.name : `Actor #${actorId}`;
      return {
        success: false,
        message: `${actorName} did not appear in "${this.pendingMovie.title}".`
      };
    }

    // Check the pending movie specifically connects these actors
    const movieConnects = neighborEntry.movies.some(m => m.id === this.pendingMovie.id);
    if (!movieConnects) {
      const actorMeta = this.actorsMetadata[actorId];
      const actorName = actorMeta ? actorMeta.name : `Actor #${actorId}`;
      return {
        success: false,
        message: `${actorName} did not appear in "${this.pendingMovie.title}".`
      };
    }

    // Valid actor guess — complete the segment
    const resolvedActor = this.resolveActor(actorId);
    this.segments.push({
      movie: this.pendingMovie,
      actor: resolvedActor
    });

    this.usedActorIds.add(actorId);
    this.currentActorId = actorId;
    this.pendingMovie = null;
    this.pendingNeighbors = null;

    // Check win condition
    if (actorId === this.targetActorId) {
      this.completed = true;
      return { success: true, completed: true };
    }

    return { success: true, completed: false };
  }

  /**
   * Swap start and target actors (only before any moves)
   * @returns {boolean}
   */
  swap() {
    if (this.totalGuesses > 0) return false;

    const tmp = this.startActorId;
    this.startActorId = this.targetActorId;
    this.targetActorId = tmp;
    this.currentActorId = this.startActorId;
    this.usedActorIds = new Set([this.startActorId]);
    return true;
  }

  /**
   * Give up the game
   */
  giveUp() {
    this.completed = true;
    this.gaveUp = true;
  }

  /**
   * Serialize for localStorage persistence
   */
  serialize() {
    return {
      startActorId: this.startActorId,
      targetActorId: this.targetActorId,
      currentActorId: this.currentActorId,
      segments: this.segments,
      pendingMovie: this.pendingMovie,
      usedMovieIds: [...this.usedMovieIds],
      usedActorIds: [...this.usedActorIds],
      totalGuesses: this.totalGuesses,
      completed: this.completed,
      gaveUp: this.gaveUp
    };
  }

  /**
   * Deserialize from localStorage
   * @param {Object} data - serialized game state
   * @param {Object} actorsMetadata
   * @param {Object} moviesMetadata
   * @param {string} tmdbImageBase
   * @returns {GameEngine}
   */
  static deserialize(data, actorsMetadata, moviesMetadata, tmdbImageBase) {
    const engine = new GameEngine(
      data.startActorId,
      data.targetActorId,
      actorsMetadata,
      moviesMetadata,
      tmdbImageBase
    );
    engine.currentActorId = data.currentActorId;
    engine.segments = data.segments || [];
    engine.pendingMovie = data.pendingMovie || null;
    engine.usedMovieIds = new Set(data.usedMovieIds || []);
    engine.usedActorIds = new Set(data.usedActorIds || []);
    engine.totalGuesses = data.totalGuesses || 0;
    engine.completed = data.completed || false;
    engine.gaveUp = data.gaveUp || false;
    return engine;
  }
}
