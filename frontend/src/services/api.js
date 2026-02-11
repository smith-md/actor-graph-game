/**
 * Edge API service for CineLinks
 * Connects to Cloudflare Workers API with caching
 */

import {
  neighborsCache,
  metadataCache,
  isPrefetching,
  addToPrefetchQueue,
  removeFromPrefetchQueue
} from './cache.js';

// API base URL - Cloudflare Workers
const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000');

/**
 * Fetch with timeout and retry
 */
async function fetchWithRetry(url, options = {}, retries = 2, timeout = 10000) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || error.detail || `HTTP ${response.status}`);
      }

      return response;
    } catch (err) {
      clearTimeout(timeoutId);

      if (attempt === retries) {
        throw err;
      }

      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 500));
    }
  }
}

/**
 * Get today's daily puzzle
 * Returns { startActorId, endActorId, date, graphVersion }
 */
export async function getPuzzle() {
  const response = await fetchWithRetry(`${API_BASE}/api/puzzle/today`);
  return response.json();
}

/**
 * Get actor's neighbors (lazy load, with caching)
 */
export async function getNeighbors(actorId) {
  const cacheKey = `neighbors:${actorId}`;

  // Check cache first
  const cached = await neighborsCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const response = await fetchWithRetry(`${API_BASE}/api/actors/${actorId}/neighbors`);
  const data = await response.json();
  await neighborsCache.set(cacheKey, data);
  return data;
}

/**
 * Prefetch actor's neighbors (on hover)
 */
export async function prefetchNeighbors(actorId) {
  const cacheKey = `neighbors:${actorId}`;

  // Skip if already cached or prefetching
  const cached = await neighborsCache.get(cacheKey);
  if (cached || isPrefetching(cacheKey)) {
    return;
  }

  addToPrefetchQueue(cacheKey);

  try {
    await getNeighbors(actorId);
  } catch (err) {
    console.debug('Prefetch failed for actor', actorId, err);
  } finally {
    removeFromPrefetchQueue(cacheKey);
  }
}

/**
 * Get actors metadata
 * Returns { actors: { [id]: { id, name, image, pool } }, graphVersion }
 */
export async function getActorsMetadata(graphVersion) {
  const cacheKey = `actors-metadata:${graphVersion || ''}`;
  const cached = metadataCache.get(cacheKey);
  if (cached) return cached;

  const url = graphVersion
    ? `${API_BASE}/api/metadata/actors?v=${graphVersion}`
    : `${API_BASE}/api/metadata/actors`;
  const response = await fetchWithRetry(url);
  const data = await response.json();
  metadataCache.set(cacheKey, data);
  return data;
}

/**
 * Get movies metadata
 * Returns { movies: { [id]: { id, title, poster, pop } }, graphVersion }
 */
export async function getMoviesMetadata(graphVersion) {
  const cacheKey = `movies-metadata:${graphVersion || ''}`;
  const cached = metadataCache.get(cacheKey);
  if (cached) return cached;

  const url = graphVersion
    ? `${API_BASE}/api/metadata/movies?v=${graphVersion}`
    : `${API_BASE}/api/metadata/movies`;
  const response = await fetchWithRetry(url);
  const data = await response.json();
  metadataCache.set(cacheKey, data);
  return data;
}

/**
 * Get reveal data (shortest path + bridge actors)
 * Returns { date, shortestHopCount, bestPath, otherShortestPathCount, topBridgeActors, ... }
 */
export async function getReveal(date) {
  const url = date ? `${API_BASE}/api/puzzle/reveal?date=${date}` : `${API_BASE}/api/puzzle/reveal`;
  const response = await fetchWithRetry(url);
  return response.json();
}

/**
 * Health check
 */
export async function checkHealth() {
  try {
    const response = await fetchWithRetry(`${API_BASE}/health`, {}, 1, 5000);
    return response.json();
  } catch {
    return { ok: false };
  }
}
