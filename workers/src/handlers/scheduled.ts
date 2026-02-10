/**
 * Scheduled Handler
 *
 * Runs daily to pre-compute puzzle and reveal data
 */

import { Env } from '../index';
import { getDateKey } from '../utils/date';

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
  };
}

/**
 * Generate daily puzzle and reveal data
 */
export async function handleScheduledPuzzle(env: Env): Promise<void> {
  console.log('Running scheduled puzzle generation...');

  const dateKey = getDateKey();
  console.log(`Date key: ${dateKey}`);

  try {
    // Load starting pool
    const poolPath = `graph/${env.GRAPH_VERSION}/metadata/starting_pool.json`;
    const poolObj = await env.GRAPH_BUCKET.get(poolPath);
    if (!poolObj) {
      console.error('Starting pool not found');
      return;
    }

    const poolData = await poolObj.json() as { actors: number[] };
    const actors = poolData.actors;
    console.log(`Loaded ${actors.length} starting pool actors`);

    // Load actor metadata for ranking
    const actorsPath = `graph/${env.GRAPH_VERSION}/metadata/actors.json`;
    const actorsObj = await env.GRAPH_BUCKET.get(actorsPath);
    if (!actorsObj) {
      console.error('Actor metadata not found');
      return;
    }
    const actorMetadata = await actorsObj.json() as ActorMetadata;

    // Generate deterministic puzzle
    const seed = parseInt(dateKey.replace(/-/g, ''));
    const index1 = seed % actors.length;
    const index2 = (seed * 31 + 17) % actors.length;

    let startActorId = actors[index1];
    let endActorId = actors[index2 === index1 ? (index2 + 1) % actors.length : index2];

    // Load neighbors to check direct connection and compute reveal
    const startNeighborsPath = `graph/${env.GRAPH_VERSION}/neighbors/${startActorId}.json`;
    const startNeighborsObj = await env.GRAPH_BUCKET.get(startNeighborsPath);
    const endNeighborsPath = `graph/${env.GRAPH_VERSION}/neighbors/${endActorId}.json`;
    const endNeighborsObj = await env.GRAPH_BUCKET.get(endNeighborsPath);

    if (!startNeighborsObj || !endNeighborsObj) {
      console.error('Could not load neighbor data');
      return;
    }

    const startNeighbors = await startNeighborsObj.json() as NeighborData;
    const endNeighbors = await endNeighborsObj.json() as NeighborData;

    const startNeighborIds = new Set(startNeighbors.neighbors.map(n => n.actorId));
    const endNeighborIds = new Set(endNeighbors.neighbors.map(n => n.actorId));

    // Check if directly connected
    if (startNeighborIds.has(endActorId)) {
      // Find alternative end actor
      for (let i = 0; i < actors.length; i++) {
        const candidate = actors[(index2 + i) % actors.length];
        if (candidate !== startActorId && !startNeighborIds.has(candidate)) {
          endActorId = candidate;
          // Reload end neighbors
          const newEndPath = `graph/${env.GRAPH_VERSION}/neighbors/${endActorId}.json`;
          const newEndObj = await env.GRAPH_BUCKET.get(newEndPath);
          if (newEndObj) {
            const newEndData = await newEndObj.json() as NeighborData;
            endNeighborIds.clear();
            newEndData.neighbors.forEach(n => endNeighborIds.add(n.actorId));
          }
          break;
        }
      }
    }

    // Store puzzle
    const puzzle = {
      startActorId,
      endActorId,
      date: dateKey,
      generatedAt: new Date().toISOString(),
      graphVersion: env.GRAPH_VERSION,
    };

    await env.PUZZLE_KV.put(`puzzle:${dateKey}`, JSON.stringify(puzzle), {
      expirationTtl: 172800, // 48 hours
    });
    console.log(`Puzzle stored: ${startActorId} -> ${endActorId}`);

    // Compute reveal data (bridge actors for 2-hop paths)
    // Find common neighbors (intermediaries)
    const intermediaries: number[] = [];
    for (const neighborId of startNeighborIds) {
      if (endNeighborIds.has(neighborId)) {
        intermediaries.push(neighborId);
      }
    }

    console.log(`Found ${intermediaries.length} intermediaries (2-hop paths)`);

    // Rank intermediaries by name recognition (using metadata)
    const rankedIntermediaries = intermediaries
      .map(id => ({
        id,
        name: actorMetadata[id]?.name || 'Unknown',
        image: actorMetadata[id]?.image || '',
      }))
      .sort((a, b) => a.name.localeCompare(b.name)); // Alphabetical for now

    // Select best path (first intermediary)
    let bestPath = null;
    let shortestHopCount = 0;

    if (rankedIntermediaries.length > 0) {
      shortestHopCount = 2;
      const bestIntermediary = rankedIntermediaries[0];

      // Get movies for the path
      const startToInt = startNeighbors.neighbors.find(n => n.actorId === bestIntermediary.id);
      const intToEnd = endNeighbors.neighbors.find(n => n.actorId === bestIntermediary.id);

      // Load intermediary's neighbors to get movie to end
      const intNeighborsPath = `graph/${env.GRAPH_VERSION}/neighbors/${bestIntermediary.id}.json`;
      const intNeighborsObj = await env.GRAPH_BUCKET.get(intNeighborsPath);
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

    // Store reveal data
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

    await env.PUZZLE_KV.put(`reveal:${dateKey}`, JSON.stringify(reveal), {
      expirationTtl: 172800, // 48 hours
    });
    console.log(`Reveal data stored with ${reveal.topBridgeActors.length} bridge actors`);

    console.log('Scheduled puzzle generation complete');

  } catch (error) {
    console.error('Error in scheduled puzzle generation:', error);
  }
}
