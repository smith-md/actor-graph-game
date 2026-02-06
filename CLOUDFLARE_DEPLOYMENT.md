# CineLinks Cloudflare Deployment Guide

This guide covers deploying CineLinks to Cloudflare using:
- **Cloudflare Pages** - Frontend (React app)
- **Cloudflare Workers** - Backend API (Edge-optimized)
- **Cloudflare R2** - Graph data storage
- **Cloudflare KV** - Daily puzzle persistence

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         Cloudflare Edge                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────┐         ┌───────────────────────────┐   │
│  │  Cloudflare Pages │         │    Cloudflare Workers     │   │
│  │    (Frontend)     │────────▶│      (Edge API)           │   │
│  │                   │         │                           │   │
│  │  cinelinks.app    │         │  api.cinelinks.app        │   │
│  └───────────────────┘         └───────────┬───────────────┘   │
│                                            │                    │
│                                ┌───────────┴───────────┐       │
│                                │                       │       │
│                         ┌──────▼──────┐        ┌───────▼─────┐ │
│                         │     R2      │        │     KV      │ │
│                         │  (Graph)    │        │  (Puzzles)  │ │
│                         └─────────────┘        └─────────────┘ │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Prerequisites

1. **Cloudflare Account** with access to Workers, Pages, R2, and KV
2. **Node.js** 18+ installed
3. **Python** 3.10+ with backend venv set up (for graph export)
4. **Wrangler CLI** installed globally:
   ```bash
   npm install -g wrangler
   ```
5. **Logged in to Cloudflare**:
   ```bash
   wrangler login
   ```

---

## Step 1: Create Cloudflare Resources

### 1.1 Create R2 Bucket

```bash
wrangler r2 bucket create cinelinks-graph
```

### 1.2 Create KV Namespace

```bash
# Create production namespace
wrangler kv:namespace create PUZZLE_KV

# Note the output ID, e.g.:
# { binding = "PUZZLE_KV", id = "abc123..." }

# Create preview namespace for local dev
wrangler kv:namespace create PUZZLE_KV --preview

# Note the preview_id
```

### 1.3 Update wrangler.toml

Edit `workers/wrangler.toml` with your actual KV namespace IDs:

```toml
[[kv_namespaces]]
binding = "PUZZLE_KV"
id = "YOUR_PRODUCTION_KV_ID"
preview_id = "YOUR_PREVIEW_KV_ID"
```

---

## Step 2: Export and Upload Graph Data

### 2.1 Export Graph for Edge

The graph needs to be converted from NetworkX pickle format to per-actor JSON files.

```bash
# Activate backend venv
cd backend
.\venv\Scripts\Activate.ps1   # Windows
# source venv/bin/activate    # Unix/Mac

# Export graph (creates build/edge_data/)
cd ../build
python export_graph_for_edge.py --graph ../backend/global_actor_actor_graph.gpickle --out ./edge_data --no-compress
```

**Note**: Use `--no-compress` since R2 handles compression automatically.

### 2.2 Upload to R2

```powershell
# Windows (PowerShell)
cd ..
.\scripts\upload-graph-to-r2.ps1
```

```bash
# Unix/Mac
./scripts/upload-graph-to-r2.sh
```

The script will output a version string like `v20260206`. Note this for the next step.

### 2.3 Update Graph Version

Edit `workers/wrangler.toml`:

```toml
[vars]
GRAPH_VERSION = "v20260206"  # Match your upload version
```

---

## Step 3: Deploy Workers API

### 3.1 Install Dependencies

```bash
cd workers
npm install
```

### 3.2 Test Locally

```bash
npm run dev
# API available at http://localhost:8787
```

Test endpoints:
```bash
curl http://localhost:8787/health
curl http://localhost:8787/api/metadata
```

### 3.3 Deploy to Production

```bash
npm run deploy
```

Note the deployed URL (e.g., `https://cinelinks-api.YOUR_SUBDOMAIN.workers.dev`).

---

## Step 4: Deploy Frontend to Cloudflare Pages

### 4.1 Option A: GitHub Integration (Recommended)

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) > **Pages**
2. Click **Create a project** > **Connect to Git**
3. Select your repository
4. Configure build settings:
   - **Project name**: `cinelinks`
   - **Production branch**: `main`
   - **Framework preset**: `Vite`
   - **Build command**: `npm run build`
   - **Build output directory**: `frontend/dist`
   - **Root directory**: `frontend`

5. Add environment variable:
   - **Variable name**: `VITE_API_URL`
   - **Value**: `https://cinelinks-api.YOUR_SUBDOMAIN.workers.dev`

6. Click **Save and Deploy**

### 4.2 Option B: Direct Upload

```bash
cd frontend
npm install
npm run build

# Deploy using wrangler
npx wrangler pages deploy dist --project-name=cinelinks
```

---

## Step 5: Configure Custom Domain (Optional)

### 5.1 Frontend Domain

1. Go to **Pages** > **cinelinks** > **Custom domains**
2. Add your domain (e.g., `cinelinks.app`)
3. Follow DNS configuration instructions

### 5.2 API Domain

1. Go to **Workers & Pages** > **cinelinks-api** > **Triggers**
2. Add custom route (e.g., `api.cinelinks.app/*`)
3. Configure DNS:
   ```
   Type: CNAME
   Name: api
   Target: cinelinks-api.YOUR_SUBDOMAIN.workers.dev
   Proxy: ON (orange cloud)
   ```

### 5.3 Update Frontend Environment

Update Pages environment variable:
- `VITE_API_URL` = `https://api.cinelinks.app`

---

## Step 6: Initialize Daily Puzzle

The Workers cron job generates daily puzzles at 5 AM UTC. To initialize immediately:

### Option A: Manual Trigger via Dashboard

1. Go to **Workers & Pages** > **cinelinks-api**
2. Click **Triggers** tab
3. Find the cron trigger and click **Trigger now**

### Option B: Call the Scheduled Handler

```bash
# Trigger via wrangler
wrangler dev --test-scheduled
```

---

## Environment Variables Reference

### Workers (wrangler.toml)

| Variable | Description | Example |
|----------|-------------|---------|
| `GRAPH_VERSION` | Version of uploaded graph data | `v20260206` |
| `TMDB_IMAGE_BASE` | TMDb image URL base | `https://image.tmdb.org/t/p` |

### Pages (Environment Variables)

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_API_URL` | Workers API URL | `https://api.cinelinks.app` |

---

## Updating the Graph

When you need to update the actor/movie graph:

1. **Rebuild the graph** (if source data changed):
   ```bash
   cd build
   python build_actor_actor_graph.py --out ../backend/global_actor_actor_graph.gpickle
   ```

2. **Export for edge**:
   ```bash
   python export_graph_for_edge.py --out ./edge_data --no-compress
   ```

3. **Upload to R2** with new version:
   ```powershell
   .\scripts\upload-graph-to-r2.ps1 -GraphVersion "v20260207"
   ```

4. **Update wrangler.toml** with new version:
   ```toml
   GRAPH_VERSION = "v20260207"
   ```

5. **Redeploy workers**:
   ```bash
   cd workers
   npm run deploy
   ```

---

## Monitoring & Debugging

### View Worker Logs

```bash
cd workers
npm run tail
```

### Check R2 Contents

```bash
wrangler r2 object list cinelinks-graph --prefix "graph/v20260206/"
```

### Test API Endpoints

```bash
# Health check
curl https://api.cinelinks.app/health

# Get today's puzzle
curl https://api.cinelinks.app/api/puzzle/today

# Get actor neighbors
curl https://api.cinelinks.app/api/actors/287/neighbors

# Get metadata
curl https://api.cinelinks.app/api/metadata
```

---

## Cost Estimates

Cloudflare offers generous free tiers:

| Service | Free Tier | Notes |
|---------|-----------|-------|
| Workers | 100K requests/day | Resets daily |
| Pages | Unlimited static requests | No bandwidth limits |
| R2 | 10GB storage, 1M Class A ops | Graph data ~50-100MB |
| KV | 100K reads/day, 1K writes/day | Puzzle storage minimal |

For most hobby/small-scale deployments, the free tier is sufficient.

---

## Troubleshooting

### "Graph version not found"

- Ensure R2 upload completed successfully
- Verify `GRAPH_VERSION` in wrangler.toml matches uploaded version
- Check R2 bucket contents: `wrangler r2 object list cinelinks-graph`

### "CORS errors in browser"

- Workers include CORS headers by default
- Ensure frontend is calling the correct API URL
- Check browser console for the actual error

### "Daily puzzle not generating"

- Verify cron trigger is configured in wrangler.toml
- Check Worker logs for errors: `npm run tail`
- Manually trigger to test: Dashboard > Workers > Triggers > Trigger now

### "KV namespace not found"

- Ensure KV namespaces are created
- Verify IDs in wrangler.toml match dashboard
- Use `wrangler kv:namespace list` to see available namespaces

---

## Quick Reference

```bash
# === One-time Setup ===
wrangler login
wrangler r2 bucket create cinelinks-graph
wrangler kv:namespace create PUZZLE_KV

# === Deploy Workers ===
cd workers
npm install
npm run deploy

# === Deploy Frontend ===
cd frontend
npm install
npm run build
npx wrangler pages deploy dist --project-name=cinelinks

# === Update Graph ===
cd build
python export_graph_for_edge.py --out ./edge_data --no-compress
cd ..
.\scripts\upload-graph-to-r2.ps1 -GraphVersion "vYYYYMMDD"
# Update GRAPH_VERSION in workers/wrangler.toml
cd workers && npm run deploy
```
