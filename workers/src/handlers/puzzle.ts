/**
 * Puzzle Handlers
 *
 * GET /api/puzzle/today - Get today's daily puzzle
 * GET /api/puzzle/reveal - Get reveal data after give up
 */

import { Env } from '../index';
import { getDateKey } from '../utils/date';

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

interface ActorMetadata {
  [key: string]: {
    id: number;
    name: string;
    image: string;
    pool: boolean;
    deg: number;
  };
}

export async function handlePuzzleToday(
  request: Request,
  env: Env,
  jsonResponse: JsonResponse,
  errorResponse: ErrorResponse
): Promise<Response> {
  const dateKey = getDateKey();

  // Try to get puzzle from KV
  let puzzle = await env.PUZZLE_KV.get(`puzzle:${dateKey}`, 'json');

  if (!puzzle) {
    // Generate puzzle if not found
    puzzle = await generateDailyPuzzle(env, dateKey);
    if (!puzzle) {
      return errorResponse('Failed to generate puzzle', 500);
    }
  }

  return jsonResponse({
    startActorId: (puzzle as any).startActorId,
    endActorId: (puzzle as any).endActorId,
    date: dateKey,
    graphVersion: env.GRAPH_VERSION,
  }, 200, 3600); // Cache for 1 hour
}

export async function handlePuzzleReveal(
  request: Request,
  env: Env,
  jsonResponse: JsonResponse,
  errorResponse: ErrorResponse
): Promise<Response> {
  const dateKey = getDateKey();

  // Get reveal data from KV
  let reveal = await env.PUZZLE_KV.get(`reveal:${dateKey}`, 'json');

  if (!reveal) {
    // Generate reveal data on-demand if not pre-computed by scheduled handler
    reveal = await generateRevealData(env, dateKey);
    if (!reveal) {
      return errorResponse('Reveal data not available', 404);
    }
  }

  return jsonResponse({
    ...(reveal as object),
    graphVersion: env.GRAPH_VERSION,
  }, 200, 3600); // Cache for 1 hour
}

/**
 * Generate daily puzzle using deterministic seeding
 */
async function generateDailyPuzzle(env: Env, dateKey: string): Promise<object | null> {
  try {
    // Load starting pool
    const poolPath = `graph/${env.GRAPH_VERSION}/metadata/starting_pool.json`;
    const poolObj = await env.GRAPH_BUCKET.get(poolPath);
    if (!poolObj) {
      console.error('Starting pool not found');
      return null;
    }

    const poolData = await poolObj.json() as { actors: number[] };
    const actors = poolData.actors;

    if (actors.length < 2) {
      console.error('Not enough actors in starting pool');
      return null;
    }

    // Deterministic selection based on date
    const seed = parseInt(dateKey.replace(/-/g, ''));
    const index1 = seed % actors.length;
    const index2 = (seed * 31 + 17) % actors.length;

    // Ensure different actors
    let startActorId = actors[index1];
    let endActorId = actors[index2 === index1 ? (index2 + 1) % actors.length : index2];

    // Verify they're not directly connected
    const neighborsPath = `graph/${env.GRAPH_VERSION}/neighbors/${startActorId}.json`;
    const neighborsObj = await env.GRAPH_BUCKET.get(neighborsPath);
    if (neighborsObj) {
      const neighborsData = await neighborsObj.json() as { neighbors: { actorId: number }[] };
      const directNeighbors = new Set(neighborsData.neighbors.map(n => n.actorId));

      // If directly connected, find another end actor
      if (directNeighbors.has(endActorId)) {
        for (let i = 0; i < actors.length; i++) {
          const candidate = actors[(index2 + i) % actors.length];
          if (candidate !== startActorId && !directNeighbors.has(candidate)) {
            endActorId = candidate;
            break;
          }
        }
      }
    }

    const puzzle = {
      startActorId,
      endActorId,
      date: dateKey,
      generatedAt: new Date().toISOString(),
      graphVersion: env.GRAPH_VERSION,
    };

    // Store in KV with 48 hour expiration
    await env.PUZZLE_KV.put(`puzzle:${dateKey}`, JSON.stringify(puzzle), {
      expirationTtl: 172800,
    });

    return puzzle;

  } catch (error) {
    console.error('Error generating puzzle:', error);
    return null;
  }
}

/**
 * Generate reveal data on-demand for a given date's puzzle
 */
async function generateRevealData(env: Env, dateKey: string): Promise<object | null> {
  try {
    // Get the puzzle to know start/end actors
    const puzzle = await env.PUZZLE_KV.get(`puzzle:${dateKey}`, 'json') as {
      startActorId: number;
      endActorId: number;
    } | null;

    if (!puzzle) {
      console.error('Cannot generate reveal: puzzle not found');
      return null;
    }

    const { startActorId, endActorId } = puzzle;

    // Load actor metadata
    const actorsPath = `graph/${env.GRAPH_VERSION}/metadata/actors.json`;
    const actorsObj = await env.GRAPH_BUCKET.get(actorsPath);
    if (!actorsObj) {
      console.error('Actor metadata not found');
      return null;
    }
    const actorMetadata = await actorsObj.json() as ActorMetadata;

    // Load neighbors for start and end actors
    const startNeighborsObj = await env.GRAPH_BUCKET.get(
      `graph/${env.GRAPH_VERSION}/neighbors/${startActorId}.json`
    );
    const endNeighborsObj = await env.GRAPH_BUCKET.get(
      `graph/${env.GRAPH_VERSION}/neighbors/${endActorId}.json`
    );

    if (!startNeighborsObj || !endNeighborsObj) {
      console.error('Could not load neighbor data for reveal');
      return null;
    }

    const startNeighbors = await startNeighborsObj.json() as NeighborData;
    const endNeighbors = await endNeighborsObj.json() as NeighborData;

    const startNeighborIds = new Set(startNeighbors.neighbors.map(n => n.actorId));
    const endNeighborIds = new Set(endNeighbors.neighbors.map(n => n.actorId));

    // Find common neighbors (intermediaries for 2-hop paths)
    const intermediaries: number[] = [];
    for (const neighborId of startNeighborIds) {
      if (endNeighborIds.has(neighborId)) {
        intermediaries.push(neighborId);
      }
    }

    // Rank intermediaries by degree (most connected first)
    const rankedIntermediaries = intermediaries
      .map(id => ({
        id,
        name: actorMetadata[id]?.name || 'Unknown',
        image: actorMetadata[id]?.image || '',
        deg: actorMetadata[id]?.deg || 0,
      }))
      .sort((a, b) => b.deg - a.deg);

    // Build best path from first intermediary
    let bestPath = null;
    let shortestHopCount = 0;

    if (rankedIntermediaries.length > 0) {
      shortestHopCount = 2;
      const bestIntermediary = rankedIntermediaries[0];

      const startToInt = startNeighbors.neighbors.find(n => n.actorId === bestIntermediary.id);

      // Load intermediary's neighbors to get movie to end
      const intNeighborsObj = await env.GRAPH_BUCKET.get(
        `graph/${env.GRAPH_VERSION}/neighbors/${bestIntermediary.id}.json`
      );
      let movieToEnd = null;
      if (intNeighborsObj) {
        const intNeighbors = await intNeighborsObj.json() as NeighborData;
        const toEndConnection = intNeighbors.neighbors.find(n => n.actorId === endActorId);
        if (toEndConnection && toEndConnection.movies.length > 0) {
          movieToEnd = toEndConnection.movies[0];
        }
      }

      bestPath = {
        actors: [startActorId, bestIntermediary.id, endActorId],
        movies: [
          startToInt?.movies[0]?.id || null,
          movieToEnd?.id || null,
        ].filter(Boolean),
      };
    }

    const reveal = {
      date: dateKey,
      shortestHopCount,
      bestPath,
      otherShortestPathCount: Math.max(0, intermediaries.length - 1),
      topBridgeActors: rankedIntermediaries.slice(0, 5).map(a => ({
        id: a.id,
        name: a.name,
        image: a.image,
      })),
      graphVersion: env.GRAPH_VERSION,
      generatedAt: new Date().toISOString(),
    };

    // Cache in KV for subsequent requests
    await env.PUZZLE_KV.put(`reveal:${dateKey}`, JSON.stringify(reveal), {
      expirationTtl: 172800,
    });

    return reveal;

  } catch (error) {
    console.error('Error generating reveal data:', error);
    return null;
  }
}
