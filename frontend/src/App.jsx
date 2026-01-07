import React, { useEffect, useState, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function App() {
  const [gameId, setGameId] = useState("");
  const [start, setStart] = useState(null);
  const [target, setTarget] = useState(null);
  const [movie, setMovie] = useState(null);  // CHANGED: Now stores {movie_id, title} or null
  const [actor, setActor] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");
  const [path, setPath] = useState(null);  // NEW: Full path structure
  const [optimalPath, setOptimalPath] = useState(null);  // NEW: Optimal path for comparison
  const [showOptimalPath, setShowOptimalPath] = useState(false);  // NEW: Toggle for optimal path display
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [healthStatus, setHealthStatus] = useState(null);

  const [actorSuggestions, setActorSuggestions] = useState([]);
  const [showActorSug, setShowActorSug] = useState(false);
  const sugAbort = useRef(null);

  const [movieSuggestions, setMovieSuggestions] = useState([]);
  const [showMovieSug, setShowMovieSug] = useState(false);
  const movieSugAbort = useRef(null);

  // Onboarding state
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [isReopenedTutorial, setIsReopenedTutorial] = useState(false);

  // Daily puzzle state
  const [puzzleId, setPuzzleId] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [timerStartTime, setTimerStartTime] = useState(null);

  // localStorage helper functions
  const getCurrentPuzzleId = () => {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  };

  const calculateElapsedSeconds = () => {
    if (!timerStartTime) return elapsedSeconds;
    const now = Date.now();
    const sessionSeconds = Math.floor((now - timerStartTime) / 1000);
    return elapsedSeconds + sessionSeconds;
  };

  const saveGameState = () => {
    if (!gameId || !puzzleId) return;

    const gameState = {
      puzzleId,
      gameId,
      startActor: start,
      targetActor: target,
      path,
      state,
      elapsedSeconds: calculateElapsedSeconds(),
      lastSaved: new Date().toISOString()
    };

    try {
      localStorage.setItem('cinelinks-game-state', JSON.stringify(gameState));
    } catch (err) {
      console.error("Failed to save game state:", err);
    }
  };

  const loadGameState = () => {
    try {
      const saved = localStorage.getItem('cinelinks-game-state');
      if (!saved) return null;

      const gameState = JSON.parse(saved);
      const currentPuzzleId = getCurrentPuzzleId();

      // Validate puzzle ID matches today
      if (gameState.puzzleId !== currentPuzzleId) {
        console.log("Saved game is from different day, clearing...");
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

  const hydrateGameState = (savedState) => {
    console.log("Hydrating game from saved state:", savedState);

    setPuzzleId(savedState.puzzleId);
    setGameId(savedState.gameId);
    setStart(savedState.startActor);
    setTarget(savedState.targetActor);
    setPath(savedState.path);
    setState(savedState.state);
    setElapsedSeconds(savedState.elapsedSeconds || 0);
    setTimerStartTime(Date.now());

    setMessage("Welcome back! Continuing your daily puzzle...");
    setMessageType("success");
    setTimeout(() => {
      setMessage("");
      setMessageType("");
    }, 3000);
  };

  const startDailyPuzzle = async () => {
    setLoading(true);
    setMessage("");
    setMessageType("");
    setPath(null);
    setOptimalPath(null);
    setShowOptimalPath(false);
    setState(null);
    setMovie(null);
    setActor("");
    setElapsedSeconds(0);
    setTimerStartTime(null);

    try {
      // Get today's daily puzzle actors
      const dailyRes = await fetch(`${API}/api/daily-pair`);
      if (!dailyRes.ok) {
        const error = await dailyRes.json();
        throw new Error(error.message || "Failed to get daily puzzle");
      }
      const dailyData = await dailyRes.json();

      setPuzzleId(dailyData.puzzleId);

      // Create game session with those actors
      const gameRes = await fetch(`${API}/api/game`, { method: 'POST' });
      if (!gameRes.ok) {
        const error = await gameRes.json();
        throw new Error(error.message || "Failed to start game");
      }
      const gameData = await gameRes.json();

      // Use daily puzzle actors (override random selection)
      setGameId(gameData.gameId);
      setStart(dailyData.startActor);
      setTarget(dailyData.targetActor);
      setPath({
        startActor: dailyData.startActor,
        targetActor: dailyData.targetActor,
        segments: []
      });

      // Start timer
      setTimerStartTime(Date.now());

      // Save initial state
      setTimeout(() => saveGameState(), 100);

    } catch (err) {
      setMessage(err.message || "Backend not ready. Try again in a moment.");
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkHealth();

    // Check if user has seen onboarding before
    const hasSeenOnboarding = localStorage.getItem('cinelinks-onboarding-seen');
    if (!hasSeenOnboarding) {
      setIsReopenedTutorial(false);
      setShowOnboarding(true);
    } else {
      // Try to load saved game state
      const savedState = loadGameState();

      if (savedState) {
        // Hydrate from saved state
        hydrateGameState(savedState);
      } else {
        // Start new daily puzzle
        startDailyPuzzle();
      }
    }
  }, []);

  const checkHealth = async () => {
    try {
      const res = await fetch(`${API}/health`);
      const data = await res.json();
      setHealthStatus(data);
    } catch (err) {
      setHealthStatus({ ok: false, ready: false });
      console.error("Health check failed:", err);
    }
  };

  const handleSwapActors = async () => {
    if (!gameId || loading) return;

    // Frontend validation: prevent swap if moves have been made
    if (state && state.totalGuesses > 0) {
      setMessage("Cannot swap actors after making a move");
      setMessageType("error");
      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 3000);
      return;
    }

    setLoading(true);
    setMessage("");
    setMessageType("");

    try {
      const res = await fetch(`${API}/api/game/${gameId}/swap-actors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || error.message || "Failed to swap actors");
      }

      const data = await res.json();

      // Update state with swapped actors
      setStart(data.startActor);
      setTarget(data.targetActor);
      setPath(data.path);

      setMessage("Actors swapped!");
      setMessageType("success");
      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 2000);

    } catch (err) {
      setMessage(err.message || "Failed to swap actors");
      setMessageType("error");
      setTimeout(() => {
        setMessage("");
        setMessageType("");
      }, 3000);
    } finally {
      setLoading(false);
    }
  };

  const submitGuess = async (e) => {
    if (e) e.preventDefault();
    if (!gameId || !movie || !actor) return;

    setLoading(true);
    setMessage("");
    setMessageType("");

    try {
      const res = await fetch(`${API}/api/game/${gameId}/guess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movieId: movie.movie_id, actorName: actor }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Request failed");

      // Update path and state
      setPath(data.path);
      setState(data.state);

      // Save updated state to localStorage
      setTimeout(() => saveGameState(), 100);

      // Show success message only on win
      if (data.state && data.state.completed) {
        setMessage("🎉 You won!");
        setMessageType("success");

        // Stop timer (keep completed state per plan)
        setElapsedSeconds(calculateElapsedSeconds());
        setTimerStartTime(null);
      }

      // Reset inputs on successful guess
      if (data.success) {
        setMovie(null);
        setActor("");
      }
    } catch (err) {
      setMessage(err.message || "Network error. Please retry.");
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  };

  const fetchOptimalPath = async () => {
    try {
      const res = await fetch(`${API}/api/game/${gameId}/optimal-path`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to fetch optimal path");
      setOptimalPath(data);
      setShowOptimalPath(!showOptimalPath);
    } catch (err) {
      setMessage(err.message || "Failed to fetch optimal path");
      setMessageType("error");
    }
  };

  const fetchActorSuggestions = async (text) => {
    if (!text) {
      setActorSuggestions([]);
      return;
    }
    try {
      if (sugAbort.current) sugAbort.current.abort();
      sugAbort.current = new AbortController();
      const res = await fetch(
        `${API}/autocomplete/actors?q=${encodeURIComponent(text)}&limit=10`,
        { signal: sugAbort.current.signal }
      );
      if (!res.ok) return;
      const data = await res.json();
      setActorSuggestions(data.results || []);
      setShowActorSug(true);
    } catch {}
  };

  useEffect(() => {
    // Only fetch if actor has text AND popup is open (not just closed by selection)
    if (actor && actor.trim() && showActorSug) {
      const t = setTimeout(() => fetchActorSuggestions(actor), 150);
      return () => clearTimeout(t);
    } else if (!actor || !actor.trim()) {
      setActorSuggestions([]);
    }
  }, [actor, showActorSug]);

  const fetchMovieSuggestions = async (text) => {
    if (!text) {
      setMovieSuggestions([]);
      return;
    }
    try {
      if (movieSugAbort.current) movieSugAbort.current.abort();
      movieSugAbort.current = new AbortController();
      const res = await fetch(
        `${API}/autocomplete/movies?q=${encodeURIComponent(text)}&limit=10`,
        { signal: movieSugAbort.current.signal }
      );
      if (!res.ok) return;
      const data = await res.json();
      setMovieSuggestions(data.results || []);
      setShowMovieSug(true);
    } catch {}
  };

  useEffect(() => {
    // Only fetch if movie is a string (user typing), not object (already selected)
    if (typeof movie === 'string' && movie.trim()) {
      const t = setTimeout(() => fetchMovieSuggestions(movie), 150);
      return () => clearTimeout(t);
    } else if (movie === null || (typeof movie === 'object' && movie.movie_id !== null)) {
      // Clear suggestions if nothing selected or movie already selected
      setMovieSuggestions([]);
    }
  }, [movie]);

  // Auto-save game state every 10 seconds
  useEffect(() => {
    if (!gameId || !puzzleId) return;

    const interval = setInterval(() => {
      saveGameState();
    }, 10000); // Save every 10 seconds

    return () => clearInterval(interval);
  }, [gameId, puzzleId, path, state, elapsedSeconds, timerStartTime]);

  const handleStartGame = () => {
    localStorage.setItem('cinelinks-onboarding-seen', 'true');
    setShowOnboarding(false);
    startDailyPuzzle();
  };

  const handleViewTutorial = () => {
    // Tutorial will be shown in the modal carousel
    // Just mark as seen when they close it
    localStorage.setItem('cinelinks-onboarding-seen', 'true');
  };

  const handleCloseOnboarding = () => {
    localStorage.setItem('cinelinks-onboarding-seen', 'true');
    setShowOnboarding(false);
    if (!gameId) {
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
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    }}>
      <div style={{ width: '100%', maxWidth: '1000px' }}>
        {/* Header - Centered with Help Icon */}
        <div className="header-container" style={{ textAlign: 'center', position: 'relative' }}>
          <h1 className="game-title" style={{
            fontWeight: '300',
            color: '#111827',
            letterSpacing: '-0.02em'
          }}>
            CineLinks
          </h1>
          <button
            onClick={handleReopenOnboarding}
            className="help-icon-button"
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              border: '2px solid #e5e7eb',
              backgroundColor: '#ffffff',
              color: '#6b7280',
              fontSize: '20px',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.2s',
              padding: 0
            }}
            onMouseEnter={(e) => {
              e.target.style.backgroundColor = '#f9fafb';
              e.target.style.borderColor = '#111827';
              e.target.style.color = '#111827';
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = '#ffffff';
              e.target.style.borderColor = '#e5e7eb';
              e.target.style.color = '#6b7280';
            }}
            title="How to Play"
          >
            ?
          </button>
          <p className="game-subtitle" style={{ color: '#6b7280', fontWeight: '300' }}>
            Connect actors through their movies
          </p>
          {healthStatus && !healthStatus.ready && (
            <p style={{ color: '#d97706', fontSize: '14px', marginTop: '16px' }}>
              Graph loading... please wait
            </p>
          )}
        </div>

        {/* Main Container - Clean without border */}
        <div style={{
          backgroundColor: '#ffffff',
          overflow: 'hidden'
        }}>
          <div className="main-container-padding">
            {loading && !gameId ? (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                paddingTop: '60px',
                paddingBottom: '60px'
              }}>
                <p style={{
                  color: '#6b7280',
                  fontSize: '18px',
                  fontWeight: '300'
                }}>
                  Starting game...
                </p>
              </div>
            ) : gameId ? (
              <div className="main-sections-container" style={{ display: 'flex', flexDirection: 'column' }}>
                {/* Actor Display - Side by Side with Inline Styles */}
                <div className="actor-display-container" style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '32px',
                  flexWrap: 'wrap'
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

                {/* Game Stats - Centered */}
                {state && (
                  <div className="game-stats" style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center'
                  }}>
                    <div>
                      <div className="game-stats-number" style={{ fontWeight: '300', color: '#111827' }}>
                        {state.moves_taken || 0}
                      </div>
                      <div style={{ fontSize: '14px', color: '#6b7280', marginTop: '4px', fontWeight: '300' }}>
                        Moves Taken
                      </div>
                    </div>
                    <div style={{ width: '1px', height: '48px', backgroundColor: '#e5e7eb' }}></div>
                    <div>
                      <div className="game-stats-number" style={{ fontWeight: '300', color: '#111827' }}>
                        {state.moves_remaining ?? 6}
                      </div>
                      <div style={{ fontSize: '14px', color: '#6b7280', marginTop: '4px', fontWeight: '300' }}>
                        Moves Left
                      </div>
                    </div>
                  </div>
                )}

                {/* Input Form - Centered */}
                {!state?.completed && (
                  <div className="game-form" style={{ display: 'flex', flexDirection: 'column', maxWidth: '640px', margin: '0 auto', width: '100%' }}>
                    <div style={{ position: 'relative' }}>
                      <label style={{
                        display: 'block',
                        fontSize: '14px',
                        fontWeight: '300',
                        color: '#6b7280',
                        marginBottom: '8px',
                        textAlign: 'center'
                      }}>
                        Movie Title
                      </label>
                      <input
                        type="text"
                        value={typeof movie === 'string' ? movie : (movie ? movie.title : "")}  // Handle both string and object
                        onChange={(e) => {
                          const value = e.target.value;
                          // Always set as string when typing (not object)
                          setMovie(value === '' ? null : value);
                          if (value) setShowMovieSug(true);
                        }}
                        onFocus={() => {
                          // FIX: Don't reopen popup if movie already selected
                          if (movie && movie.title) {
                            if (movie.movie_id !== null) {
                              setShowMovieSug(false);
                            } else {
                              setShowMovieSug(true);
                            }
                          }
                        }}
                        onBlur={() => setTimeout(() => setShowMovieSug(false), 150)}
                        onKeyDown={(e) => e.key === 'Enter' && submitGuess()}
                        placeholder="Start typing a movie..."
                        style={{
                          width: '100%',
                          padding: '16px 24px',
                          backgroundColor: '#f9fafb',
                          border: '1px solid #e5e7eb',
                          borderRadius: '16px',
                          color: '#111827',
                          fontSize: '18px',
                          fontWeight: '300',
                          textAlign: 'center',
                          outline: 'none'
                        }}
                        onFocus={(e) => {
                          e.target.style.ring = '2px';
                          e.target.style.ringColor = '#111827';
                          e.target.style.borderColor = 'transparent';
                        }}
                        onBlur={(e) => {
                          if (!movie || !showMovieSug) {
                            e.target.style.ring = '0px';
                            e.target.style.borderColor = '#e5e7eb';
                          }
                        }}
                      />
                      {showMovieSug && movieSuggestions.length > 0 && typeof movie === 'string' && (
                        <SuggestionBox
                          items={movieSuggestions}
                          onSelect={(item) => {
                            // FIX: Set full object with ID and close immediately
                            setMovie({ movie_id: item.movie_id, title: item.title });
                            setShowMovieSug(false);
                            setMovieSuggestions([]);  // Clear to prevent refetch
                          }}
                          renderItem={(item) => item.title}
                        />
                      )}
                    </div>

                    <div style={{ position: 'relative' }}>
                      <label style={{
                        display: 'block',
                        fontSize: '14px',
                        fontWeight: '300',
                        color: '#6b7280',
                        marginBottom: '8px',
                        textAlign: 'center'
                      }}>
                        Actor Name
                      </label>
                      <input
                        type="text"
                        value={actor}
                        onChange={(e) => {
                          const value = e.target.value;
                          setActor(value);
                          if (value) setShowActorSug(true);
                        }}
                        onFocus={() => actor && setShowActorSug(true)}
                        onBlur={() => setTimeout(() => setShowActorSug(false), 120)}
                        onKeyDown={(e) => e.key === 'Enter' && submitGuess()}
                        placeholder="Start typing an actor..."
                        style={{
                          width: '100%',
                          padding: '16px 24px',
                          backgroundColor: '#f9fafb',
                          border: '1px solid #e5e7eb',
                          borderRadius: '16px',
                          color: '#111827',
                          fontSize: '18px',
                          fontWeight: '300',
                          textAlign: 'center',
                          outline: 'none'
                        }}
                      />
                      {showActorSug && actorSuggestions.length > 0 && (
                        <SuggestionBox
                          items={actorSuggestions}
                          onSelect={(item) => {
                            setActor(item.name);
                            setShowActorSug(false);
                            setActorSuggestions([]);  // Clear to prevent re-fetch
                          }}
                          renderItem={(item) => item.name}
                        />
                      )}
                    </div>

                    <button
                      onClick={submitGuess}
                      disabled={loading || !movie || !actor}
                      style={{
                        width: '100%',
                        padding: '20px 32px',
                        backgroundColor: '#111827',
                        color: '#ffffff',
                        fontWeight: '300',
                        borderRadius: '16px',
                        border: 'none',
                        cursor: (loading || !movie || !actor) ? 'not-allowed' : 'pointer',
                        opacity: (loading || !movie || !actor) ? 0.3 : 1,
                        fontSize: '18px',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        if (!loading && movie && actor) {
                          e.target.style.backgroundColor = '#1f2937';
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.backgroundColor = '#111827';
                      }}
                    >
                      {loading ? "Checking..." : "Submit Guess"}
                    </button>
                  </div>
                )}

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

                {/* Path Visualization */}
                {path && state && state.totalGuesses > 0 && (
                  <div style={{ marginTop: '32px' }}>
                    <PathVisualization path={path} isOptimal={false} />
                  </div>
                )}

                {/* Post-win controls */}
                {state?.completed && state?.incorrectGuesses < 3 && (
                  <div style={{ textAlign: 'center', marginTop: '32px', display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button
                      onClick={fetchOptimalPath}
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
                      {showOptimalPath ? 'Hide Optimal Path' : 'Show Optimal Path'}
                    </button>

                    <button
                      onClick={startGame}
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

                {/* New Game Button for game over (loss) */}
                {state?.completed && state?.incorrectGuesses >= 3 && (
                  <div style={{ textAlign: 'center', paddingTop: '32px' }}>
                    <button
                      onClick={startGame}
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
                      Start New Game
                    </button>
                  </div>
                )}

                {/* Optimal path comparison */}
                {showOptimalPath && optimalPath && (
                  <div style={{ marginTop: '60px', padding: '20px', backgroundColor: '#1f2937', borderRadius: '12px' }}>
                    <h3 style={{ textAlign: 'center', color: '#f3f4f6', marginBottom: '20px' }}>
                      Your Path: {path.segments.length} moves
                    </h3>
                    <PathVisualization path={path} isOptimal={false} />

                    <h3 style={{ textAlign: 'center', color: '#10b981', marginTop: '40px', marginBottom: '20px' }}>
                      Optimal Path: {optimalPath.segments.length} moves
                    </h3>
                    <PathVisualization path={optimalPath} isOptimal={true} />
                  </div>
                )}
              </div>
            ) : null}

            {/* Error message if game failed to load */}
            {!loading && !gameId && message && (
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
                    onClick={startGame}
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

        {/* Onboarding Modal */}
        {showOnboarding && (
          <OnboardingModal
            onStartGame={handleStartGame}
            onViewTutorial={handleViewTutorial}
            onClose={handleCloseOnboarding}
            isReopen={isReopenedTutorial}
          />
        )}
      </div>
    </div>
  );
}

function PathVisualization({ path, isOptimal = false }) {
  if (!path) return null;

  const segments = path.segments || [];

  return (
    <div className="path-visualization" style={{
      overflowX: 'auto',
      overflowY: 'visible'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: '0',
        minWidth: 'fit-content',
        position: 'relative'
      }}>
        {/* Start Actor */}
        <ActorNodeInPath actor={path.startActor} index={0} />

        {/* Segments (movie + actor pairs) */}
        {segments.map((segment, i) => (
          <React.Fragment key={i}>
            <MovieSegment
              movie={segment.movie}
              index={i}
              isOptimal={isOptimal}
            />
            <ActorNodeInPath actor={segment.actor} index={i + 1} />
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

function ActorNodeInPath({ actor, index = 0 }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '8px',
      animation: `slideIn 0.3s ease-out ${index * 0.1}s both`
    }}>
      {/* Actor Image */}
      <div className="path-actor-node" style={{
        borderRadius: '50%',
        overflow: 'hidden',
        border: '3px solid #1f2937',
        boxShadow: '0 4px 6px rgba(0,0,0,0.2)',
        backgroundColor: '#374151'
      }}>
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

function MovieSegment({ movie, index, isOptimal = false }) {
  // Alternate movies above (even index) and below (odd index) the center line
  const isAbove = index % 2 === 0;
  const lineColor = isOptimal ? '#10b981' : '#6b7280';

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
            border: `2px solid ${isOptimal ? '#10b981' : '#374151'}`,
            backgroundColor: '#1f2937'
          }}>
            {movie.posterUrl ? (
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
                backgroundColor: '#374151',
                color: '#9ca3af',
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
  // Support both old and new API formats (image and imageUrl)
  const imageUrl = actor?.imageUrl || actor?.image;

  return (
    <div className="actor-card" style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '16px',
      backgroundColor: '#f9fafb',
      borderRadius: '24px',
      border: '1px solid #e5e7eb',
      flexShrink: 0
    }}>
      {imageUrl && (
        <img
          src={imageUrl}
          alt={actor?.name}
          className="actor-card-image"
          style={{
            borderRadius: '16px',
            objectFit: 'cover',
            objectPosition: '50% 25%',
            display: 'block',
            border: '2px solid #e5e7eb',
            boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)'
          }}
        />
      )}
      <span className="actor-card-name" style={{
        fontWeight: '300',
        color: '#111827',
        textAlign: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
      }}>
        {actor?.name}
      </span>
    </div>
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
            fontWeight: '300',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
          }}>
            {renderItem(item)}
          </span>
        </div>
      ))}
    </div>
  );
}

function OnboardingModal({ onStartGame, onViewTutorial, onClose, isReopen = false }) {
  const [showTutorial, setShowTutorial] = useState(isReopen);
  const [currentCard, setCurrentCard] = useState(0);
  const [touchStart, setTouchStart] = useState(null);
  const [touchEnd, setTouchEnd] = useState(null);

  const tutorialCards = [
    {
      title: "1. Select a Movie",
      description: "Choose a movie featuring the starting actor",
      icon: "🎬"
    },
    {
      title: "2. Pick an Actor",
      description: "Select an actor who appeared in that movie",
      icon: "⭐"
    },
    {
      title: "3. Reach the Target",
      description: "Repeat until you connect to the target actor",
      icon: "🎯"
    }
  ];

  const handleViewTutorial = () => {
    setShowTutorial(true);
    onViewTutorial();
  };

  const handleNext = () => {
    if (currentCard < tutorialCards.length - 1) {
      setCurrentCard(currentCard + 1);
    } else {
      onClose();
    }
  };

  const handlePrev = () => {
    if (currentCard > 0) {
      setCurrentCard(currentCard - 1);
    }
  };

  // Touch handlers for swipe
  const minSwipeDistance = 50;

  const onTouchStart = (e) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;
    if (isLeftSwipe) {
      handleNext();
    }
    if (isRightSwipe) {
      handlePrev();
    }
  };

  return (
    <div
      className="onboarding-backdrop"
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
        if (e.target.className === 'onboarding-backdrop') {
          onClose();
        }
      }}
    >
      <div
        className="onboarding-modal"
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '24px',
          maxWidth: '500px',
          width: '100%',
          maxHeight: '70vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
          position: 'relative'
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
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
            zIndex: 10,
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => {
            e.target.style.backgroundColor = '#e5e7eb';
            e.target.style.color = '#111827';
          }}
          onMouseLeave={(e) => {
            e.target.style.backgroundColor = '#f3f4f6';
            e.target.style.color = '#6b7280';
          }}
        >
          ×
        </button>

        {!showTutorial ? (
          // Welcome screen
          <div
            style={{
              padding: '48px 32px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: '32px',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '400px'
            }}
          >
            <div>
              <h2 style={{
                fontSize: '32px',
                fontWeight: '600',
                color: '#111827',
                marginBottom: '16px',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
              }}>
                Welcome to CineLinks
              </h2>
              <p style={{
                fontSize: '18px',
                color: '#6b7280',
                fontWeight: '300',
                lineHeight: '1.6',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
              }}>
                Connect two actors through the movies they've appeared in
              </p>
            </div>

            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              width: '100%',
              maxWidth: '320px'
            }}>
              <button
                onClick={handleViewTutorial}
                style={{
                  padding: '16px 32px',
                  backgroundColor: '#111827',
                  color: '#ffffff',
                  borderRadius: '16px',
                  border: 'none',
                  fontSize: '18px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
                }}
                onMouseEnter={(e) => {
                  e.target.style.backgroundColor = '#1f2937';
                }}
                onMouseLeave={(e) => {
                  e.target.style.backgroundColor = '#111827';
                }}
              >
                How to Play
              </button>
              <button
                onClick={onStartGame}
                style={{
                  padding: '16px 32px',
                  backgroundColor: '#ffffff',
                  color: '#111827',
                  borderRadius: '16px',
                  border: '2px solid #e5e7eb',
                  fontSize: '18px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
                }}
                onMouseEnter={(e) => {
                  e.target.style.borderColor = '#111827';
                  e.target.style.backgroundColor = '#f9fafb';
                }}
                onMouseLeave={(e) => {
                  e.target.style.borderColor = '#e5e7eb';
                  e.target.style.backgroundColor = '#ffffff';
                }}
              >
                Start Game
              </button>
            </div>
          </div>
        ) : (
          // Tutorial carousel
          <div
            style={{
              padding: '48px 32px 32px',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              gap: '32px',
              minHeight: '400px',
              justifyContent: 'space-between'
            }}
          >
            {/* Card content */}
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '24px'
            }}>
              <div style={{
                fontSize: '64px',
                marginBottom: '16px'
              }}>
                {tutorialCards[currentCard].icon}
              </div>
              <h3 style={{
                fontSize: '24px',
                fontWeight: '600',
                color: '#111827',
                marginBottom: '8px',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
              }}>
                {tutorialCards[currentCard].title}
              </h3>
              <p style={{
                fontSize: '16px',
                color: '#6b7280',
                fontWeight: '300',
                lineHeight: '1.6',
                maxWidth: '320px',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
              }}>
                {tutorialCards[currentCard].description}
              </p>
            </div>

            {/* Dot indicators */}
            <div style={{
              display: 'flex',
              gap: '8px',
              justifyContent: 'center',
              marginTop: '16px'
            }}>
              {tutorialCards.map((_, index) => (
                <div
                  key={index}
                  onClick={() => setCurrentCard(index)}
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: index === currentCard ? '#111827' : '#d1d5db',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                />
              ))}
            </div>

            {/* Navigation buttons */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '16px'
            }}>
              <button
                onClick={handlePrev}
                disabled={currentCard === 0}
                style={{
                  padding: '12px 24px',
                  backgroundColor: 'transparent',
                  color: currentCard === 0 ? '#d1d5db' : '#6b7280',
                  border: 'none',
                  fontSize: '16px',
                  fontWeight: '500',
                  cursor: currentCard === 0 ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
                }}
                onMouseEnter={(e) => {
                  if (currentCard !== 0) {
                    e.target.style.color = '#111827';
                  }
                }}
                onMouseLeave={(e) => {
                  if (currentCard !== 0) {
                    e.target.style.color = '#6b7280';
                  }
                }}
              >
                Previous
              </button>
              <button
                onClick={handleNext}
                style={{
                  padding: '12px 24px',
                  backgroundColor: '#111827',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '12px',
                  fontSize: '16px',
                  fontWeight: '500',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
                }}
                onMouseEnter={(e) => {
                  e.target.style.backgroundColor = '#1f2937';
                }}
                onMouseLeave={(e) => {
                  e.target.style.backgroundColor = '#111827';
                }}
              >
                {currentCard === tutorialCards.length - 1 ? "Let's Play!" : "Next"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}