# API Reference

Complete API documentation for the CineLinks backend.

## Base URL

```
http://localhost:8000
```

## Overview

The CineLinks API is built with FastAPI and provides endpoints for:
- Health checks and graph status
- Starting new games
- Submitting guesses
- Getting game state
- Autocomplete for actors and movies

---

## Authentication

No authentication required. All endpoints are public.

---

## Endpoints

### Health Check

Check if the API is running and the graph is loaded.

```http
GET /health
```

#### Response

```json
{
  "ok": true,
  "ready": true,
  "service": "CineLinks API"
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `ok` | boolean | Always `true` if API is responsive |
| `ready` | boolean | `true` if graph is loaded and ready |
| `service` | string | Service identifier |

#### Status Codes

- `200 OK` - API is running

---

### Meta Information

Get statistics about the loaded graph.

```http
GET /meta
```

#### Response

```json
{
  "ready": true,
  "actors": 9720,
  "playable_actors": 1000,
  "starting_pool_actors": 100,
  "movies": 1681,
  "edges": 71565,
  "checksum": "abc123def456..."
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `ready` | boolean | `true` if graph is loaded |
| `actors` | integer | Total number of actors in graph |
| `playable_actors` | integer | Number of actors in playable pool (centrality-filtered) |
| `starting_pool_actors` | integer | Number of actors in starting pool (StartActorScore-filtered) |
| `movies` | integer | Number of movies in comprehensive index |
| `edges` | integer | Number of actor-actor connections (shared movies) |
| `checksum` | string | SHA256 hash of graph structure |

#### Status Codes

- `200 OK` - Graph loaded successfully
- `503 Service Unavailable` - Graph not ready

---

### Start New Game

Initialize a new game session with two random actors.

```http
GET /start_game
```

#### Response

```json
{
  "game_id": "550e8400-e29b-41d4-a716-446655440000",
  "game_name": "CineLinks",
  "start_actor": {
    "name": "Tom Hanks",
    "image": "https://image.tmdb.org/t/p/w300/xndWFsBlClOJFRdhSt4NBwiPq2o.jpg"
  },
  "target_actor": {
    "name": "Scarlett Johansson",
    "image": "https://image.tmdb.org/t/p/w300/6NsMbJXRlDZuDzatN2akFdGuTvx.jpg"
  }
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `game_id` | string | UUID for this game session |
| `game_name` | string | Always "CineLinks" |
| `start_actor` | object | Starting actor information |
| `start_actor.name` | string | Actor's name |
| `start_actor.image` | string | URL to actor's photo (300px wide) |
| `target_actor` | object | Target actor information |
| `target_actor.name` | string | Actor's name |
| `target_actor.image` | string | URL to actor's photo (300px wide) |

#### Actor Selection

The API selects two actors from the **starting pool** (100 most recognizable actors):
- Both actors have high StartActorScore (prominent in high-visibility films)
- Have not worked together directly (no edge between them in graph)
- Ensures a path exists between them through the actor-actor graph
- Provides a challenging but solvable puzzle with recognizable names

#### Status Codes

- `200 OK` - Game created successfully
- `500 Internal Server Error` - Failed to find valid actor pair (rare)
- `503 Service Unavailable` - Graph not ready

---

### Submit Guess

Submit a movie and actor guess to progress the game.

```http
POST /guess
Content-Type: application/json
```

#### Request Body

```json
{
  "game_id": "550e8400-e29b-41d4-a716-446655440000",
  "movie_id": 24428,
  "actor": "Robert Downey Jr."
}
```

#### Request Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `game_id` | string | Yes | UUID from start_game |
| `movie_id` | integer | Yes | TMDb movie ID (from autocomplete) |
| `actor` | string | Yes | Actor name |

#### Response (Success)

```json
{
  "success": true,
  "message": "✅ Valid move to Robert Downey Jr.",
  "poster_url": "https://image.tmdb.org/t/p/w500/RYMX2wcKCBAr24UyPD7xwmjaTn.jpg",
  "graph_image_base64": "iVBORw0KGgoAAAANSUhEUgAAB...",
  "state": {
    "current_actor": "actor_3223",
    "target_actor": "actor_1245",
    "path": [
      "actor_31",
      "actor_3223"
    ],
    "movies_used": [
      {
        "id": 24428,
        "title": "The Avengers",
        "poster_path": "/RYMX2wcKCBAr24UyPD7xwmjaTn.jpg"
      }
    ],
    "completed": false,
    "total_guesses": 1,
    "incorrect_guesses": 0,
    "remaining_attempts": 3
  }
}
```

#### Response (Error)

```json
{
  "success": false,
  "message": "❌ \"Inception\" does not connect from Tom Hanks. Try a different movie.",
  "poster_url": null,
  "graph_image_base64": "iVBORw0KGgoAAAANSUhEUgAAB...",
  "state": {
    "current_actor": "actor_31",
    "target_actor": "actor_1245",
    "path": ["actor_31"],
    "movies_used": [],
    "completed": false,
    "total_guesses": 1,
    "incorrect_guesses": 1,
    "remaining_attempts": 2
  }
}
```

#### Response (Win)

```json
{
  "success": true,
  "message": "🎉 Connected to Scarlett Johansson — you win!",
  "poster_url": "https://image.tmdb.org/t/p/w500/...",
  "graph_image_base64": "iVBORw0KGgoAAAANSUhEUgAAB...",
  "state": {
    "current_actor": "actor_1245",
    "target_actor": "actor_1245",
    "path": [
      "actor_31",
      "actor_3223",
      "actor_1245"
    ],
    "movies_used": [
      {"id": 24428, "title": "The Avengers"},
      {"id": 10138, "title": "Iron Man 2"}
    ],
    "completed": true,
    "total_guesses": 2,
    "incorrect_guesses": 0,
    "remaining_attempts": 3
  }
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | `true` if guess was valid |
| `message` | string | Feedback message for the user |
| `poster_url` | string or null | Movie poster URL (500px) if found |
| `graph_image_base64` | string | Base64 PNG image of current path |
| `state` | object | Current game state |

#### State Object

| Field | Type | Description |
|-------|------|-------------|
| `current_actor` | string | Current actor node ID (format: `actor_{tmdb_id}`) |
| `target_actor` | string | Target actor node ID |
| `path` | array | List of actor node IDs in the path (actors only) |
| `movies_used` | array | List of movie objects used between actors |
| `completed` | boolean | `true` if game is over (win or lose) |
| `total_guesses` | integer | Total number of guesses made |
| `incorrect_guesses` | integer | Number of incorrect guesses |
| `remaining_attempts` | integer | Attempts left before game over |

#### Error Messages

| Message | Meaning |
|---------|---------|
| `❌ I couldn't find a movie matching "..."` | Movie not in database |
| `❌ "Movie" does not connect from Actor` | Actor not in that movie |
| `❌ Actor isn't in "Movie"` | Actor not found in movie cast |
| `🎉 Connected to Target — you win!` | Game won! |
| `Game is already complete.` | Game already ended |

#### Status Codes

- `200 OK` - Guess processed (check `success` field)
- `404 Not Found` - Invalid `game_id`
- `503 Service Unavailable` - Graph not ready

---

### Get Game State

Retrieve the current state of a game without submitting a guess.

```http
GET /state?game_id={game_id}
```

#### Query Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `game_id` | string | Yes | Game session UUID |

#### Response

```json
{
  "current_actor": "actor_3223",
  "target_actor": "actor_1245",
  "path": [
    "actor_31",
    "actor_3223"
  ],
  "movies_used": [
    {"id": 24428, "title": "The Avengers"}
  ],
  "completed": false,
  "total_guesses": 1,
  "incorrect_guesses": 0,
  "remaining_attempts": 3
}
```

Same structure as the `state` object in the guess response.

#### Status Codes

- `200 OK` - State retrieved successfully
- `404 Not Found` - Invalid `game_id`
- `503 Service Unavailable` - Graph not ready

---

### Autocomplete Actors

Search for actors by name with autocomplete suggestions.

```http
GET /autocomplete/actors?q={query}&limit={limit}
```

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `q` | string | Yes | - | Search query (min 1 character) |
| `limit` | integer | No | 10 | Maximum number of results |

#### Example Request

```http
GET /autocomplete/actors?q=tom&limit=5
```

#### Response

```json
{
  "query": "tom",
  "results": [
    {
      "name": "Tom Hanks",
      "image": "https://image.tmdb.org/t/p/w185/xndWFsBlClOJFRdhSt4NBwiPq2o.jpg",
      "tmdb_id": 31
    },
    {
      "name": "Tom Cruise",
      "image": "https://image.tmdb.org/t/p/w185/3oWEuo0e8Nx8JvkqYCDec2iMY6K.jpg",
      "tmdb_id": 500
    },
    {
      "name": "Tom Holland",
      "image": "https://image.tmdb.org/t/p/w185/bBRlrpJm9XkUCAwsOyWdBnjbnqv.jpg",
      "tmdb_id": 1136406
    }
  ]
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `query` | string | Echo of search query |
| `results` | array | List of matching actors |
| `results[].name` | string | Actor's full name |
| `results[].image` | string | URL to actor photo (185px) |
| `results[].tmdb_id` | integer | TMDb actor ID |

#### Search Behavior

- Case-insensitive substring matching
- Searches normalized names (without accents)
- Returns matches in arbitrary order
- May return fewer results than `limit` if few matches

#### Status Codes

- `200 OK` - Results returned (may be empty array)
- `503 Service Unavailable` - Graph not ready

---

### Autocomplete Movies

Search for movies by title with autocomplete suggestions.

```http
GET /autocomplete/movies?q={query}&limit={limit}
```

#### Query Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `q` | string | Yes | - | Search query (min 1 character) |
| `limit` | integer | No | 10 | Maximum number of results |

#### Example Request

```http
GET /autocomplete/movies?q=avengers&limit=5
```

#### Response

```json
{
  "query": "avengers",
  "results": [
    {
      "title": "The Avengers",
      "image": "https://image.tmdb.org/t/p/w185/RYMX2wcKCBAr24UyPD7xwmjaTn.jpg",
      "tmdb_id": 24428
    },
    {
      "title": "Avengers: Age of Ultron",
      "image": "https://image.tmdb.org/t/p/w185/4ssDuvEDkSArWEdyBl2X5EHvYKU.jpg",
      "tmdb_id": 99861
    },
    {
      "title": "Avengers: Infinity War",
      "image": "https://image.tmdb.org/t/p/w185/7WsyChQLEftFiDOVTGkv3hFpyyt.jpg",
      "tmdb_id": 299536
    }
  ]
}
```

#### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `query` | string | Echo of search query |
| `results` | array | List of matching movies |
| `results[].title` | string | Movie title |
| `results[].image` | string | URL to poster (185px) |
| `results[].tmdb_id` | integer | TMDb movie ID |

#### Search Behavior

Same as actor autocomplete (case-insensitive, normalized, substring match).

#### Status Codes

- `200 OK` - Results returned (may be empty array)
- `503 Service Unavailable` - Graph not ready

---

## Error Responses

### Graph Not Ready (503)

When the graph hasn't loaded yet:

```json
{
  "error": "Graph not ready",
  "message": "The CineLinks data graph is still loading or missing. Please refresh in a few seconds."
}
```

This can happen:
- On first startup while loading the graph
- If the `.gpickle` file is missing
- If the graph file is corrupted

**Solution**: Wait a few seconds and retry. Check backend logs.

### Game Not Found (404)

When using an invalid `game_id`:

```json
{
  "detail": "Game not found."
}
```

**Solution**: Start a new game with `/start_game`.

### Internal Server Error (500)

Unexpected errors:

```json
{
  "detail": "Failed to find a valid actor pair"
}
```

**Solution**: Check backend logs for details. May indicate graph issues.

---

## Image URLs

All image URLs use TMDb's CDN: `https://image.tmdb.org/t/p/{size}/{path}`

### Available Sizes

| Size | Width | Use Case |
|------|-------|----------|
| `w185` | 185px | Thumbnails, autocomplete |
| `w300` | 300px | Actor cards |
| `w500` | 500px | Movie posters |
| `original` | Full | High-res downloads |

### Missing Images

If `image` field is `null`, no image is available in TMDb.

---

## Rate Limits

No rate limiting currently implemented. For production, consider adding:

```python
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter

@app.get("/start_game")
@limiter.limit("10/minute")
async def start_game(request: Request):
    ...
```

---

## CORS

The API currently allows all origins:

```python
allow_origins=["*"]
```

For production, restrict to your frontend domain:

```python
allow_origins=["https://yourdomain.com"]
```

---

## Caching

### Server-Side

Graph data is loaded once on startup and cached in memory. No per-request caching.

### Client-Side

Responses don't include cache headers. Add if needed:

```python
@app.get("/meta")
async def meta():
    response = JSONResponse(content={...})
    response.headers["Cache-Control"] = "public, max-age=3600"
    return response
```

---

## API Documentation

Interactive API documentation is available at:

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

These provide:
- Interactive endpoint testing
- Request/response schemas
- Example payloads
- Try-it-out functionality

---

## Example Client Code

### JavaScript/Fetch

```javascript
// Start a game
const startResponse = await fetch('http://localhost:8000/start_game');
const gameData = await startResponse.json();
const gameId = gameData.game_id;

// Submit a guess (use movie_id from autocomplete)
const guessResponse = await fetch('http://localhost:8000/guess', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    game_id: gameId,
    movie_id: 24428,  // TMDb movie ID
    actor: 'Robert Downey Jr.'
  })
});
const result = await guessResponse.json();
console.log(result.message);

// Autocomplete actors
const actorResponse = await fetch(
  'http://localhost:8000/autocomplete/actors?q=tom&limit=5'
);
const actors = await actorResponse.json();
console.log(actors.results);
```

### Python/Requests

```python
import requests

# Start a game
response = requests.get('http://localhost:8000/start_game')
game_data = response.json()
game_id = game_data['game_id']

# Submit a guess (use movie_id from autocomplete)
guess_response = requests.post('http://localhost:8000/guess', json={
    'game_id': game_id,
    'movie_id': 24428,  # TMDb movie ID
    'actor': 'Robert Downey Jr.'
})
result = guess_response.json()
print(result['message'])

# Autocomplete actors
actors = requests.get(
    'http://localhost:8000/autocomplete/actors',
    params={'q': 'tom', 'limit': 5}
).json()
print([a['name'] for a in actors['results']])
```

### cURL

```bash
# Start a game
curl http://localhost:8000/start_game

# Submit a guess (use movie_id from autocomplete)
curl -X POST http://localhost:8000/guess \
  -H "Content-Type: application/json" \
  -d '{"game_id":"YOUR_GAME_ID","movie_id":24428,"actor":"Robert Downey Jr."}'

# Autocomplete actors
curl "http://localhost:8000/autocomplete/actors?q=tom&limit=5"
```

---

## Versioning

Current version: **0.1.0**

No API versioning implemented yet. Breaking changes will be documented in release notes.

---

## Support

For API issues:
1. Check the interactive docs at `/docs`
2. Review backend logs for errors
3. Verify graph is loaded with `/health`
4. See [TROUBLESHOOTING.md](TROUBLESHOOTING.md)

Happy building! 🚀