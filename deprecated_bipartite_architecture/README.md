# Deprecated: Bipartite Actor-Movie Architecture

**Deprecated**: December 30, 2025
**Replaced By**: Actor-Actor Graph Architecture

## What Was This?

This directory contains the original bipartite graph architecture that was used from project inception until December 18, 2025.

### Original Architecture

- **Graph Type**: Bipartite (two node types)
- **Nodes**: Actors AND movies as separate nodes
- **Node Format**:
  - Actors: `actor::tmdb_id::name`
  - Movies: `movie::tmdb_id::title`
- **Edges**: Connect actor nodes to movie nodes (actors → movies they appeared in)
- **Build Script**: `build_actor_movie_graph.py`
- **Graph File**: `global_actor_movie_graph.gpickle`

## Why Was It Deprecated?

The bipartite architecture had several limitations:

1. **Game Logic Complexity**: Alternating between actor and movie nodes made validation cumbersome
2. **Scalability**: More nodes meant larger graph size and slower operations
3. **Limited Selection Algorithms**: Couldn't compute meaningful centrality measures across node types
4. **No Actor Similarity Metrics**: Difficult to measure how "well-connected" actors were

## What Replaced It?

**Current Architecture**: Actor-Actor Collaboration Graph

### Key Improvements

- **Graph Type**: Undirected actor-actor graph
- **Nodes**: Actors only (format: `actor_{tmdb_id}`)
- **Edges**: Weighted connections between actors who worked together
  - Edge weight: `Σ (popularity / sqrt(cast_size))` across shared movies
  - Edge metadata: Top 50 shared movies per edge
- **Comprehensive Index**: Separate pickle file with ALL filmographies
  - Enables validation beyond the 50-movie edge limit
  - Supports StartActorScore computation
- **Three-Tier Selection**:
  - Full graph (~9,720 actors)
  - Playable pool (1,000 actors by centrality)
  - Starting pool (100 actors by StartActorScore)

### Benefits

- **Simpler Game Logic**: Direct actor-to-actor validation
- **Better Actor Selection**: StartActorScore identifies recognizable actors
- **Richer Graph Metrics**: Centrality measures enable intelligent filtering
- **Comprehensive Validation**: Index supports ANY shared movie, not just top 50

## Migration Timeline

- **December 18, 2025**: Actor-actor graph introduced
- **December 19, 2025**: Production deployment
- **December 30, 2025**: Legacy files archived to this directory

## Current Files

See the main project for current implementation:

- **Build Script**: `build/build_actor_actor_graph.py`
- **Graph File**: `backend/global_actor_actor_graph.gpickle`
- **Index File**: `backend/global_actor_actor_graph_actor_movie_index.pickle`
- **Documentation**: `CLAUDE.md`, `cinelinks-readme.md`, `cinelinks-api.md`, `cinelinks-game-rules.md`

## For Historical Reference Only

This directory exists for historical reference and to prevent confusion about which build script to use. **Do not use these files for new graph builds.**

If you need to understand the old architecture for research or comparison, the files in this directory show how the system originally worked.

---

**Questions?** See `CLAUDE.md` for current architecture documentation.
