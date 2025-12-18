import { useEffect, useState, useRef } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function App() {
  const [gameId, setGameId] = useState("");
  const [start, setStart] = useState(null);
  const [target, setTarget] = useState(null);
  const [movie, setMovie] = useState(null);  // CHANGED: Now stores {movie_id, title} or null
  const [actor, setActor] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");
  const [posterUrl, setPosterUrl] = useState("");
  const [graphImg, setGraphImg] = useState("");
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(false);
  const [healthStatus, setHealthStatus] = useState(null);

  const [actorSuggestions, setActorSuggestions] = useState([]);
  const [showActorSug, setShowActorSug] = useState(false);
  const sugAbort = useRef(null);

  const [movieSuggestions, setMovieSuggestions] = useState([]);
  const [showMovieSug, setShowMovieSug] = useState(false);
  const movieSugAbort = useRef(null);

  useEffect(() => {
    checkHealth();
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

  const startGame = async () => {
    setLoading(true);
    setMessage("");
    setMessageType("");
    setPosterUrl("");
    setGraphImg("");
    setState(null);
    setMovie(null);  // CHANGED: Reset to null
    setActor("");
    
    try {
      const res = await fetch(`${API}/start_game`);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to start game");
      }
      const data = await res.json();
      setGameId(data.game_id);
      setStart(data.start_actor);
      setTarget(data.target_actor);
    } catch (err) {
      setMessage(err.message || "Backend not ready. Try again in a moment.");
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  };

  const submitGuess = (e) => {
    if (e) e.preventDefault();
    if (!gameId || !movie || !actor) return;

    setLoading(true);
    setMessage("");
    setMessageType("");

    fetch(`${API}/guess`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ game_id: gameId, movie_id: movie.movie_id, actor }),  // CHANGED: Send movie_id
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Request failed");
        return data;
      })
      .then((data) => {
        // Only show message on win - suppress incorrect guess messages
        if (data.state && data.state.completed) {
          setMessage(data.message);
          setMessageType("success");
        }
        // Don't show error messages for incorrect guesses

        if (data.poster_url) setPosterUrl(data.poster_url);
        if (data.graph_image_base64) {
          setGraphImg(`data:image/png;base64,${data.graph_image_base64}`);
        }
        if (data.state) setState(data.state);
        if (data.success) {
          setMovie(null);  // CHANGED: Reset to null
          setActor("");
        }
      })
      .catch((err) => {
        setMessage(err.message || "Network error. Please retry.");
        setMessageType("error");
      })
      .finally(() => {
        setLoading(false);
      });
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
    // Only fetch if actor has text, clear if empty
    if (actor && actor.trim()) {
      const t = setTimeout(() => fetchActorSuggestions(actor), 150);
      return () => clearTimeout(t);
    } else {
      setActorSuggestions([]);
    }
  }, [actor]);

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

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#ffffff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '32px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    }}>
      <div style={{ width: '100%', maxWidth: '1000px' }}>
        {/* Header - Centered */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <h1 style={{
            fontSize: '72px',
            fontWeight: '300',
            color: '#111827',
            marginBottom: '12px',
            letterSpacing: '-0.02em'
          }}>
            CineLinks
          </h1>
          <p style={{ color: '#6b7280', fontSize: '20px', fontWeight: '300' }}>
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
          <div style={{ padding: '48px' }}>
            {!gameId ? (
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                paddingTop: '20px',
                paddingBottom: '20px'
              }}>
                <button
                  onClick={startGame}
                  disabled={loading || (healthStatus && !healthStatus.ready)}
                  style={{
                    padding: '24px 64px',
                    backgroundColor: '#111827',
                    color: '#ffffff',
                    fontSize: '20px',
                    fontWeight: '300',
                    borderRadius: '9999px',
                    border: 'none',
                    cursor: loading || (healthStatus && !healthStatus.ready) ? 'not-allowed' : 'pointer',
                    opacity: loading || (healthStatus && !healthStatus.ready) ? 0.5 : 1,
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (!loading && healthStatus?.ready !== false) {
                      e.target.style.backgroundColor = '#1f2937';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.backgroundColor = '#111827';
                  }}
                >
                  {loading ? "Starting..." : "Start New Game"}
                </button>
                
                <DifficultySelector />
                
                {message && (
                  <div style={{
                    marginTop: '32px',
                    padding: '20px 24px',
                    borderRadius: '16px',
                    textAlign: 'center',
                    maxWidth: '448px',
                    backgroundColor: messageType === "error" ? '#fef2f2' : '#eff6ff',
                    color: messageType === "error" ? '#991b1b' : '#1e3a8a',
                    border: messageType === "error" ? '1px solid #fecaca' : '1px solid #bfdbfe'
                  }}>
                    <p style={{ fontSize: '16px', fontWeight: '300' }}>{message}</p>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '48px' }}>
                {/* Actor Display - Side by Side with Inline Styles */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '32px',
                  flexWrap: 'wrap'
                }}>
                  <ActorCard actor={start} />
                  <div style={{ fontSize: '36px', color: '#d1d5db', fontWeight: '300' }}>↔</div>
                  <ActorCard actor={target} />
                </div>

                {/* Game Stats - Centered */}
                {state && (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '48px',
                    textAlign: 'center'
                  }}>
                    <div>
                      <div style={{ fontSize: '36px', fontWeight: '300', color: '#111827' }}>
                        {state.moves_taken || 0}
                      </div>
                      <div style={{ fontSize: '14px', color: '#6b7280', marginTop: '4px', fontWeight: '300' }}>
                        Moves Taken
                      </div>
                    </div>
                    <div style={{ width: '1px', height: '48px', backgroundColor: '#e5e7eb' }}></div>
                    <div>
                      <div style={{ fontSize: '36px', fontWeight: '300', color: '#111827' }}>
                        {state.moves_remaining ?? 6}
                      </div>
                      <div style={{ fontSize: '14px', color: '#6b7280', marginTop: '4px', fontWeight: '300' }}>
                        Moves Left
                      </div>
                    </div>
                  </div>
                )}

                {/* Instructions - Centered */}
                {!state?.completed && (
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ color: '#374151', fontWeight: '300', fontSize: '18px' }}>
                      Enter a movie and actor to connect them
                    </p>
                  </div>
                )}

                {/* Input Form - Centered */}
                {!state?.completed && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: '640px', margin: '0 auto', width: '100%' }}>
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
                        onChange={(e) => setActor(e.target.value)}
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

                {/* Results - Centered */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
                  {posterUrl && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <h3 style={{
                        fontSize: '14px',
                        fontWeight: '300',
                        color: '#6b7280',
                        marginBottom: '16px'
                      }}>
                        Movie Poster
                      </h3>
                      <img
                        src={posterUrl}
                        alt="Movie Poster"
                        style={{
                          maxWidth: '300px',
                          borderRadius: '16px',
                          border: '1px solid #e5e7eb',
                          boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)'
                        }}
                      />
                    </div>
                  )}

                  {graphImg && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <h3 style={{
                        fontSize: '14px',
                        fontWeight: '300',
                        color: '#6b7280',
                        marginBottom: '16px'
                      }}>
                        Connection Path
                      </h3>
                      <img
                        src={graphImg}
                        alt="Connection Graph"
                        style={{
                          width: '100%',
                          maxWidth: '900px',
                          borderRadius: '16px',
                          border: '1px solid #e5e7eb',
                          boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)',
                          backgroundColor: '#ffffff',
                          padding: '32px'
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* New Game Button - Centered */}
                {state && state.completed && (
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
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

function DifficultySelector() {
  const [difficulty, setDifficulty] = useState('Easy');
  const options = ['Easy', 'Normal', 'Hard', 'Genius'];
  
  return (
    <div style={{
      display: 'flex',
      gap: '12px',
      marginTop: '32px',
      padding: '6px',
      backgroundColor: '#f9fafb',
      borderRadius: '12px',
      border: '1px solid #e5e7eb'
    }}>
      {options.map((option) => (
        <button
          key={option}
          onClick={() => setDifficulty(option)}
          style={{
            padding: '10px 20px',
            backgroundColor: difficulty === option ? '#111827' : 'transparent',
            color: difficulty === option ? '#ffffff' : '#6b7280',
            fontSize: '14px',
            fontWeight: '300',
            borderRadius: '8px',
            border: 'none',
            cursor: 'pointer',
            transition: 'all 0.2s',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
          }}
          onMouseEnter={(e) => {
            if (difficulty !== option) {
              e.target.style.backgroundColor = '#f3f4f6';
            }
          }}
          onMouseLeave={(e) => {
            if (difficulty !== option) {
              e.target.style.backgroundColor = 'transparent';
            }
          }}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function ActorCard({ actor }) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '16px',
      padding: '24px',
      backgroundColor: '#f9fafb',
      borderRadius: '24px',
      border: '1px solid #e5e7eb',
      width: '256px',
      flexShrink: 0
    }}>
      {actor?.image && (
        <img
          src={actor.image}
          alt={actor?.name}
          style={{
            width: '128px',
            height: '128px',
            borderRadius: '16px',
            objectFit: 'cover',
            border: '2px solid #e5e7eb',
            boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1)'
          }}
        />
      )}
      <span style={{
        fontSize: '20px',
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