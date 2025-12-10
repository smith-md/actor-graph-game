# Installation Guide

Complete installation instructions for CineLinks.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Project Setup](#project-setup)
- [Building the Graph](#building-the-graph)
- [Backend Setup](#backend-setup)
- [Frontend Setup](#frontend-setup)
- [Verification](#verification)
- [Production Deployment](#production-deployment)

---

## Prerequisites

### Required Software

- **Python 3.9 or higher** ([Download](https://www.python.org/downloads/))
- **Node.js 18 or higher** ([Download](https://nodejs.org/))
- **Git** ([Download](https://git-scm.com/))

### TMDb API Key

1. Create a free account at [TMDb](https://www.themoviedb.org/)
2. Go to [API Settings](https://www.themoviedb.org/settings/api)
3. Request an API key (choose "Developer" option)
4. Copy your API key for later use

### System Requirements

- **Disk Space**: ~500 MB for dependencies + graph data
- **Memory**: 2 GB RAM minimum (4 GB recommended)
- **Network**: Internet connection for initial data fetch

---

## Project Setup

### 1. Clone or Create Project Directory

```bash
mkdir cinelinks
cd cinelinks
```

### 2. Create Directory Structure

```bash
mkdir -p build backend frontend/src docs
```

Your structure should look like:

```
cinelinks/
├── build/
├── backend/
├── frontend/
│   └── src/
└── docs/
```

### 3. Add Project Files

Copy all the provided files into their respective directories:

- `build/` - Graph builder scripts
- `backend/` - API server files
- `frontend/` - React application
- `docs/` - Documentation files

---

## Building the Graph

The graph builder fetches data from TMDb and creates the actor-movie connection graph.

### Step 1: Setup Build Environment

#### Windows PowerShell

```powershell
cd build
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements-build.txt
```

#### macOS/Linux

```bash
cd build
python3 -m venv venv
source venv/bin/activate
pip install -r requirements-build.txt
```

### Step 2: Configure TMDb API Key

Create `.env` file in the `build/` directory:

```bash
# Windows PowerShell
echo "TMDB_API_KEY=your_api_key_here" | Out-File -Encoding ASCII .env

# macOS/Linux
echo "TMDB_API_KEY=your_api_key_here" > .env
```

Replace `your_api_key_here` with your actual TMDb API key.

### Step 3: Build the Graph

**Basic build (recommended for first time):**

```bash
python build_actor_movie_graph.py --out ../backend/global_actor_movie_graph.gpickle --top 150
```

This will:
- Fetch ~1000 popular actors from TMDb
- Select top 150 ranked actors
- Get their movie credits
- Build a graph with ~2,700 movies
- Save to `backend/global_actor_movie_graph.gpickle`
- Take approximately 8-10 minutes

**Expected Output:**

```
[CineLinks] Selecting actors: top=150, min_movie_credits=5
[CineLinks] Selected 150 ranked actors.
[CineLinks] Building graph (min-per-movie=2) ...
[CineLinks] Graph nodes=2847 edges=8432.
[CineLinks] Saved graph to: ../backend/global_actor_movie_graph.gpickle
[CineLinks] Actors=150 Movies=2697
Done.
```

### Step 4: Verify the Graph

```bash
python verify_graph.py ../backend/global_actor_movie_graph.gpickle
```

**Expected Output:**

```
✅ Graph loaded successfully
Actors: 150 | Movies: 2697 | Edges: 8432
Sample actors: ['Tom Hanks', 'Leonardo DiCaprio', 'Brad Pitt', ...]
Sample movies: ['Inception', 'The Avengers', 'Titanic', ...]
SHA256: abc123def456...
```

### Build Options

| Option | Description | Default |
|--------|-------------|---------|
| `--out PATH` | Output file path | `../backend/global_actor_movie_graph.gpickle` |
| `--top N` | Number of actors to include | `150` |
| `--min-per-movie N` | Min actors per movie | `2` |
| `--min-movie-credits N` | Min credits per actor | `5` |
| `--force-refresh` | Ignore cache, refetch all | `False` |

### Graph Size Recommendations

| `--top` | Actors | Movies | Edges | Size | Build Time |
|---------|--------|--------|-------|------|------------|
| 100     | 100    | ~1,800 | ~5,500 | ~3 MB | ~5 min |
| **150** | **150** | **~2,700** | **~8,500** | **~5 MB** | **~8 min** |
| 200     | 200    | ~3,500 | ~11,000 | ~7 MB | ~12 min |

**Recommendation**: Start with `--top 150` for a good balance.

### Troubleshooting Build

**Rate Limiting:**
If you see 429 errors, TMDb is rate limiting you:
- Wait a few minutes and retry
- The script caches data, so subsequent runs are faster
- Increase `SLEEP_BETWEEN_CALLS` in `build_actor_movie_graph.py`

**Out of Memory:**
- Reduce `--top` to 100 or lower
- Close other applications
- Try on a machine with more RAM

**Build Interrupted:**
- Delete the incomplete `.gpickle` file
- Run the build command again
- Cached data will speed up the retry

---

## Backend Setup

### Step 1: Create Virtual Environment

#### Windows PowerShell

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

#### macOS/Linux

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Step 2: Verify Graph File

Ensure `global_actor_movie_graph.gpickle` exists in the `backend/` directory:

```bash
ls global_actor_movie_graph.gpickle  # Should exist
```

If missing, go back to [Building the Graph](#building-the-graph).

### Step 3: Optional - Configure Environment

Create `.env` in `backend/` directory (optional):

```bash
CINELINKS_GRAPH_PATH=global_actor_movie_graph.gpickle
```

### Step 4: Start the Backend Server

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Expected Output:**

```
INFO:     Will watch for changes in these directories: ['/path/to/backend']
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
INFO:     Started reloader process [12345] using StatReload
[CineLinks] Loaded graph: global_actor_movie_graph.gpickle
[CineLinks] Nodes=2847 | Edges=8432
INFO:     Application startup complete.
```

### Step 5: Test the Backend

Open a browser and visit:
- **Health Check**: http://localhost:8000/health
- **API Docs**: http://localhost:8000/docs
- **Meta Info**: http://localhost:8000/meta

You should see JSON responses.

### Production Backend Options

For production deployment:

```bash
# Remove --reload for production
uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4

# Or use gunicorn
gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

---

## Frontend Setup

### Step 1: Install Dependencies

```bash
cd frontend
npm install
```

This installs React, Vite, Tailwind CSS, and other dependencies.

### Step 2: Configure API URL

Create `.env` file in `frontend/` directory:

```bash
# Windows PowerShell
echo "VITE_API_URL=http://localhost:8000" | Out-File -Encoding ASCII .env

# macOS/Linux
echo "VITE_API_URL=http://localhost:8000" > .env
```

**For production**, change to your production API URL:

```env
VITE_API_URL=https://api.yourdomain.com
```

### Step 3: Start Development Server

```bash
npm run dev
```

**Expected Output:**

```
  VITE v5.x.x  ready in 500 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

### Step 4: Test the Frontend

1. Open http://localhost:5173 in your browser
2. You should see the CineLinks game interface
3. Click "Start New Game" to test

### Production Build

To build for production:

```bash
npm run build
```

This creates an optimized build in `frontend/dist/`:

```
dist/
├── index.html
├── assets/
│   ├── index-abc123.js
│   └── index-def456.css
└── ...
```

Deploy the `dist/` directory to your web host.

### Preview Production Build

```bash
npm run preview
```

This serves the production build locally at http://localhost:4173.

---

## Verification

### Complete System Test

With backend and frontend running, test the full flow:

1. **Health Check**: Visit http://localhost:8000/health
   - Should return `{"ok": true, "ready": true}`

2. **Frontend Load**: Visit http://localhost:5173
   - Should show "✓ Ready to play!"

3. **Start Game**: Click "Start New Game"
   - Should show two actors

4. **Autocomplete**: Type in the movie field
   - Should show movie suggestions

5. **Make a Guess**: Enter a valid movie and actor
   - Should show success or error message

6. **View Graph**: After a valid guess
   - Should show the connection path visualization

### Troubleshooting Checklist

- [ ] Backend is running on port 8000
- [ ] Frontend is running on port 5173
- [ ] `.gpickle` file exists in `backend/`
- [ ] `VITE_API_URL` is set correctly in frontend `.env`
- [ ] No CORS errors in browser console
- [ ] Backend shows "Graph loaded" message

---

## Production Deployment

### Backend Deployment

**Option 1: Docker**

```dockerfile
FROM python:3.9-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Option 2: Traditional Server**

```bash
# Install dependencies
pip install -r requirements.txt

# Run with systemd or supervisor
gunicorn main:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

**Environment Variables:**

```bash
export CINELINKS_GRAPH_PATH=/app/global_actor_movie_graph.gpickle
```

### Frontend Deployment

**Option 1: Static Hosting (Netlify, Vercel)**

1. Build: `npm run build`
2. Upload `dist/` folder
3. Set environment variable: `VITE_API_URL=https://your-api.com`

**Option 2: Traditional Web Server**

```bash
# Build
npm run build

# Copy dist/ to web server
scp -r dist/* user@server:/var/www/html/

# Configure nginx
server {
    listen 80;
    root /var/www/html;
    index index.html;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### Security Considerations

1. **CORS**: Update `allow_origins` in `backend/main.py`:
   ```python
   allow_origins=["https://yourdomain.com"]  # Not ["*"]
   ```

2. **API Keys**: Never commit `.env` files
   - Use environment variables in production
   - Keep TMDb API key secure

3. **Rate Limiting**: Add rate limiting middleware if needed

4. **HTTPS**: Always use HTTPS in production
   - Use Let's Encrypt for free SSL certificates

### Monitoring

Add health check monitoring:

```bash
# Check every minute
* * * * * curl -f http://localhost:8000/health || alert
```

Monitor key metrics:
- API response times
- Graph load time
- Game session counts
- Error rates

---

## Next Steps

✅ **Installation complete!**

- Read [GAME_RULES.md](GAME_RULES.md) to learn how to play
- Check [API.md](API.md) for API documentation
- See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) if you have issues

**Start playing**: http://localhost:5173

Enjoy CineLinks! 🎬✨