# Troubleshooting Guide

Solutions to common CineLinks problems.

## Table of Contents

- [Quick Diagnostics](#quick-diagnostics)
- [Graph Issues](#graph-issues)
- [Backend Issues](#backend-issues)
- [Frontend Issues](#frontend-issues)
- [Build Issues](#build-issues)
- [Performance Issues](#performance-issues)
- [Data Issues](#data-issues)

---

## Quick Diagnostics

Run these checks first to identify the problem:

### 1. Check Backend Health

```bash
curl http://localhost:8000/health
```

**Expected:**
```json
{"ok": true, "ready": true, "service": "CineLinks API"}
```

**If `ready: false`:** See [Graph Issues](#graph-issues)

### 2. Check Graph Meta

```bash
curl http://localhost:8000/meta
```

**Expected:**
```json
{"ready": true, "actors": 150, "movies": 2697, "edges": 8432, "checksum": "..."}
```

### 3. Check Backend Logs

Look for errors in the terminal where backend is running:

```
[CineLinks] Loaded graph: global_actor_movie_graph.gpickle
[CineLinks] Nodes=2847 | Edges=8432
```

### 4. Check Frontend Console

Open browser DevTools (F12) and look for errors in Console tab.

### 5. Check Network Tab

In browser DevTools Network tab, verify API calls are succeeding (200 status).

---

## Graph Issues

### "Graph not ready" Error

**Symptoms:**
- Frontend shows "⚠️ Graph loading... please wait"
- Health check returns `"ready": false`
- Backend logs show graph errors

**Causes & Solutions:**

#### 1. Graph File Missing

**Check:**
```bash
ls backend/global_actor_movie_graph.gpickle
```

**Solution:**
```bash
cd build
python build_actor_movie_graph.py --out ../backend/global_actor_movie_graph.gpickle --top 150
```

#### 2. Graph File Corrupted

**Verify:**
```bash
cd build
python verify_graph.py ../backend/global_actor_movie_graph.gpickle
```

**If verification fails:**
```bash
# Delete corrupted file
rm ../backend/global_actor_movie_graph.gpickle

# Rebuild
python build_actor_movie_graph.py --out ../backend/global_actor_movie_graph.gpickle --top 150
```

#### 3. Wrong Path Configuration

**Check backend logs for:**
```
Graph file not found at {path}
```

**Solution:** Set correct path in backend `.env`:
```bash
echo "CINELINKS_GRAPH_PATH=global_actor_movie_graph.gpickle" > backend/.env
```

#### 4. Permission Issues

**Linux/Mac:**
```bash
chmod 644 backend/global_actor_movie_graph.gpickle
```

**Windows:** Right-click → Properties → Security → Ensure read permissions

### Graph Too Small

**Symptoms:**
- "Failed to find a valid actor pair" error when starting game
- Very few autocomplete suggestions

**Check:**
```bash
curl http://localhost:8000/meta
```

**If actors < 50 or edges < 1000:**

**Solution:** Rebuild with more actors:
```bash
cd build
python build_actor_movie_graph.py --out ../backend/global_actor_movie_graph.gpickle --top 200
```

### Graph Loading Slow

**Symptoms:**
- Backend takes 30+ seconds to start
- Large graph file (>20 MB)

**Solutions:**

1. **Reduce graph size:**
```bash
python build_actor_movie_graph.py --top 100  # Smaller graph
```

2. **Use SSD:** Move project to SSD if on HDD

3. **Check system resources:** Close other applications

---

## Backend Issues

### Backend Won't Start

**Symptoms:**
- `uvicorn` command fails
- Port already in use error
- Module not found errors

#### Port Already in Use

**Error:**
```
Error: [Errno 48] Address already in use
```

**Solution:**
```bash
# Find process using port 8000
lsof -i :8000  # Mac/Linux
netstat -ano | findstr :8000  # Windows

# Kill the process or use different port
uvicorn main:app --port 8001
```

#### Module Not Found

**Error:**
```
ModuleNotFoundError: No module named 'fastapi'
```

**Solution:**
```bash
# Activate virtual environment
source venv/bin/activate  # Mac/Linux
.\venv\Scripts\Activate.ps1  # Windows

# Reinstall dependencies
pip install -r requirements.txt
```

#### Python Version Too Old

**Error:**
```
SyntaxError: invalid syntax
```

**Check version:**
```bash
python --version  # Should be 3.9+
```

**Solution:** Install Python 3.9+ from [python.org](https://www.python.org/)

### Backend Crashes on Request

**Symptoms:**
- Backend exits with error on API call
- "Internal Server Error" responses

**Solutions:**

1. **Check backend logs** for full error traceback

2. **Memory issues:**
```bash
# Restart backend
# Check system memory: top (Linux/Mac) or Task Manager (Windows)
```

3. **Graph corruption:**
```bash
python build/verify_graph.py backend/global_actor_movie_graph.gpickle
```

4. **Restart with debug logging:**
```bash
uvicorn main:app --reload --log-level debug
```

### Slow API Responses

**Symptoms:**
- Autocomplete takes >2 seconds
- Game start takes >5 seconds

**Solutions:**

1. **Check graph size:**
```bash
ls -lh backend/global_actor_movie_graph.gpickle
```
If >10 MB, consider smaller graph.

2. **Check CPU usage:** Close other applications

3. **Use production mode:**
```bash
uvicorn main:app --workers 4  # No --reload
```

---

## Frontend Issues

### Frontend Won't Start

**Symptoms:**
- `npm run dev` fails
- Port conflicts
- Module errors

#### Port Already in Use

**Error:**
```
Port 5173 is in use
```

**Solution:**
```bash
# Kill process or Vite will auto-assign new port
# Or specify port manually:
npm run dev -- --port 3000
```

#### Module Not Found

**Error:**
```
Error: Cannot find module 'react'
```

**Solution:**
```bash
rm -rf node_modules package-lock.json
npm install
```

#### Node Version Too Old

**Check version:**
```bash
node --version  # Should be 18+
```

**Solution:** Install Node 18+ from [nodejs.org](https://nodejs.org/)

### Blank White Screen

**Symptoms:**
- Frontend loads but shows white screen
- No errors in console

**Solutions:**

1. **Check browser console** (F12) for JavaScript errors

2. **Check API connection:**
```javascript
// In browser console:
fetch('http://localhost:8000/health').then(r => r.json()).then(console.log)
```

3. **Verify .env file:**
```bash
cat frontend/.env
# Should show: VITE_API_URL=http://localhost:8000
```

4. **Hard refresh:** Ctrl+Shift+R (Cmd+Shift+R on Mac)

5. **Clear browser cache**

### No Autocomplete Suggestions

**Symptoms:**
- Typing in input fields shows no dropdown
- Autocomplete seems broken

**Solutions:**

1. **Check Network tab** (F12 → Network):
   - Look for calls to `/autocomplete/actors` and `/autocomplete/movies`
   - Should return 200 status

2. **Check backend is running:**
```bash
curl http://localhost:8000/health
```

3. **Type more characters:** Need at least 1-2 characters

4. **Check CORS:** Browser console should not show CORS errors

5. **Verify API URL in `.env`:**
```bash
cat frontend/.env
# Ensure VITE_API_URL matches backend URL
```

### Images Not Loading

**Symptoms:**
- Actor photos show broken image icons
- Movie posters don't display

**Causes & Solutions:**

1. **TMDb CDN issue:** Temporary - images will return

2. **No image in database:** Some actors/movies lack images (normal)

3. **HTTPS/HTTP mixed content:** 
   - If frontend is HTTPS, backend must be HTTPS too
   - Or use relative URLs

4. **Check image URLs in Network tab**

### CORS Errors

**Symptoms:**
- Console shows "CORS policy blocked"
- API calls fail with CORS error

**Error:**
```
Access to fetch at 'http://localhost:8000/...' from origin 'http://localhost:5173' 
has been blocked by CORS policy
```

**Solutions:**

1. **Backend should allow frontend origin** (already configured):
```python
# In backend/main.py:
allow_origins=["*"]  # Should be present
```

2. **Use correct API URL:** Check `VITE_API_URL` in frontend `.env`

3. **Clear browser cache:** Ctrl+Shift+Delete

4. **Try different browser:** Rule out browser-specific issues

---

## Build Issues

### TMDb API Key Invalid

**Error:**
```
401 Unauthorized
Invalid API key
```

**Solutions:**

1. **Check API key in `.env`:**
```bash
cat build/.env
```

2. **Verify key on TMDb:**
   - Go to https://www.themoviedb.org/settings/api
   - Check if key is active

3. **Check for whitespace:**
```bash
# Should be: TMDB_API_KEY=abc123
# NOT: TMDB_API_KEY= abc123 (no spaces)
```

### Rate Limiting (429 Errors)

**Error:**
```
429 Too Many Requests
```

**Solutions:**

1. **Wait 10 minutes** before retrying

2. **Use cached data:**
```bash
# Don't use --force-refresh
python build_actor_movie_graph.py --out ../backend/global_actor_movie_graph.gpickle --top 150
```

3. **Increase delay in script:**
Edit `build_actor_movie_graph.py`:
```python
SLEEP_BETWEEN_CALLS = 0.5  # Increase from 0.25
```

### Build Takes Forever

**Symptoms:**
- Build running for 30+ minutes
- Appears stuck

**Solutions:**

1. **Check internet connection**

2. **Reduce actor count:**
```bash
python build_actor_movie_graph.py --top 100
```

3. **Check build progress:** Look for incrementing page numbers in output

4. **Use cached data:** Second builds are much faster (5-10x)

### Out of Memory During Build

**Error:**
```
MemoryError
```

**Solutions:**

1. **Close other applications**

2. **Reduce actor count:**
```bash
python build_actor_movie_graph.py --top 75
```

3. **Increase system swap/pagefile**

4. **Use machine with more RAM**

---

## Performance Issues

### Slow Autocomplete

**Symptoms:**
- Dropdown takes 1-2 seconds to appear
- Laggy typing

**Solutions:**

1. **Check graph size:** Smaller graphs are faster

2. **Check backend CPU usage:** Should be <30% when idle

3. **Add debouncing:** Already implemented (150ms delay)

4. **Use production build:**
```bash
cd frontend
npm run build
npm run preview  # Faster than dev mode
```

### Slow Game Start

**Symptoms:**
- "Start New Game" takes 5+ seconds

**Cause:** Finding actors without direct connections takes time

**Solutions:**

1. **Larger graph helps:** More paths available

2. **Restart backend:** Fresh state may help

3. **Check backend logs:** Look for retry attempts

### High Memory Usage

**Backend Memory Issues:**

```bash
# Check backend memory
ps aux | grep uvicorn  # Linux/Mac
```

**If >500 MB:**
- Graph might be too large
- Restart backend periodically
- Consider reducing graph size

**Frontend Memory Issues:**

- Clear browser cache
- Close unused tabs
- Restart browser

---

## Data Issues

### Actor Not Found

**Symptoms:**
- Know an actor but they're not in autocomplete
- Game says actor doesn't exist

**Explanation:**
- Only ~150 actors are in the graph
- Focus on popular, well-known actors
- Not all actors from TMDb are included

**Solution:**
- Use actors that appear in autocomplete
- Rebuild graph with more actors (`--top 200`)

### Movie Not Found

**Symptoms:**
- Know a movie exists but can't find it
- Autocomplete doesn't show the movie

**Explanation:**
- Only movies with 2+ graph actors are included
- Some movies may not meet the criteria
- Total of ~2,700 movies in default graph

**Solution:**
- Try alternate movie titles
- Use movies from autocomplete
- Rebuild with lower `--min-per-movie` threshold

### "Actor Not in Movie" Error

**Symptoms:**
- You're certain actor was in movie
- Game says actor not found in that movie

**Possible Causes:**

1. **Different movie with same name:**
   - Check release year
   - Use autocomplete to verify

2. **Actor not in our database:**
   - Only ~150 actors included
   - Use autocomplete to find valid actors

3. **Cameo/uncredited role:**
   - TMDb may not list all cast
   - Major roles are more reliable

4. **Movie not in database:**
   - Must have 2+ graph actors
   - Niche movies may not qualify

**Solution:**
- Always use autocomplete to verify
- Stick to major roles in well-known films

---

## Still Having Issues?

### Collect Debug Information

1. **Backend logs:** Copy full output from terminal

2. **Frontend console:** Screenshot of browser console errors

3. **Network tab:** Screenshot of failed API calls

4. **System info:**
```bash
python --version
node --version
cat backend/global_actor_movie_graph.gpickle | wc -c  # File size
curl http://localhost:8000/meta  # Graph info
```

### Reset Everything

Last resort - fresh start:

```bash
# 1. Stop all servers (Ctrl+C)

# 2. Delete virtual environments
rm -rf build/venv backend/venv

# 3. Delete graph
rm backend/global_actor_movie_graph.gpickle

# 4. Delete node_modules
rm -rf frontend/node_modules

# 5. Follow installation guide from scratch
```

### Common Mistakes Checklist

- [ ] Backend is running on correct port
- [ ] Frontend `.env` has correct `VITE_API_URL`
- [ ] Graph file exists in `backend/`
- [ ] Virtual environments are activated
- [ ] Dependencies are installed
- [ ] No firewall blocking ports
- [ ] TMDb API key is valid
- [ ] Using correct Python version (3.9+)
- [ ] Using correct Node version (18+)

---

## Prevention Tips

### Before Each Session

1. Activate virtual environment
2. Check backend health endpoint
3. Verify graph file exists
4. Clear browser cache if needed

### During Development

1. Keep backend logs visible
2. Monitor browser console
3. Use autocomplete to verify data
4. Save `.env` files outside git

### Regular Maintenance

1. Rebuild graph monthly (TMDb data updates)
2. Clear TMDb cache periodically
3. Update dependencies (`pip install --upgrade`, `npm update`)
4. Monitor disk space (cache can grow)

---

## Getting Help

If none of these solutions work:

1. Double-check you followed [INSTALLATION.md](INSTALLATION.md) exactly
2. Review backend logs carefully
3. Try the "Reset Everything" procedure above
4. Check if problem is reproducible on different machine
5. Document exact steps to reproduce the issue

---

[Back to Main README](../README.md) | [Installation Guide](INSTALLATION.md)