# CineLinks Hybrid Architecture Deployment Guide

This guide covers deploying the CineLinks game using the hybrid architecture:
- **Frontend**: Cloudflare Pages (static React app)
- **Edge API**: Cloudflare Workers
- **Data Storage**: Cloudflare R2 (graph) + KV (puzzles)

## Prerequisites

1. **Cloudflare Account** with access to Workers, Pages, R2, and KV
2. **Node.js** 18+ installed
3. **Python** 3.10+ with backend venv set up
4. **Wrangler CLI**: `npm install -g wrangler`

## Step 1: Generate Edge Data

First, ensure you have a built graph, then export it for edge delivery:

```bash
# Activate backend venv
cd backend
.\venv\Scripts\Activate.ps1  # Windows
# source venv/bin/activate   # Unix

# Export graph to edge format
cd ../build
python export_graph_for_edge.py

# This creates:
# - build/edge_export/neighbors/{actorId}.json (one per actor)
# - build/edge_export/metadata/actors.json
# - build/edge_export/metadata/movies.json
# - build/edge_export/metadata/starting_pool.json
# - build/edge_export/metadata/graph_meta.json
```

## Step 2: Set Up Cloudflare Resources

### Login to Cloudflare
```bash
wrangler login
```

### Create R2 Bucket
```bash
wrangler r2 bucket create cinelinks-graph
```

### Create KV Namespace
```bash
wrangler kv:namespace create PUZZLE_KV
# Note the ID returned - you'll need it for wrangler.toml
```

### Update workers/wrangler.toml
Replace the KV namespace ID placeholder:
```toml
[[kv_namespaces]]
binding = "PUZZLE_KV"
id = "your-actual-kv-namespace-id"
```

## Step 3: Upload Graph Data to R2

```bash
# Windows
.\scripts\upload-graph-to-r2.ps1 -GraphVersion "v20250205"

# Unix/Mac
./scripts/upload-graph-to-r2.sh v20250205
```

This uploads all neighbor and metadata files to R2 under `graph/v20250205/`.

## Step 4: Deploy Edge API (Cloudflare Workers)

```bash
cd workers

# Install dependencies
npm install

# Deploy
npm run deploy
```

Note the URL returned (e.g., `https://cinelinks-api.your-subdomain.workers.dev`)

## Step 5: Configure Frontend

Update `frontend/.env` for production:
```bash
VITE_API_URL=https://cinelinks-api.your-subdomain.workers.dev
VITE_USE_EDGE_API=true
```

## Step 6: Deploy Frontend (Cloudflare Pages)

### Option A: Direct Upload
```bash
cd frontend

# Build
npm run build

# Deploy to Pages
wrangler pages deploy dist --project-name=cinelinks
```

### Option B: GitHub Integration
1. Go to Cloudflare Dashboard > Pages
2. Create a new project connected to your GitHub repo
3. Configure build settings:
   - Build command: `cd frontend && npm install && npm run build`
   - Build output directory: `frontend/dist`
4. Add environment variables:
   - `VITE_API_URL`: Your Workers URL
   - `VITE_USE_EDGE_API`: `true`

## Step 7: Verify Deployment

### Test Edge API
```bash
# Health check
curl https://cinelinks-api.your-subdomain.workers.dev/health

# Get today's puzzle
curl https://cinelinks-api.your-subdomain.workers.dev/api/puzzle/today

# Get actor neighbors
curl https://cinelinks-api.your-subdomain.workers.dev/api/actors/287/neighbors
```

### Test Frontend
Visit your Pages URL (e.g., `https://cinelinks.pages.dev`)

## Updating the Graph

When you need to update the actor graph:

1. Rebuild the graph:
   ```bash
   cd build
   python build_actor_actor_graph.py --out ../backend/global_actor_actor_graph.gpickle
   ```

2. Export for edge:
   ```bash
   python export_graph_for_edge.py
   ```

3. Upload new version to R2:
   ```bash
   .\scripts\upload-graph-to-r2.ps1 -GraphVersion "v$(Get-Date -Format 'yyyyMMdd')"
   ```

4. Update `GRAPH_VERSION` in `workers/wrangler.toml`

5. Redeploy workers:
   ```bash
   cd workers && npm run deploy
   ```

## Environment Variables Reference

### Workers (wrangler.toml)
| Variable | Description | Example |
|----------|-------------|---------|
| GRAPH_VERSION | Graph data version | "v20250205" |

### Frontend (.env)
| Variable | Description | Example |
|----------|-------------|---------|
| VITE_API_URL | Edge API URL | "https://cinelinks-api.workers.dev" |
| VITE_USE_EDGE_API | Enable edge mode | "true" |

## Troubleshooting

### "Graph data not found" errors
- Verify R2 upload completed successfully
- Check GRAPH_VERSION in wrangler.toml matches uploaded version
- Verify R2 bucket binding name matches in code

### "KV namespace not found" errors
- Verify KV namespace ID in wrangler.toml
- Ensure namespace was created in same Cloudflare account

### CORS errors
- Check Workers CORS headers in `src/index.ts`
- Verify frontend is calling correct API URL

### Daily puzzle not updating
- Check cron trigger is configured in wrangler.toml
- View Workers logs: `wrangler tail`
- Manually trigger: call `/api/puzzle/today` to generate

## Cost Estimates

Cloudflare has generous free tiers:
- **Workers**: 100,000 requests/day free
- **R2**: 10GB storage free, 10M reads/month free
- **KV**: 100,000 reads/day free
- **Pages**: Unlimited static requests

For a game with moderate traffic, this should remain well within free tier limits.
