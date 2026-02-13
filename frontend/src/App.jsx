import React, { useEffect, useState, useRef } from "react";
import * as api from './services/api.js';
import { prefetchNeighbors } from './services/api.js';
import { GameEngine } from './services/gameEngine.js';
import { SearchIndex } from './services/search.js';
import { GameLoadingSkeleton, ErrorWithRetry, ButtonSpinner } from './components/Skeleton.jsx';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

export default function App() {
  // Game engine and search index refs (mutable, don't trigger re-renders)
  const engineRef = useRef(null);
  const searchIndexRef = useRef(new SearchIndex());
  const actorsMetaRef = useRef(null);
  const moviesMetaRef = useRef(null);

  // UI state
  const [gameReady, setGameReady] = useState(false);
  const [metadataLoaded, setMetadataLoaded] = useState(false);
  const [start, setStart] = useState(null);
  const [target, setTarget] = useState(null);
  const [movie, setMovie] = useState(null);
  const [actor, setActor] = useState("");
  const [selectedActorId, setSelectedActorId] = useState(null);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");
  const [path, setPath] = useState(null);
  const [optimalPaths, setOptimalPaths] = useState(null);
  const [showPathsModal, setShowPathsModal] = useState(false);
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [healthStatus, setHealthStatus] = useState(null);

  const [actorSuggestions, setActorSuggestions] = useState([]);
  const [showActorSug, setShowActorSug] = useState(false);

  const [movieSuggestions, setMovieSuggestions] = useState([]);
  const [showMovieSug, setShowMovieSug] = useState(false);

  // Onboarding state
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isReopenedTutorial, setIsReopenedTutorial] = useState(false);

  // Daily puzzle state
  const [puzzleId, setPuzzleId] = useState("");
  const puzzleIdRef = useRef("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedSecondsRef = useRef(0);
  const [timerStartTime, setTimerStartTime] = useState(null);
  const timerStartTimeRef = useRef(null);

  // Modal state for interactive graph guessing
  const [showGuessModal, setShowGuessModal] = useState(false);
  const [showGiveUpModal, setShowGiveUpModal] = useState(false);
  const [guessMode, setGuessMode] = useState('movie');

  // Sync engine state to React state
  const syncFromEngine = () => {
    const engine = engineRef.current;
    if (!engine) return;
    setPath(engine.getPath());
    setState(engine.getState());
    setStart(engine.resolveActor(engine.startActorId));
    setTarget(engine.resolveActor(engine.targetActorId));
  };

  // localStorage helpers — use refs to avoid stale closures in saveGameState
  const calculateElapsedSeconds = () => {
    if (!timerStartTimeRef.current) return elapsedSecondsRef.current;
    const now = Date.now();
    const sessionSeconds = Math.floor((now - timerStartTimeRef.current) / 1000);
    return elapsedSecondsRef.current + sessionSeconds;
  };

  const saveGameState = () => {
    const engine = engineRef.current;
    const pid = puzzleIdRef.current;
    if (!engine || !pid) return;

    const gameState = {
      puzzleId: pid,
      engineData: engine.serialize(),
      elapsedSeconds: calculateElapsedSeconds(),
      lastSaved: new Date().toISOString()
    };

    try {
      localStorage.setItem('cinelinks-game-state', JSON.stringify(gameState));
    } catch (err) {
      console.error("Failed to save game state:", err);
    }
  };

  const loadGameState = (currentPuzzleDate) => {
    try {
      const saved = localStorage.getItem('cinelinks-game-state');
      if (!saved) return null;

      const gameState = JSON.parse(saved);

      if (gameState.puzzleId !== currentPuzzleDate) {
        localStorage.removeItem('cinelinks-game-state');
        return null;
      }

      return gameState;
    } catch (err) {
      console.error("Failed to load game state:", err);
      localStorage.removeItem('cinelinks-game-state');
      return null;
    }
  };

  const clearGameState = () => {
    localStorage.removeItem('cinelinks-game-state');
  };

  // Load metadata (actors + movies) and build search index
  const loadMetadata = async (graphVersion) => {
    const [actorsData, moviesData] = await Promise.all([
      api.getActorsMetadata(graphVersion),
      api.getMoviesMetadata(graphVersion)
    ]);

    actorsMetaRef.current = actorsData.actors || actorsData;
    moviesMetaRef.current = moviesData.movies || moviesData;

    searchIndexRef.current.loadActors(actorsData, TMDB_IMAGE_BASE);
    searchIndexRef.current.loadMovies(moviesData, TMDB_IMAGE_BASE);

    setMetadataLoaded(true);
    return { actorsMeta: actorsMetaRef.current, moviesMeta: moviesMetaRef.current };
  };

  // Start a new daily puzzle (client-side engine, no server session)
  const startDailyPuzzle = async () => {
    setLoading(true);
    setMessage("");
    setMessageType("");
    setPath(null);
    setOptimalPaths(null);
    setState(null);
    setMovie(null);
    setActor("");
    setSelectedActorId(null);
    setElapsedSeconds(0);
    elapsedSecondsRef.current = 0;
    setTimerStartTime(null);
    timerStartTimeRef.current = null;
    setGameReady(false);

    try {
      // Get today's puzzle first (need graphVersion for cache busting)
      const puzzleData = await api.getPuzzle();
      setPuzzleId(puzzleData.date);
      puzzleIdRef.current = puzzleData.date;

      // Ensure metadata is loaded (pass graphVersion for cache busting)
      let actorsMeta = actorsMetaRef.current;
      let moviesMeta = moviesMetaRef.current;
      if (!actorsMeta || !moviesMeta) {
        const meta = await loadMetadata(puzzleData.graphVersion);
        actorsMeta = meta.actorsMeta;
        moviesMeta = meta.moviesMeta;
      }

      // Create client-side game engine
      const engine = new GameEngine(
        puzzleData.startActorId,
        puzzleData.endActorId,
        actorsMeta,
        moviesMeta,
        TMDB_IMAGE_BASE
      );
      engineRef.current = engine;

      // Sync UI state from engine
      syncFromEngine();
      setGameReady(true);
      const now = Date.now();
      setTimerStartTime(now);
      timerStartTimeRef.current = now;

      // Save initial state
      setTimeout(() => saveGameState(), 100);

    } catch (err) {
      setMessage(err.message || "Backend not ready. Try again in a moment.");
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  };

  // Hydrate engine from saved localStorage state
  const hydrateFromSaved = (savedState, actorsMeta, moviesMeta) => {
    const engine = GameEngine.deserialize(
      savedState.engineData,
      actorsMeta,
      moviesMeta,
      TMDB_IMAGE_BASE
    );
    engineRef.current = engine;
    setPuzzleId(savedState.puzzleId);
    puzzleIdRef.current = savedState.puzzleId;
    const savedElapsed = savedState.elapsedSeconds || 0;
    setElapsedSeconds(savedElapsed);
    elapsedSecondsRef.current = savedElapsed;
    const now = Date.now();
    setTimerStartTime(now);
    timerStartTimeRef.current = now;
    syncFromEngine();
    setGameReady(true);
  };

  // Initialize app
  useEffect(() => {
    const init = async () => {
      // Health check (non-blocking)
      api.checkHealth().then(data => setHealthStatus(data)).catch(() => setHealthStatus({ ok: false }));

      const hasSeenOnboarding = localStorage.getItem('cinelinks-onboarding-seen');
      if (!hasSeenOnboarding) {
        setIsReopenedTutorial(false);
        setShowOnboarding(true);
        // Fetch puzzle first to get graphVersion for cache busting
        api.getPuzzle().then(p => loadMetadata(p.graphVersion)).catch(() => {});
        return;
      }

      // Load metadata first (fetch puzzle for graphVersion cache busting)
      setLoading(true);
      try {
        const puzzleData = await api.getPuzzle();
        const { actorsMeta, moviesMeta } = await loadMetadata(puzzleData.graphVersion);

        // Try to restore saved game (compare against server-provided date)
        const savedState = loadGameState(puzzleData.date);
        if (savedState && savedState.engineData) {
          hydrateFromSaved(savedState, actorsMeta, moviesMeta);
          setLoading(false);
        } else {
          setLoading(false);
          startDailyPuzzle();
        }
      } catch (err) {
        setLoading(false);
        setMessage("Failed to load game data. Please refresh.");
        setMessageType("error");
      }
    };

    init();
  }, []);

  const handleSwapActors = () => {
    const engine = engineRef.current;
    if (!engine || loading) return;

    if (engine.getState().totalGuesses > 0) {
      setMessage("Cannot swap actors after making a move");
      setMessageType("error");
      setTimeout(() => { setMessage(""); setMessageType(""); }, 3000);
      return;
    }

    const swapped = engine.swap();
    if (swapped) {
      syncFromEngine();
      setTimeout(() => saveGameState(), 100);
    }
  };

  const handleGiveUp = () => {
    if (!engineRef.current || loading) return;
    setShowGiveUpModal(true);
  };

  const confirmGiveUp = async () => {
    setShowGiveUpModal(false);

    const engine = engineRef.current;
    if (!engine) return;

    engine.giveUp();
    syncFromEngine();

    // Stop timer
    const finalElapsed = calculateElapsedSeconds();
    setElapsedSeconds(finalElapsed);
    elapsedSecondsRef.current = finalElapsed;
    setTimerStartTime(null);
    timerStartTimeRef.current = null;

    // Clear saved state
    clearGameState();

    // Fetch and show optimal paths
    setTimeout(() => fetchOptimalPaths(), 500);
  };

  const openGuessModal = (mode) => {
    setGuessMode(mode);
    setShowGuessModal(true);
    if (mode === 'movie') {
      setMovie(null);
      setShowMovieSug(false);
    } else {
      setActor('');
      setSelectedActorId(null);
      setShowActorSug(false);
    }
    setMessage('');
    setMessageType('');
  };

  const submitGuess = async (e) => {
    if (e) e.preventDefault();

    const engine = engineRef.current;
    if (!engine) return;

    if (guessMode === 'movie') {
      // Movie guess
      if (!movie || typeof movie !== 'object' || !movie.movie_id) {
        setMessage("Please select a movie from the autocomplete suggestions.");
        setMessageType("error");
        return;
      }

      setLoading(true);
      setMessage("");
      setMessageType("");

      try {
        // Fetch neighbors for current actor
        const neighborsData = await api.getNeighbors(engine.getCurrentActorId());
        const result = engine.guessMovie(movie.movie_id, neighborsData);

        if (result.success) {
          syncFromEngine();
          setTimeout(() => saveGameState(), 100);

          // Close modal, switch to actor mode
          setShowGuessModal(false);
          setMessage('');
          setMessageType('');
          setMovie(null);
        } else {
          setMessage(result.message);
          setMessageType('error');
        }
      } catch (err) {
        setMessage(err.message || "Network error. Please retry.");
        setMessageType("error");
      } finally {
        setLoading(false);
      }

    } else {
      // Actor guess
      if (!selectedActorId) {
        setMessage("Please select an actor from the autocomplete suggestions.");
        setMessageType("error");
        return;
      }

      setLoading(true);
      setMessage("");
      setMessageType("");

      try {
        const result = engine.guessActor(selectedActorId);

        if (result.success) {
          syncFromEngine();
          setTimeout(() => saveGameState(), 100);

          setShowGuessModal(false);
          setMessage('');
          setMessageType('');
          setActor('');
          setSelectedActorId(null);

          if (result.completed) {
            setMessage("You won!");
            setMessageType("success");

            // Stop timer
            const finalElapsed = calculateElapsedSeconds();
            setElapsedSeconds(finalElapsed);
            elapsedSecondsRef.current = finalElapsed;
            setTimerStartTime(null);
            timerStartTimeRef.current = null;

            // Clear saved state on win
            clearGameState();

            // Fetch optimal paths on win
            setTimeout(() => fetchOptimalPaths(), 1000);
          }
        } else {
          setMessage(result.message);
          setMessageType('error');
        }
      } catch (err) {
        setMessage(err.message || "Error validating guess.");
        setMessageType("error");
      } finally {
        setLoading(false);
      }
    }
  };

  const fetchOptimalPaths = async () => {
    try {
      const revealData = await api.getReveal();
      const engine = engineRef.current;
      if (!revealData || !engine) return;

      // Transform reveal data into PathsModal format
      const paths = [];

      if (revealData.bestPath) {
        const { actors: actorIds, movies: movieIds } = revealData.bestPath;
        const segments = [];

        for (let i = 0; i < movieIds.length; i++) {
          segments.push({
            movie: engine.resolveMovie(movieIds[i]),
            actor: engine.resolveActor(actorIds[i + 1])
          });
        }

        paths.push({
          startActor: engine.resolveActor(actorIds[0]),
          segments
        });
      }

      if (paths.length > 0) {
        setOptimalPaths(paths);
        setShowPathsModal(true);
      }
    } catch (err) {
      console.error("Error fetching optimal paths:", err);
      setMessage("Failed to load optimal paths.");
      setMessageType("error");
    }
  };

  // Client-side autocomplete for actors
  useEffect(() => {
    if (actor && actor.trim() && showActorSug) {
      const results = searchIndexRef.current.searchActors(actor, 10);
      setActorSuggestions(results);
    } else if (!actor || !actor.trim()) {
      setActorSuggestions([]);
    }
  }, [actor, showActorSug]);

  // Client-side autocomplete for movies
  useEffect(() => {
    if (typeof movie === 'string' && movie.trim()) {
      const results = searchIndexRef.current.searchMovies(movie, 10);
      setMovieSuggestions(results);
      setShowMovieSug(true);
    } else {
      setMovieSuggestions([]);
    }
  }, [movie]);

  // Auto-save game state every 10 seconds
  useEffect(() => {
    if (!gameReady || !puzzleId) return;

    const interval = setInterval(() => {
      saveGameState();
    }, 10000);

    return () => clearInterval(interval);
  }, [gameReady, puzzleId, path, state, elapsedSeconds, timerStartTime]);

  const handleStartGame = async () => {
    localStorage.setItem('cinelinks-onboarding-seen', 'true');
    setShowOnboarding(false);
    startDailyPuzzle();
  };

  const handleCloseOnboarding = () => {
    localStorage.setItem('cinelinks-onboarding-seen', 'true');
    setShowOnboarding(false);
    if (!gameReady) {
      startDailyPuzzle();
    }
  };

  const handleReopenOnboarding = () => {
    setIsReopenedTutorial(true);
    setShowOnboarding(true);
  };

  return (
    <div className="app-container" style={{
      minHeight: '100vh',
      backgroundColor: '#ffffff',
      display: 'flex',
      justifyContent: 'center',
    }}>
      <div style={{ width: '100%', maxWidth: '1000px' }}>
        {/* Main Container - Clean without border */}
        <div style={{
          backgroundColor: '#ffffff',
          overflow: 'hidden'
        }}>
          <div className="main-container-padding">
            {/* Header */}
            <div className="header-container" style={{ textAlign: 'center' }}>
              <h1 className="game-title" style={{
                fontWeight: '700',
                color: '#111827',
                letterSpacing: '-0.5px',
                lineHeight: '1.1',
                position: 'relative',
                display: 'inline-block'
              }}>
                ACTOR LINKS
                <span style={{
                  position: 'absolute',
                  left: '100%',
                  top: '0.15em',
                  fontWeight: '600',
                  fontSize: '14px',
                  marginLeft: '8px',
                  letterSpacing: '0.05em',
                  whiteSpace: 'nowrap'
                }}>BETA</span>
              </h1>
              {healthStatus && !healthStatus.ok && (
                <p style={{ color: '#d97706', fontSize: '14px', marginTop: '16px' }}>
                  Server unavailable... please wait
                </p>
              )}
            </div>
            {loading && !gameReady ? (
              <GameLoadingSkeleton />
            ) : gameReady ? (
              <div className="main-sections-container" style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
                {/* Actor Display Container */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center'
                }}>
                  {/* Actor Names - Side by Side */}
                  <div className="actor-display-container" style={{
                    display: 'inline-grid',
                    gridTemplateColumns: '1fr auto 1fr',
                    alignItems: 'center',
                    gap: '32px'
                  }}>
                    <ActorCard actor={start} />
                    {(!state || state.totalGuesses === 0) ? (
                      <button
                        onClick={handleSwapActors}
                        disabled={loading}
                        className="actor-separator-button"
                        style={{
                          color: loading ? '#d1d5db' : '#6b7280',
                          fontWeight: '300',
                          border: 'none',
                          background: 'transparent',
                          cursor: loading ? 'not-allowed' : 'pointer',
                          padding: '8px 16px',
                          transition: 'all 0.2s',
                          opacity: loading ? 0.5 : 1
                        }}
                        onMouseEnter={(e) => {
                          if (!loading) {
                            e.target.style.color = '#111827';
                            e.target.style.transform = 'scale(1.1)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.color = '#6b7280';
                          e.target.style.transform = 'scale(1)';
                        }}
                        title="Swap starting and target actors"
                      >
                        ⇄
                      </button>
                    ) : (
                      <div className="actor-separator-arrow" style={{ color: '#d1d5db', fontWeight: '300' }}>→</div>
                    )}
                    <ActorCard actor={target} />
                  </div>

                  {/* Connections Counter */}
                  {state && state.moves_taken > 0 && (
                    <div style={{ textAlign: 'center', marginTop: '16px' }}>
                      <span className="game-stats-number" style={{ fontWeight: '300', color: '#111827' }}>
                        {state.moves_taken}
                      </span>
                      <span style={{ fontSize: '14px', color: '#6b7280', marginLeft: '8px', fontWeight: '300' }}>
                        {state.moves_taken === 1 ? 'Connection' : 'Connections'}
                      </span>
                    </div>
                  )}

                  {/* Give Up + Rules Buttons */}
                  {(!state?.completed || state?.gaveUp) && (
                    <div style={{
                      display: 'flex',
                      justifyContent: 'center',
                      gap: '12px',
                      marginTop: '24px',
                      alignSelf: 'stretch'
                    }}>
                      {state?.gaveUp ? (
                        <button
                          onClick={startDailyPuzzle}
                          style={{
                            padding: '8px 16px',
                            backgroundColor: 'transparent',
                            color: '#111827',
                            fontWeight: '600',
                            fontSize: '14px',
                            border: '1px solid #E5E7EB',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            transition: 'all 0.2s',
                            fontFamily: 'inherit'
                          }}
                          onMouseEnter={(e) => {
                            e.target.style.backgroundColor = '#F3F4F6';
                          }}
                          onMouseLeave={(e) => {
                            e.target.style.backgroundColor = 'transparent';
                          }}
                        >
                          New Game
                        </button>
                      ) : (
                        <button
                          onClick={handleGiveUp}
                          disabled={loading}
                          style={{
                            padding: '8px 16px',
                            backgroundColor: 'transparent',
                            color: '#111827',
                            fontWeight: '600',
                            fontSize: '14px',
                            border: '1px solid #E5E7EB',
                            borderRadius: '8px',
                            cursor: loading ? 'not-allowed' : 'pointer',
                            opacity: loading ? 0.3 : 1,
                            transition: 'all 0.2s',
                            fontFamily: 'inherit'
                          }}
                          onMouseEnter={(e) => {
                            if (!loading) e.target.style.backgroundColor = '#F3F4F6';
                          }}
                          onMouseLeave={(e) => {
                            e.target.style.backgroundColor = 'transparent';
                          }}
                        >
                          Give Up
                        </button>
                      )}
                      <button
                        onClick={handleReopenOnboarding}
                        style={{
                          padding: '8px 16px',
                          backgroundColor: 'transparent',
                          color: '#111827',
                          fontWeight: '600',
                          fontSize: '14px',
                          border: '1px solid #E5E7EB',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          fontFamily: 'inherit'
                        }}
                        onMouseEnter={(e) => {
                          e.target.style.backgroundColor = '#F3F4F6';
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.backgroundColor = 'transparent';
                        }}
                      >
                        Rules
                      </button>
                    </div>
                  )}
                </div>

                {/* Message - Centered */}
                {message && (
                  <div style={{
                    padding: '20px 32px',
                    borderRadius: '16px',
                    textAlign: 'center',
                    maxWidth: '768px',
                    margin: '0 auto',
                    backgroundColor: messageType === "success" ? '#f0fdf4' :
                                   messageType === "error" ? '#fef2f2' : '#eff6ff',
                    border: messageType === "success" ? '1px solid #bbf7d0' :
                           messageType === "error" ? '1px solid #fecaca' : '1px solid #bfdbfe',
                    color: messageType === "success" ? '#14532d' :
                          messageType === "error" ? '#991b1b' : '#1e3a8a'
                  }}>
                    <p style={{ fontSize: '18px', fontWeight: '300' }}>{message}</p>
                  </div>
                )}

                {/* Path Visualization - Always show with interactive empty nodes */}
                {(!state?.completed || state?.gaveUp) && start && (
                  <div>
                    <PathVisualization
                      path={path}
                      start={start}
                      onEmptyNodeClick={state?.gaveUp ? null : openGuessModal}
                      isOptimal={false}
                    />
                  </div>
                )}

                {/* Win state - Show controls to view optimal paths */}
                {state?.completed && !state?.gaveUp && (
                  <div style={{ textAlign: 'center', marginTop: '32px', display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button
                      onClick={fetchOptimalPaths}
                      style={{
                        padding: '16px 32px',
                        backgroundColor: '#10b981',
                        color: '#ffffff',
                        borderRadius: '12px',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '16px',
                        fontWeight: '500',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.target.style.backgroundColor = '#059669';
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.backgroundColor = '#10b981';
                      }}
                    >
                      View Solutions
                    </button>

                    <button
                      onClick={startDailyPuzzle}
                      style={{
                        padding: '16px 48px',
                        backgroundColor: '#111827',
                        color: '#ffffff',
                        fontWeight: '300',
                        borderRadius: '9999px',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '18px',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.target.style.backgroundColor = '#1f2937';
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.backgroundColor = '#111827';
                      }}
                    >
                      New Game
                    </button>
                  </div>
                )}

              </div>
            ) : null}

            {/* Error message if game failed to load */}
            {!loading && !gameReady && message && (
              <div style={{
                textAlign: 'center',
                padding: '60px 20px'
              }}>
                <div style={{
                  padding: '20px 32px',
                  borderRadius: '16px',
                  maxWidth: '448px',
                  margin: '0 auto',
                  backgroundColor: messageType === "error" ? '#fef2f2' : '#eff6ff',
                  color: messageType === "error" ? '#991b1b' : '#1e3a8a',
                  border: messageType === "error" ? '1px solid #fecaca' : '1px solid #bfdbfe'
                }}>
                  <p style={{ fontSize: '16px', fontWeight: '300', marginBottom: '16px' }}>{message}</p>
                  <button
                    onClick={startDailyPuzzle}
                    style={{
                      padding: '12px 24px',
                      backgroundColor: '#111827',
                      color: '#ffffff',
                      fontSize: '16px',
                      fontWeight: '300',
                      borderRadius: '12px',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    Try Again
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Give Up Confirmation Modal */}
        {showGiveUpModal && (
          <div
            className="guess-modal-overlay"
            onClick={() => setShowGiveUpModal(false)}
          >
            <div
              className="give-up-modal-content"
              onClick={(e) => e.stopPropagation()}
            >
              <p style={{ color: '#111827', fontSize: '16px', lineHeight: '1.5', marginBottom: '24px' }}>
                Are you sure you want to give up?
              </p>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button
                  className="give-up-cancel-btn"
                  onClick={() => setShowGiveUpModal(false)}
                >
                  Cancel
                </button>
                <button
                  className="give-up-confirm-btn"
                  onClick={confirmGiveUp}
                >
                  Give Up
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Guess Input Modal */}
        {showGuessModal && (
          <div
            className="guess-modal-overlay"
            onClick={() => setShowGuessModal(false)}
          >
            <div
              className="guess-modal-content"
              onClick={(e) => e.stopPropagation()}
            >
              <h3>{guessMode === 'movie' ? 'Guess a Movie' : 'Guess an Actor'}</h3>

              <div style={{ position: 'relative' }}>
                {/* Input field */}
                <input
                  type="text"
                  value={guessMode === 'movie'
                    ? (typeof movie === 'string' ? movie : (movie ? movie.title : ""))
                    : actor
                  }
                  onChange={(e) => {
                    const value = e.target.value;
                    if (guessMode === 'movie') {
                      setMovie(value === '' ? null : value);
                      if (value) setShowMovieSug(true);
                    } else {
                      setActor(value);
                      setSelectedActorId(null);
                      if (value) setShowActorSug(true);
                    }
                  }}
                  onBlur={() => {
                    setTimeout(() => {
                      setShowMovieSug(false);
                      setShowActorSug(false);
                    }, 150);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      submitGuess();
                    }
                  }}
                  placeholder={guessMode === 'movie' ? 'Enter movie title...' : 'Enter actor name...'}
                  autoFocus
                />

                {/* Autocomplete suggestions */}
                {guessMode === 'movie' && showMovieSug && movieSuggestions.length > 0 && (
                  <SuggestionBox
                    items={movieSuggestions}
                    onSelect={(item) => {
                      setMovie({ movie_id: item.movie_id, title: item.title });
                      setShowMovieSug(false);
                      setMovieSuggestions([]);
                    }}
                    renderItem={(item) => (
                      <div style={{ fontWeight: 500 }}>{item.title}</div>
                    )}
                  />
                )}

                {guessMode === 'actor' && showActorSug && actorSuggestions.length > 0 && (
                  <SuggestionBox
                    items={actorSuggestions}
                    onSelect={(item) => {
                      setActor(item.name);
                      setSelectedActorId(item.id);
                      setShowActorSug(false);
                      setActorSuggestions([]);
                    }}
                    renderItem={(item) => item.name}
                  />
                )}
              </div>

              {/* Submit button */}
              <button
                onClick={submitGuess}
                disabled={loading || (guessMode === 'movie' ? !movie : !selectedActorId)}
              >
                {loading ? 'Checking...' : 'Submit Guess'}
              </button>

              {/* Error message if guess was wrong */}
              {message && messageType === 'error' && (
                <p className="error-message">{message}</p>
              )}
            </div>
          </div>
        )}

        {/* Onboarding Modal */}
        {showOnboarding && (
          <OnboardingModal
            onStartGame={handleStartGame}
            onClose={handleCloseOnboarding}
            isReopen={isReopenedTutorial}
          />
        )}

        {/* Optimal Paths Modal */}
        {showPathsModal && optimalPaths && (
          <PathsModal
            paths={optimalPaths}
            onClose={() => setShowPathsModal(false)}
            isWin={state?.completed && !state?.gaveUp}
          />
        )}
      </div>
    </div>
  );
}

function useSegmentsPerRow() {
  const getCount = () => {
    const w = window.innerWidth;
    if (w <= 480) return 2;
    if (w <= 768) return 3;
    return 4;
  };
  const [count, setCount] = useState(getCount);
  useEffect(() => {
    const onResize = () => setCount(getCount());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return count;
}

function RowConnector({ alignRight }) {
  return (
    <div className="row-connector" style={{
      justifyContent: alignRight ? 'flex-end' : 'flex-start',
      paddingLeft: alignRight ? 0 : '40px',
      paddingRight: alignRight ? '40px' : 0
    }}>
      <div className="row-connector-line" />
    </div>
  );
}

function PathVisualization({ path, start, onEmptyNodeClick, isOptimal = false }) {
  const segmentsPerRow = useSegmentsPerRow();
  const startActor = path?.startActor || start;
  if (!startActor) return null;

  const segments = path?.segments || [];
  const pendingMovie = path?.pendingMovie;

  const needsActorGuess = pendingMovie !== null && pendingMovie !== undefined;
  const needsMovieGuess = !needsActorGuess && (segments.length === 0 || segments[segments.length - 1].actor);

  // For optimal paths, render single row (centered, scrollable)
  if (isOptimal) {
    return (
      <div className="path-visualization" style={{ overflowX: 'visible', overflowY: 'visible' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0',
          minWidth: 'fit-content',
          position: 'relative'
        }}>
          <ActorNodeInPath actor={startActor} index={0} />
          {segments.map((segment, i) => (
            <React.Fragment key={i}>
              {segment.movie && <MovieSegment movie={segment.movie} index={i} isOptimal={true} />}
              {segment.actor && <ActorNodeInPath actor={segment.actor} index={i + 1} />}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  }

  // Chunk segments into rows of N
  const rows = [];
  for (let i = 0; i < segments.length; i += segmentsPerRow) {
    rows.push(segments.slice(i, i + segmentsPerRow));
  }
  // Ensure at least one row for the start actor + placeholders
  if (rows.length === 0) rows.push([]);

  return (
    <div className="path-visualization" style={{ overflowX: 'visible', overflowY: 'visible' }}>
      {rows.map((rowSegments, rowIdx) => {
        const isReversed = rowIdx % 2 === 1;
        const isLastRow = rowIdx === rows.length - 1;

        // Build the items for this row
        const items = [];

        // First row starts with the start actor
        if (rowIdx === 0) {
          items.push(<ActorNodeInPath key="start" actor={startActor} index={0} />);
        }

        // Add segments for this row
        rowSegments.forEach((segment, i) => {
          const globalIdx = rowIdx * segmentsPerRow + i;
          if (segment.movie) {
            items.push(
              <MovieSegment key={`m-${globalIdx}`} movie={segment.movie} index={globalIdx} isOptimal={false} />
            );
          }
          if (segment.actor) {
            items.push(
              <ActorNodeInPath key={`a-${globalIdx}`} actor={segment.actor} index={globalIdx + 1} />
            );
          }
        });

        // Last row gets pending movie + placeholders
        if (isLastRow) {
          if (pendingMovie) {
            items.push(
              <MovieSegment key="pending" movie={pendingMovie} index={segments.length} isOptimal={false} hidePoster={true} />
            );
          }
          if (onEmptyNodeClick) {
            if (needsMovieGuess) {
              items.push(
                <EmptyMovieNode key="empty-movie" onClick={() => onEmptyNodeClick('movie')} index={segments.length} />
              );
            }
            if (needsActorGuess) {
              items.push(
                <EmptyActorNode key="empty-actor" onClick={() => onEmptyNodeClick('actor')} />
              );
            }
          }
        }

        return (
          <React.Fragment key={rowIdx}>
            {rowIdx > 0 && (
              <RowConnector alignRight={rowIdx % 2 === 1} />
            )}
            <div className="path-row" style={{
              flexDirection: isReversed ? 'row-reverse' : 'row',
              position: 'relative'
            }}>
              {items}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

function EmptyMovieNode({ onClick, index = 0 }) {
  // Alternate above/below like real movie segments
  const isAbove = index % 2 === 0;

  return (
    <div className="movie-segment" style={{
      position: 'relative',
      display: 'flex',
      alignItems: 'center'
    }}>
      {/* Horizontal line through center */}
      <div style={{
        width: '80px',
        height: '2px',
        backgroundColor: '#d1d5db',
        position: 'relative',
        zIndex: 1
      }}>
        {/* Vertical connector line */}
        <div className={`movie-segment-connector ${isAbove ? 'movie-segment-connector-above' : ''}`} style={{
          position: 'absolute',
          left: '50%',
          top: isAbove ? '-90px' : '0',
          transform: 'translateX(-50%)',
          width: '2px',
          height: '90px',
          backgroundColor: '#d1d5db'
        }} />

        {/* Empty movie box - positioned at end of vertical connector */}
        <div className={isAbove ? 'movie-segment-movie-above' : 'movie-segment-movie-below'} style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          top: isAbove ? '-250px' : '90px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '6px'
        }}>
          <div
            className="empty-node movie-placeholder"
            onClick={onClick}
            style={{
              border: '2px dashed #d1d5db',
              borderRadius: '8px',
              cursor: 'pointer',
              backgroundColor: '#f9fafb',
              textAlign: 'center',
              flexShrink: 0,
              width: '120px',
              height: '180px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px'
            }}
          >
            <p style={{
              color: '#6b7280',
              fontWeight: '500',
              fontSize: '13px',
              margin: 0,
              lineHeight: '1.3'
            }}>
              Guess a<br/>movie
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyActorNode({ onClick }) {
  return (
    <div
      className="empty-node actor-placeholder"
      onClick={onClick}
      style={{
        width: '120px',
        height: '120px',
        borderRadius: '50%',
        border: '2px dashed #d1d5db',
        cursor: 'pointer',
        backgroundColor: '#f9fafb',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        gap: '4px'
      }}
    >
      <p style={{
        color: '#6b7280',
        fontSize: '12px',
        fontWeight: '500',
        margin: 0,
        textAlign: 'center',
        lineHeight: '1.2'
      }}>
        Guess an<br/>actor
      </p>
    </div>
  );
}

function ActorNodeInPath({ actor, index = 0 }) {
  const [showFullName, setShowFullName] = useState(false);
  const nodeRef = useRef(null);

  useEffect(() => {
    if (!showFullName) return;
    const handleClickOutside = (e) => {
      if (nodeRef.current && !nodeRef.current.contains(e.target)) {
        setShowFullName(false);
      }
    };
    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, [showFullName]);

  return (
    <div ref={nodeRef} style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '8px',
      animation: `slideIn 0.3s ease-out ${index * 0.1}s both`,
      position: 'relative'
    }}>
      {/* Full name popup */}
      {showFullName && (
        <div style={{
          position: 'absolute',
          bottom: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginBottom: '4px',
          backgroundColor: '#111827',
          color: 'white',
          padding: '6px 12px',
          borderRadius: '6px',
          fontSize: '13px',
          fontWeight: '500',
          whiteSpace: 'nowrap',
          zIndex: 10,
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          pointerEvents: 'none'
        }}>
          {actor.name}
        </div>
      )}

      {/* Actor Image */}
      <div
        className="path-actor-node"
        onClick={() => setShowFullName(v => !v)}
        onMouseEnter={() => {
          // Prefetch neighbors on hover for faster subsequent navigation
          if (actor.id) {
            prefetchNeighbors(actor.id);
          }
        }}
        style={{
          borderRadius: '50%',
          overflow: 'hidden',
          border: '3px solid #1f2937',
          boxShadow: '0 4px 6px rgba(0,0,0,0.2)',
          backgroundColor: '#374151',
          cursor: 'pointer'
        }}
      >
        {actor.imageUrl ? (
          <img
            src={actor.imageUrl}
            alt={actor.name}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: '50% 25%',
              display: 'block'
            }}
          />
        ) : (
          <div style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#9ca3af',
            fontSize: '24px',
            fontWeight: 'bold'
          }}>
            {actor.name.charAt(0)}
          </div>
        )}
      </div>

      {/* Actor Name */}
      <div className="path-actor-name" style={{
        fontWeight: '500',
        color: '#1f2937',
        textAlign: 'center',
        lineHeight: '1.2'
      }}>
        {actor.name}
      </div>
    </div>
  );
}

function MovieSegment({ movie, index, isOptimal = false, hidePoster = false }) {
  // Alternate movies above (even index) and below (odd index) the center line
  const isAbove = index % 2 === 0;
  const lineColor = '#6b7280';

  return (
    <div className="movie-segment" style={{
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      animation: `slideIn 0.3s ease-out ${index * 0.15}s both`
    }}>
      {/* Horizontal line through center */}
      <div style={{
        width: '80px',
        height: '2px',
        backgroundColor: lineColor,
        position: 'relative',
        zIndex: 1
      }}>
        {/* Vertical connector line - positioned at center of horizontal line */}
        <div className={`movie-segment-connector ${isAbove ? 'movie-segment-connector-above' : ''}`} style={{
          position: 'absolute',
          left: '50%',
          top: isAbove ? '-90px' : '0',
          transform: 'translateX(-50%)',
          width: '2px',
          height: '90px',
          backgroundColor: lineColor
        }} />

        {/* Movie box - positioned at end of vertical connector */}
        <div className={isAbove ? 'movie-segment-movie-above' : 'movie-segment-movie-below'} style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          top: isAbove ? '-250px' : '90px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '6px'
        }}>
          {/* Movie Poster Box */}
          <div className="path-movie-poster" style={{
            borderRadius: '8px',
            overflow: 'hidden',
            boxShadow: '0 4px 6px rgba(0,0,0,0.2)',
            border: '2px solid #e5e7eb',
            backgroundColor: 'white'
          }}>
            {hidePoster ? (
              <div style={{
                width: '100%',
                aspectRatio: '2/3',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#f3f4f6',
                color: '#6b7280',
                fontSize: '12px',
                padding: '8px',
                textAlign: 'center',
                fontWeight: '500'
              }}>
                {movie.title}
              </div>
            ) : movie.posterUrl ? (
              <img
                src={movie.posterUrl}
                alt={movie.title}
                style={{
                  width: '100%',
                  height: 'auto',
                  display: 'block'
                }}
              />
            ) : (
              <div style={{
                width: '100%',
                aspectRatio: '2/3',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#f3f4f6',
                color: '#6b7280',
                fontSize: '12px',
                padding: '8px',
                textAlign: 'center'
              }}>
                {movie.title}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


function ActorCard({ actor }) {
  const [showPopup, setShowPopup] = useState(false);
  const popupRef = useRef(null);
  const imageUrl = actor?.imageUrl || actor?.image;

  // Split name into first/last
  const nameParts = actor?.name?.split(' ') || [];
  const firstName = nameParts.slice(0, -1).join(' ') || nameParts[0] || '';
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';

  // Close on Esc
  useEffect(() => {
    if (!showPopup) return;
    const handleEsc = (e) => {
      if (e.key === 'Escape') setShowPopup(false);
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [showPopup]);

  // Close on click outside
  useEffect(() => {
    if (!showPopup) return;
    const handleClickOutside = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) {
        setShowPopup(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPopup]);

  return (
    <>
      <div className="actor-card" style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        border: '1px solid #e5e7eb',
        borderRadius: '16px',
        padding: '16px 24px',
        backgroundColor: '#f9fafb'
      }}>
        <button
          onClick={() => setShowPopup(!showPopup)}
          className="actor-card-name"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            padding: '8px',
            minHeight: '44px',
            minWidth: '44px',
            fontWeight: '600',
            color: '#111827',
            textAlign: 'center',
            lineHeight: '1.3',
            fontFamily: 'inherit'
          }}
        >
          <span style={{ display: 'block' }}>{firstName}</span>
          {lastName && <span style={{ display: 'block', marginTop: '2px' }}>{lastName}</span>}
        </button>
      </div>

      {/* Headshot popup */}
      {showPopup && imageUrl && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}>
          <div ref={popupRef} style={{
            position: 'relative',
            borderRadius: '16px',
            overflow: 'hidden',
            boxShadow: '0 4px 12px rgba(0,0,0,0.08)'
          }}>
            <button
              onClick={() => setShowPopup(false)}
              style={{
                position: 'absolute',
                top: '8px',
                right: '8px',
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                border: 'none',
                backgroundColor: 'rgba(0, 0, 0, 0.4)',
                color: '#ffffff',
                fontSize: '18px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1
              }}
            >
              x
            </button>
            <img
              src={imageUrl}
              alt={actor?.name}
              loading="lazy"
              style={{
                width: '220px',
                height: '280px',
                objectFit: 'cover',
                objectPosition: '50% 25%',
                display: 'block'
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}

function SuggestionBox({ items, onSelect, renderItem }) {
  return (
    <div style={{
      position: 'absolute',
      top: '100%',
      left: 0,
      right: 0,
      marginTop: '8px',
      backgroundColor: '#ffffff',
      border: '1px solid #e5e7eb',
      borderRadius: '16px',
      boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)',
      maxHeight: '256px',
      overflowY: 'auto',
      zIndex: 50
    }}>
      {items.map((item, i) => (
        <div
          key={i}
          onMouseDown={() => onSelect(item)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '16px 24px',
            cursor: 'pointer',
            borderBottom: i === items.length - 1 ? 'none' : '1px solid #f3f4f6',
            transition: 'background-color 0.15s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#f9fafb';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '#ffffff';
          }}
        >
          {item.image && (
            <img
              src={item.image}
              alt=""
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                objectFit: 'cover',
                border: '1px solid #e5e7eb'
              }}
            />
          )}
          <span style={{
            color: '#111827',
            fontSize: '16px',
            fontWeight: '300'
          }}>
            {renderItem(item)}
          </span>
        </div>
      ))}
    </div>
  );
}

function PathsModal({ paths, onClose, isWin = false }) {
  const [currentPathIndex, setCurrentPathIndex] = useState(0);
  if (!paths || paths.length === 0) return null;

  const labels = ['Shortest Path', 'Alternative Path #1', 'Alternative Path #2'];
  const path = paths[currentPathIndex];
  const hasMultiple = paths.length > 1;

  const arrowButtonStyle = (disabled) => ({
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    border: '1px solid #e5e7eb',
    backgroundColor: disabled ? '#f9fafb' : 'white',
    color: disabled ? '#d1d5db' : '#374151',
    fontSize: '20px',
    cursor: disabled ? 'default' : 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    transition: 'all 0.15s ease',
    boxShadow: disabled ? 'none' : '0 1px 3px rgba(0,0,0,0.08)'
  });

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '20px',
        overflow: 'auto'
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '16px',
          maxWidth: '900px',
          width: '100%',
          maxHeight: '90vh',
          overflow: 'auto',
          padding: '32px',
          position: 'relative',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close X button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            backgroundColor: 'transparent',
            border: 'none',
            color: '#6b7280',
            fontSize: '28px',
            cursor: 'pointer',
            lineHeight: 1,
            padding: '4px'
          }}
        >
          ×
        </button>

        {/* Header */}
        <div style={{ marginBottom: '24px', textAlign: 'center' }}>
          <h2 style={{ fontSize: '28px', color: '#111827', marginBottom: '8px', fontWeight: '700' }}>
            {isWin ? 'Congratulations!' : 'Shortest Paths'}
          </h2>
          <p style={{ fontSize: '16px', color: '#6b7280' }}>
            {paths.length === 1
              ? 'Here is 1 shortest path:'
              : `Here are ${paths.length} diverse shortest paths:`}
          </p>
        </div>

        {/* Path display area with arrows */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Left arrow */}
          {hasMultiple && (
            <button
              onClick={() => setCurrentPathIndex(i => Math.max(0, i - 1))}
              disabled={currentPathIndex === 0}
              style={arrowButtonStyle(currentPathIndex === 0)}
            >
              ‹
            </button>
          )}

          {/* Current path */}
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            {/* Path label */}
            <div style={{
              textAlign: 'center',
              marginBottom: '16px'
            }}>
              <span style={{
                fontSize: '20px',
                fontWeight: 'bold',
                color: '#111827'
              }}>
                {labels[currentPathIndex]}
              </span>
              <span style={{
                fontSize: '14px',
                color: '#6b7280',
                fontWeight: 'normal',
                marginLeft: '10px'
              }}>
                ({path.segments.length} move{path.segments.length !== 1 ? 's' : ''})
              </span>
            </div>

            {/* Path visualization */}
            <div style={{
              overflowX: 'auto',
              padding: '40px 20px',
              backgroundColor: '#f9fafb',
              borderRadius: '12px',
              border: `2px solid #e5e7eb`
            }}>
              <PathVisualization path={path} isOptimal={true} />
            </div>
          </div>

          {/* Right arrow */}
          {hasMultiple && (
            <button
              onClick={() => setCurrentPathIndex(i => Math.min(paths.length - 1, i + 1))}
              disabled={currentPathIndex === paths.length - 1}
              style={arrowButtonStyle(currentPathIndex === paths.length - 1)}
            >
              ›
            </button>
          )}
        </div>

        {/* Page indicator dots */}
        {hasMultiple && (
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '8px',
            marginTop: '16px'
          }}>
            {paths.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentPathIndex(i)}
                style={{
                  width: i === currentPathIndex ? '24px' : '8px',
                  height: '8px',
                  borderRadius: '4px',
                  border: 'none',
                  backgroundColor: i === currentPathIndex ? '#111827' : '#d1d5db',
                  cursor: 'pointer',
                  padding: 0,
                  transition: 'all 0.2s ease'
                }}
              />
            ))}
          </div>
        )}

        {/* Footer close button */}
        <div style={{ marginTop: '24px', textAlign: 'center' }}>
          <button
            onClick={onClose}
            style={{
              padding: '10px 28px',
              backgroundColor: '#111827',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '15px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function OnboardingModal({ onStartGame, onClose, isReopen = false }) {
  const modalRef = useRef(null);

  // Close on Esc
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '16px'
      }}
      onClick={(e) => {
        if (modalRef.current && !modalRef.current.contains(e.target)) {
          onClose();
        }
      }}
    >
      <div
        ref={modalRef}
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '12px',
          maxWidth: '520px',
          width: '100%',
          boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
          position: 'relative',
          padding: '40px 32px 32px'
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            border: 'none',
            backgroundColor: '#f3f4f6',
            color: '#6b7280',
            fontSize: '20px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10
          }}
        >
          x
        </button>

        {/* Title */}
        <h2 style={{
          fontSize: '28px',
          fontWeight: '700',
          color: '#111827',
          marginBottom: '24px',
          textAlign: 'center'
        }}>
          How to Play
        </h2>

        {/* Rules */}
        <ol style={{
          color: '#374151',
          fontSize: '15px',
          lineHeight: '1.7',
          paddingLeft: '20px',
          margin: '0 0 32px 0'
        }}>
          <li style={{ marginBottom: '12px' }}>
            You are given two actors: a starting actor and a target actor. Use the swap button to choose which actor you want to start from.
          </li>
          <li style={{ marginBottom: '12px' }}>
            Guess a movie featuring the starting actor.
          </li>
          <li style={{ marginBottom: '12px' }}>
            If your movie guess is correct, you must then guess an actor who appeared in that movie. You are not given any new actor or hint automatically.
          </li>
          <li style={{ marginBottom: '12px' }}>
            Repeat with the previously guessed actor until you connect to the target actor.
          </li>
          <li>
            You have a limited number of guesses but you cannot guess the same movie or the same actor more than once (only applies to guesses that were previously correct).
          </li>
        </ol>

        {/* Button */}
        <div style={{ textAlign: 'center' }}>
          <button
            onClick={isReopen ? onClose : onStartGame}
            style={{
              padding: '14px 32px',
              backgroundColor: '#111827',
              color: '#ffffff',
              borderRadius: '12px',
              border: 'none',
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'pointer',
              transition: 'background-color 0.2s',
              fontFamily: 'inherit'
            }}
            onMouseEnter={(e) => {
              e.target.style.backgroundColor = '#1f2937';
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = '#111827';
            }}
          >
            Let's Play.
          </button>
        </div>
      </div>
    </div>
  );
}
