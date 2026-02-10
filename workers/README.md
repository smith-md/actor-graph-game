# CineLinks Edge API

Cloudflare Workers API for the CineLinks game. Provides edge-optimized endpoints for daily puzzles and game data.

## Architecture

```
Frontend (Cloudflare Pages)
    │
    ▼
Cloudflare Workers (Edge API)
    │
    ├── R2 Bucket (Graph Data)
    │   └── /graph/{version}/neighbors/{actorId}.json
    │   └── /graph/{version}/metadata/actors.json
    │   └── /graph/{version}/metadata/movies.json
    │   └── /graph/{version}/metadata/starting_pool.json
    │
    └── KV Namespace (Puzzles)
        └── puzzle:{date}  → Daily puzzle data
        └── reveal:{date}  → Reveal data for give-up
```

## Prerequisites

1. **Node.js** 18+ installed
2. **Wrangler CLI** installed: `npm install -g wrangler`
3. **Cloudflare Account** with:
   - R2 bucket created: `wrangler r2 bucket create cinelinks-graph`
   - KV namespace created: `wrangler kv:namespace create PUZZLE_KV`

## Setup

1. **Install dependencies:**
   ```bash
   cd workers
   npm install
   ```

2. **Configure wrangler.toml:**
   Update the KV namespace ID with your actual namespace:
   ```toml
   [[kv_namespaces]]
   binding = "PUZZLE_KV"
   id = "your-kv-namespace-id"
   ```

3. **Upload graph data to R2:**
   ```bash
   # From project root
   # First, generate edge data
   python build/export_graph_for_edge.py

   # Then upload to R2 (Windows)
   .\scripts\upload-graph-to-r2.ps1

   # Or Unix/Mac
   ./scripts/upload-graph-to-r2.sh
   ```

4. **Update GRAPH_VERSION** in wrangler.toml to match your upload

## Development

```bash
# Start local dev server
npm run dev

# The API will be available at http://localhost:8787
```

## Deployment

```bash
# Deploy to Cloudflare Workers
npm run deploy

# View logs
npm run tail
```

## API Endpoints

### GET /api/puzzle/today
Get today's daily puzzle.

**Response:**
```json
{
  "puzzleId": "20250205",
  "date": "2025-02-05",
  "startActor": {
    "id": 287,
    "name": "Brad Pitt",
    "image": "https://image.tmdb.org/t/p/w185/..."
  },
  "targetActor": {
    "id": 1136406,
    "name": "Tom Holland",
    "image": "https://image.tmdb.org/t/p/w185/..."
  }
}
```

### GET /api/actors/{actorId}/neighbors
Get all actors connected to a given actor through shared movies.

**Response:**
```json
{
  "actorId": 287,
  "neighbors": [
    {
      "actorId": 1136406,
      "movies": [
        {
          "id": 12345,
          "title": "Movie Title",
          "poster": "/poster.jpg",
          "pop": 42.5
        }
      ]
    }
  ]
}
```

### POST /api/validate-move
Validate if two actors are connected via a specific movie.

**Request:**
```json
{
  "fromActorId": 287,
  "movieId": 12345,
  "toActorId": 1136406
}
```

**Response:**
```json
{
  "valid": true,
  "movie": {
    "id": 12345,
    "title": "Movie Title",
    "poster": "/poster.jpg"
  },
  "toActor": {
    "id": 1136406,
    "name": "Tom Holland",
    "image": "/image.jpg"
  }
}
```

### GET /api/puzzle/reveal
Get reveal data for give-up (shows optimal path).

**Response:**
```json
{
  "date": "2025-02-05",
  "shortestHopCount": 2,
  "bestPath": {
    "actors": [287, 500, 1136406],
    "movies": [12345, 67890]
  },
  "topBridgeActors": [
    { "id": 500, "name": "Bridge Actor", "image": "/image.jpg" }
  ]
}
```

### GET /api/meta
Get API metadata.

**Response:**
```json
{
  "graphVersion": "v20250205",
  "apiVersion": "1.0.0"
}
```

## Scheduled Tasks

A daily cron job runs at 5 AM UTC to pre-compute:
- Today's puzzle (stored in KV)
- Reveal data with optimal paths (stored in KV)

Configure in wrangler.toml:
```toml
[triggers]
crons = ["0 5 * * *"]
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| GRAPH_VERSION | Version string for graph data (e.g., "v20250205") |
| GRAPH_BUCKET | R2 bucket binding for graph data |
| PUZZLE_KV | KV namespace binding for puzzle storage |

## Graph Data Format

### Neighbor Files (`/neighbors/{actorId}.json`)
```json
{
  "actorId": 287,
  "neighbors": [
    {
      "actorId": 1136406,
      "movies": [
        {
          "id": 12345,
          "title": "Movie Title",
          "poster": "/poster.jpg",
          "pop": 42.5
        }
      ]
    }
  ]
}
```

### Actor Metadata (`/metadata/actors.json`)
```json
{
  "287": {
    "id": 287,
    "name": "Brad Pitt",
    "image": "/image.jpg",
    "pool": true
  }
}
```

### Starting Pool (`/metadata/starting_pool.json`)
```json
{
  "actors": [287, 500, 1136406]
}
```
