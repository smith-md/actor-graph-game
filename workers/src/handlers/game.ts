/**
 * Game Handlers
 *
 * GET /api/actors/:actorId/neighbors - Get neighbors for an actor
 * POST /api/validate-move - Validate a move
 */

import { Env } from '../index';

type JsonResponse = (data: any, status?: number, cacheSeconds?: number) => Response;
type ErrorResponse = (message: string, status?: number) => Response;

interface NeighborData {
  actorId: number;
  neighbors: {
    actorId: number;
    movies: {
      id: number;
      title: string;
      poster: string;
      pop: number;
    }[];
  }[];
}

interface ValidateMoveRequest {
  fromActorId: number;
  toActorId: number;
}

/**
 * Get neighbors for an actor
 */
export async function handleGetNeighbors(
  actorId: string,
  env: Env,
  jsonResponse: JsonResponse,
  errorResponse: ErrorResponse
): Promise<Response> {
  try {
    const path = `graph/${env.GRAPH_VERSION}/neighbors/${actorId}.json`;
    const obj = await env.GRAPH_BUCKET.get(path);

    if (!obj) {
      return errorResponse('Actor not found', 404);
    }

    const data = await obj.json() as NeighborData;

    return jsonResponse({
      actorId: data.actorId,
      neighbors: data.neighbors,
      graphVersion: env.GRAPH_VERSION,
    }, 200, 86400); // Cache for 24 hours

  } catch (error) {
    console.error('Error fetching neighbors:', error);
    return errorResponse('Failed to fetch neighbors', 500);
  }
}

/**
 * Validate a move (check if two actors are connected)
 */
export async function handleValidateMove(
  request: Request,
  env: Env,
  jsonResponse: JsonResponse,
  errorResponse: ErrorResponse
): Promise<Response> {
  try {
    const body = await request.json() as ValidateMoveRequest;
    const { fromActorId, toActorId } = body;

    if (!fromActorId || !toActorId) {
      return errorResponse('Missing fromActorId or toActorId', 400);
    }

    // Fetch neighbors of fromActor
    const path = `graph/${env.GRAPH_VERSION}/neighbors/${fromActorId}.json`;
    const obj = await env.GRAPH_BUCKET.get(path);

    if (!obj) {
      return errorResponse('From actor not found', 404);
    }

    const data = await obj.json() as NeighborData;

    // Check if toActorId is in neighbors
    const connection = data.neighbors.find(n => n.actorId === toActorId);

    if (connection) {
      // Find the most popular movie connecting them
      const movies = connection.movies || [];
      const bestMovie = movies.length > 0
        ? movies.reduce((best, m) => (m.pop > best.pop ? m : best), movies[0])
        : null;

      return jsonResponse({
        valid: true,
        movieId: bestMovie?.id || null,
        movieTitle: bestMovie?.title || null,
        allMovies: movies.map(m => ({ id: m.id, title: m.title })),
      }, 200);
    } else {
      return jsonResponse({
        valid: false,
        movieId: null,
      }, 200);
    }

  } catch (error) {
    console.error('Error validating move:', error);
    return errorResponse('Failed to validate move', 500);
  }
}
