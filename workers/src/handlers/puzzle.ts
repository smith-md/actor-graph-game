/**
 * Puzzle Handlers
 *
 * GET /api/puzzle/today - Get today's daily puzzle
 * GET /api/puzzle/reveal - Get reveal data after give up
 */

import { Env } from '../index';
import { getDateKey, getCentralTime } from '../utils/date';

type JsonResponse = (data: any, status?: number, cacheSeconds?: number) => Response;
type ErrorResponse = (message: string, status?: number) => Response;

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
  const reveal = await env.PUZZLE_KV.get(`reveal:${dateKey}`, 'json');

  if (!reveal) {
    return errorResponse('Reveal data not available', 404);
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
