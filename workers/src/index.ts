/**
 * CineLinks Edge API
 *
 * Cloudflare Worker for serving game data from R2 storage
 */

import { Router } from './router';
import { handlePuzzleToday, handlePuzzleReveal } from './handlers/puzzle';
import { handleGetNeighbors, handleValidateMove } from './handlers/game';
import { handleGetActors, handleGetMovies, handleGetMetadata } from './handlers/metadata';
import { handleScheduledPuzzle } from './handlers/scheduled';

export interface Env {
  GRAPH_BUCKET: R2Bucket;
  PUZZLE_KV: KVNamespace;
  GRAPH_VERSION: string;
  TMDB_IMAGE_BASE: string;
}

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function handleOptions(request: Request): Response {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

function jsonResponse(data: any, status = 200, cacheSeconds = 0): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...corsHeaders,
  };

  if (cacheSeconds > 0) {
    headers['Cache-Control'] = `public, max-age=${cacheSeconds}`;
  }

  return new Response(JSON.stringify(data), { status, headers });
}

function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions(request);
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Health check
      if (path === '/health' || path === '/') {
        return jsonResponse({
          ok: true,
          service: 'CineLinks Edge API',
          version: env.GRAPH_VERSION,
        });
      }

      // API Routes
      // GET /api/puzzle/today - Get today's puzzle
      if (path === '/api/puzzle/today' && request.method === 'GET') {
        return await handlePuzzleToday(request, env, jsonResponse, errorResponse);
      }

      // GET /api/puzzle/reveal - Get reveal data for today's puzzle (after give up)
      if (path === '/api/puzzle/reveal' && request.method === 'GET') {
        return await handlePuzzleReveal(request, env, jsonResponse, errorResponse);
      }

      // GET /api/actors/:actorId/neighbors - Get actor neighbors
      const neighborsMatch = path.match(/^\/api\/actors\/(\d+)\/neighbors$/);
      if (neighborsMatch && request.method === 'GET') {
        const actorId = neighborsMatch[1];
        return await handleGetNeighbors(actorId, env, jsonResponse, errorResponse);
      }

      // POST /api/validate-move - Validate a move
      if (path === '/api/validate-move' && request.method === 'POST') {
        return await handleValidateMove(request, env, jsonResponse, errorResponse);
      }

      // GET /api/metadata/actors - Get all actor metadata
      if (path === '/api/metadata/actors' && request.method === 'GET') {
        return await handleGetActors(env, jsonResponse, errorResponse);
      }

      // GET /api/metadata/movies - Get all movie metadata
      if (path === '/api/metadata/movies' && request.method === 'GET') {
        return await handleGetMovies(env, jsonResponse, errorResponse);
      }

      // GET /api/metadata - Get manifest/version info
      if (path === '/api/metadata' && request.method === 'GET') {
        return await handleGetMetadata(env, jsonResponse, errorResponse);
      }

      // 404 for unknown routes
      return errorResponse('Not found', 404);

    } catch (error) {
      console.error('Request error:', error);
      return errorResponse('Internal server error', 500);
    }
  },

  // Scheduled handler for daily puzzle generation
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduledPuzzle(env));
  },
};
