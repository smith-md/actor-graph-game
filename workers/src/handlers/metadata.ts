/**
 * Metadata Handlers
 *
 * GET /api/metadata/actors - Get all actor metadata
 * GET /api/metadata/movies - Get all movie metadata
 * GET /api/metadata - Get manifest/version info
 */

import { Env } from '../index';

type JsonResponse = (data: any, status?: number, cacheSeconds?: number) => Response;
type ErrorResponse = (message: string, status?: number) => Response;

/**
 * Get all actor metadata
 */
export async function handleGetActors(
  env: Env,
  jsonResponse: JsonResponse,
  errorResponse: ErrorResponse
): Promise<Response> {
  try {
    const path = `graph/${env.GRAPH_VERSION}/metadata/actors.json`;
    const obj = await env.GRAPH_BUCKET.get(path);

    if (!obj) {
      return errorResponse('Actors metadata not found', 404);
    }

    const data = await obj.json();

    return jsonResponse({
      actors: data,
      graphVersion: env.GRAPH_VERSION,
    }, 200, 86400); // Cache for 24 hours

  } catch (error) {
    console.error('Error fetching actors:', error);
    return errorResponse('Failed to fetch actors', 500);
  }
}

/**
 * Get all movie metadata
 */
export async function handleGetMovies(
  env: Env,
  jsonResponse: JsonResponse,
  errorResponse: ErrorResponse
): Promise<Response> {
  try {
    const path = `graph/${env.GRAPH_VERSION}/metadata/movies.json`;
    const obj = await env.GRAPH_BUCKET.get(path);

    if (!obj) {
      return errorResponse('Movies metadata not found', 404);
    }

    const data = await obj.json();

    return jsonResponse({
      movies: data,
      graphVersion: env.GRAPH_VERSION,
    }, 200, 86400); // Cache for 24 hours

  } catch (error) {
    console.error('Error fetching movies:', error);
    return errorResponse('Failed to fetch movies', 500);
  }
}

/**
 * Get manifest/version info
 */
export async function handleGetMetadata(
  env: Env,
  jsonResponse: JsonResponse,
  errorResponse: ErrorResponse
): Promise<Response> {
  try {
    const path = `graph/${env.GRAPH_VERSION}/metadata/manifest.json`;
    const obj = await env.GRAPH_BUCKET.get(path);

    if (!obj) {
      return errorResponse('Manifest not found', 404);
    }

    const data = await obj.json();

    return jsonResponse({
      ...data as object,
      graphVersion: env.GRAPH_VERSION,
    }, 200, 3600); // Cache for 1 hour

  } catch (error) {
    console.error('Error fetching metadata:', error);
    return errorResponse('Failed to fetch metadata', 500);
  }
}
