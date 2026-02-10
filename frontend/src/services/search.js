/**
 * Client-side autocomplete search over actors and movies metadata
 * Uses Unicode NFKD normalization matching the backend's norm() function
 */

const TMDB_ACTOR_SIZE = '/w185';
const TMDB_POSTER_SIZE = '/w154';

/**
 * Normalize a string for search: NFKD decomposition, strip diacritics, lowercase
 */
function normalize(s) {
  if (!s) return '';
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .trim();
}

export class SearchIndex {
  constructor() {
    this.actors = [];     // [{ id, name, nameNorm, image }]
    this.movies = [];     // [{ id, title, titleNorm, poster, year, pop }]
    this._actorsLoaded = false;
    this._moviesLoaded = false;
  }

  /**
   * Load actors metadata from Workers API response
   * @param {Object} actorsData - { actors: { [id]: { id, name, image, pool } } }
   * @param {string} tmdbImageBase
   */
  loadActors(actorsData, tmdbImageBase) {
    const actors = actorsData.actors || actorsData;
    this.actors = Object.values(actors).map(a => ({
      id: a.id,
      name: a.name,
      nameNorm: normalize(a.name),
      image: a.image ? `${tmdbImageBase}${TMDB_ACTOR_SIZE}${a.image}` : null
    }));
    // Sort by name for consistent results
    this.actors.sort((a, b) => a.name.localeCompare(b.name));
    this._actorsLoaded = true;
  }

  /**
   * Load movies metadata from Workers API response
   * @param {Object} moviesData - { movies: { [id]: { id, title, poster, pop } } }
   * @param {string} tmdbImageBase
   */
  loadMovies(moviesData, tmdbImageBase) {
    const movies = moviesData.movies || moviesData;
    this.movies = Object.values(movies).map(m => {
      // Extract year from title if present (e.g. "Fight Club (1999)")
      let title = m.title;
      let year = null;
      const yearMatch = title && title.match(/\((\d{4})\)\s*$/);
      if (yearMatch) {
        year = yearMatch[1];
        title = title.replace(/\s*\(\d{4}\)\s*$/, '').trim();
      }
      return {
        id: m.id,
        movie_id: m.id, // alias for SuggestionBox compatibility
        title: m.title, // keep original title with year
        titleNorm: normalize(m.title),
        poster: m.poster ? `${tmdbImageBase}${TMDB_POSTER_SIZE}${m.poster}` : null,
        year,
        pop: m.pop || 0
      };
    });
    // Sort by popularity descending for better default ordering
    this.movies.sort((a, b) => b.pop - a.pop);
    this._moviesLoaded = true;
  }

  isLoaded() {
    return this._actorsLoaded && this._moviesLoaded;
  }

  /**
   * Search actors by name
   * @param {string} query
   * @param {number} limit
   * @returns {Array<{ name, id, image }>} - format matching SuggestionBox
   */
  searchActors(query, limit = 10) {
    if (!query || !this._actorsLoaded) return [];
    const q = normalize(query);
    if (!q) return [];

    const prefixMatches = [];
    const containsMatches = [];

    for (const actor of this.actors) {
      if (prefixMatches.length + containsMatches.length >= limit * 2) break;
      if (actor.nameNorm.startsWith(q)) {
        prefixMatches.push(actor);
      } else if (actor.nameNorm.includes(q)) {
        containsMatches.push(actor);
      }
    }

    // Also check last-name prefix match (common search pattern)
    if (prefixMatches.length < limit) {
      for (const actor of this.actors) {
        if (prefixMatches.length >= limit) break;
        if (prefixMatches.includes(actor) || containsMatches.includes(actor)) continue;
        const parts = actor.nameNorm.split(' ');
        const lastName = parts[parts.length - 1];
        if (lastName.startsWith(q)) {
          prefixMatches.push(actor);
        }
      }
    }

    return [...prefixMatches, ...containsMatches]
      .slice(0, limit)
      .map(a => ({
        name: a.name,
        id: a.id,
        image: a.image
      }));
  }

  /**
   * Search movies by title
   * @param {string} query
   * @param {number} limit
   * @returns {Array<{ title, movie_id, poster, year }>} - format matching SuggestionBox
   */
  searchMovies(query, limit = 10) {
    if (!query || !this._moviesLoaded) return [];
    const q = normalize(query);
    if (!q) return [];

    const prefixMatches = [];
    const containsMatches = [];

    for (const movie of this.movies) {
      if (prefixMatches.length + containsMatches.length >= limit * 2) break;
      if (movie.titleNorm.startsWith(q)) {
        prefixMatches.push(movie);
      } else if (movie.titleNorm.includes(q)) {
        containsMatches.push(movie);
      }
    }

    return [...prefixMatches, ...containsMatches]
      .slice(0, limit)
      .map(m => ({
        title: m.title,
        movie_id: m.id,
        poster: m.poster,
        year: m.year
      }));
  }
}
