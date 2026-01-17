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

  // Modal state for interactive graph guessing
  const [showGuessModal, setShowGuessModal] = useState(false);
  const [guessMode, setGuessMode] = useState('movie'); // 'movie' or 'actor'

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

      // Create game session with daily puzzle actors
      const gameRes = await fetch(`${API}/api/game`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startActorId: dailyData.startActor.id,
          targetActorId: dailyData.targetActor.id
        })
      });
      if (!gameRes.ok) {
        const error = await gameRes.json();
        throw new Error(error.message || "Failed to start game");
      }
      const gameData = await gameRes.json();

      // Set game state from response
      setGameId(gameData.gameId);
      setStart(gameData.startActor);
      setTarget(gameData.targetActor);
      setPath({
        startActor: gameData.startActor,
        targetActor: gameData.targetActor,
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

      // Save updated state to localStorage
      setTimeout(() => saveGameState(), 100);

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

  const handleGiveUp = async () => {
    if (!gameId || loading) return;

    // Confirm before giving up
    if (!window.confirm("Are you sure you want to give up? This will count as a loss and show you the solution.")) {
      return;
    }

    setLoading(true);
    setMessage("");
    setMessageType("");

    try {
      const res = await fetch(`${API}/api/game/${gameId}/give-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.detail || error.message || "Failed to give up");
      }

      const data = await res.json();

      // Update state with gave-up status
      setState({
        ...state,
        completed: true,
        gaveUp: true,
        incorrectGuesses: 3,
        remainingAttempts: 0
      });

      // Stop timer
      setElapsedSeconds(calculateElapsedSeconds());
      setTimerStartTime(null);

      // Clear game state from localStorage (daily puzzle is over)
      clearGameState();

      // Show message
      setMessage("You gave up. Here's the optimal solution:");
      setMessageType("error");

      // Automatically fetch and show optimal path
      setTimeout(() => {
        fetchOptimalPath();
      }, 500);

    } catch (err) {
      setMessage(err.message || "Failed to give up");
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  };

  const openGuessModal = (mode) => {
    setGuessMode(mode); // 'movie' or 'actor'
    setShowGuessModal(true);
    // Clear previous selections
    if (mode === 'movie') {
      setMovie(null);
      setShowMovieSug(false);
    } else {
      setActor('');
      setShowActorSug(false);
    }
    setMessage('');
    setMessageType('');
  };

  const submitGuess = async (e) => {
    if (e) e.preventDefault();

    // Validate based on guess mode
    if (!gameId) return;
    if (guessMode === 'movie' && (!movie || typeof movie !== 'object' || !movie.movie_id)) {
      setMessage("Please select a movie from the autocomplete suggestions.");
      setMessageType("error");
      return;
    }
    if (guessMode === 'actor' && !actor) return;

    setLoading(true);
    setMessage("");
    setMessageType("");

    try {
      // Build payload based on guess mode
      const payload = guessMode === 'movie'
        ? { movieId: movie.movie_id, actorName: null }
        : { movieId: null, actorName: actor };

      const res = await fetch(`${API}/api/game/${gameId}/guess`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // Handle 404 - game doesn't exist (backend restarted)
      if (res.status === 404) {
        localStorage.removeItem('cinelinks-game-state');
        setMessage("Game session expired. Starting new game...");
        setMessageType("error");
        setShowGuessModal(false);
        // Clear all game state and start fresh
        setGameId(null);
        setPath(null);
        setState(null);
        setTimeout(() => window.location.reload(), 1500);
        return;
      }

      const data = await res.json();

      if (data.success) {
        // Update path and state
        console.log('[DEBUG] Guess response - path:', data.path);
        console.log('[DEBUG] pendingMovie:', data.path?.pendingMovie);
        setPath(data.path);
        setState(data.state);

        // Save updated state to localStorage
        setTimeout(() => saveGameState(), 100);

        // Close modal on success
        setShowGuessModal(false);
        setMessage('');
        setMessageType('');

        // Reset inputs
        setMovie(null);
        setActor('');

        // Show success message only on win
        if (data.state && data.state.completed) {
          setMessage("🎉 You won!");
          setMessageType("success");

          // Stop timer (keep completed state per plan)
          setElapsedSeconds(calculateElapsedSeconds());
          setTimerStartTime(null);
        }
      } else {
        // Show error in modal, keep it open
        setMessage(data.message || 'Incorrect guess. Try again!');
        setMessageType('error');
        // Stay on same empty box - don't close modal
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
            CineLinks{' '}
            <span className="beta-badge">BETA</span>
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
              <div className="main-sections-container" style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
                {/* Actor Display and Stats Container */}
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'center',
                  gap: '48px',
                  flexWrap: 'wrap'
                }}>
                  {/* Actor Display - Side by Side */}
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

                  {/* Game Stats and Give Up - Right side */}
                  <div style={{
                    display: 'block',
                    textAlign: 'center'
                  }}>
                    {/* Connections Counter */}
                    {state && (
                      <div style={{
                        marginBottom: '16px'
                      }}>
                        <div className="game-stats-number" style={{ fontWeight: '300', color: '#111827' }}>
                          {state.moves_taken || 0}
                        </div>
                        <div style={{ fontSize: '14px', color: '#6b7280', marginTop: '4px', fontWeight: '300' }}>
                          Connections
                        </div>
                      </div>
                    )}

                    {/* Give Up Button */}
                    {!state?.completed && (
                      <button
                        onClick={handleGiveUp}
                        disabled={loading}
                        className="give-up-button"
                        style={{
                          padding: '8px 16px',
                          backgroundColor: 'transparent',
                          color: '#111827',
                          fontWeight: '300',
                          fontSize: '14px',
                          border: '1px solid #111827',
                          borderRadius: '8px',
                          cursor: loading ? 'not-allowed' : 'pointer',
                          opacity: loading ? 0.3 : 1,
                          transition: 'all 0.2s',
                          display: 'block',
                          margin: '0 auto'
                        }}
                        onMouseEnter={(e) => {
                          if (!loading) {
                            e.target.style.backgroundColor = '#f9fafb';
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.backgroundColor = 'transparent';
                        }}
                      >
                        Give Up?
                      </button>
                    )}
                  </div>
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
                {!state?.completed && start && (
                  <div style={{ marginTop: '16px' }}>
                    <PathVisualization
                      path={path}
                      start={start}
                      onEmptyNodeClick={openGuessModal}
                      isOptimal={false}
                    />
                  </div>
                )}

                {/* Win state - Show controls to view optimal path */}
                {state?.completed && state?.incorrectGuesses < 3 && !state?.gaveUp && (
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

                {/* Loss by incorrect attempts */}
                {state?.completed && state?.incorrectGuesses >= 3 && !state?.gaveUp && (
                  <div>
                    <div style={{
                      textAlign: 'center',
                      padding: '20px',
                      backgroundColor: '#fef2f2',
                      borderRadius: '16px',
                      marginTop: '32px',
                      border: '1px solid #fecaca'
                    }}>
                      <p style={{ fontSize: '18px', fontWeight: '500', color: '#991b1b', marginBottom: '16px' }}>
                        Game Over - You ran out of attempts
                      </p>
                      <button
                        onClick={fetchOptimalPath}
                        style={{
                          padding: '12px 24px',
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
                    </div>
                    <div style={{ textAlign: 'center', paddingTop: '16px' }}>
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
                        Start New Game
                      </button>
                    </div>
                  </div>
                )}

                {/* Gave up - Show optimal path automatically */}
                {state?.completed && state?.gaveUp && (
                  <div>
                    <div style={{
                      textAlign: 'center',
                      padding: '20px',
                      backgroundColor: '#fff7ed',
                      borderRadius: '16px',
                      marginTop: '32px',
                      border: '1px solid #fed7aa'
                    }}>
                      <p style={{ fontSize: '18px', fontWeight: '500', color: '#9a3412', marginBottom: '8px' }}>
                        You gave up on this puzzle
                      </p>
                      <p style={{ fontSize: '14px', color: '#9a3412', fontWeight: '300' }}>
                        Here's the optimal solution:
                      </p>
                    </div>
                    <div style={{ textAlign: 'center', paddingTop: '16px' }}>
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
                        Start New Game
                      </button>
                    </div>
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
                      <div>
                        <div style={{ fontWeight: 500 }}>{item.title}</div>
                        {item.year && (
                          <div style={{ fontSize: '12px', color: '#6b7280' }}>
                            {item.year}
                          </div>
                        )}
                      </div>
                    )}
                  />
                )}

                {guessMode === 'actor' && showActorSug && actorSuggestions.length > 0 && (
                  <SuggestionBox
                    items={actorSuggestions}
                    onSelect={(item) => {
                      setActor(item.name);
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
                disabled={loading || (guessMode === 'movie' ? !movie : !actor)}
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
            onViewTutorial={handleViewTutorial}
            onClose={handleCloseOnboarding}
            isReopen={isReopenedTutorial}
          />
        )}
      </div>
    </div>
  );
}

function PathVisualization({ path, start, onEmptyNodeClick, isOptimal = false }) {
  // Show start actor even without path, or use path.startActor if available
  const startActor = path?.startActor || start;
  if (!startActor) return null;

  const segments = path?.segments || [];
  const pendingMovie = path?.pendingMovie;

  // Determine what empty placeholder to show next
  // If there's a pending movie, we need an actor guess
  // Otherwise, if last segment has both movie and actor, we need a movie guess
  const needsActorGuess = pendingMovie !== null && pendingMovie !== undefined;
  const needsMovieGuess = !needsActorGuess && (segments.length === 0 || segments[segments.length - 1].actor);

  return (
    <div className="path-visualization" style={{
      overflowX: 'visible',
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
        <ActorNodeInPath actor={startActor} index={0} />

        {/* Segments (movie + actor pairs) */}
        {segments.map((segment, i) => (
          <React.Fragment key={i}>
            {segment.movie && (
              <MovieSegment
                movie={segment.movie}
                index={i}
                isOptimal={isOptimal}
              />
            )}
            {segment.actor && (
              <ActorNodeInPath actor={segment.actor} index={i + 1} />
            )}
          </React.Fragment>
        ))}

        {/* Pending movie (guessed but not yet paired with actor) */}
        {pendingMovie && (
          <MovieSegment
            movie={pendingMovie}
            index={segments.length}
            isOptimal={isOptimal}
          />
        )}

        {/* Empty placeholder for next guess - only in interactive mode */}
        {!isOptimal && onEmptyNodeClick && (
          <>
            {needsMovieGuess && (
              <EmptyMovieNode
                onClick={() => onEmptyNodeClick('movie')}
                index={segments.length}
              />
            )}
            {needsActorGuess && (
              <EmptyActorNode onClick={() => onEmptyNodeClick('actor')} />
            )}
          </>
        )}
      </div>
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