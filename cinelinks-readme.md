# CineLinks

**Connect actors through the movies they starred in together!**

CineLinks is a game inspired by "Six Degrees of Kevin Bacon" where players connect two actors by finding a chain of movies they've appeared in. Built with TMDb data, React, and FastAPI.

![CineLinks Game](https://img.shields.io/badge/Status-Ready-green) ![Python](https://img.shields.io/badge/Python-3.9+-blue) ![React](https://img.shields.io/badge/React-18+-blue)

## 🎮 How to Play

1. **Start**: You're given two actors to connect
2. **Make Moves**: 
   - Pick a movie the current actor appeared in
   - Pick another actor from that movie
3. **Win**: Reach the target actor before running out of attempts!

### Example Game

```
Start: Tom Hanks → Target: Scarlett Johansson

Move 1: Tom Hanks → "The Avengers" → Robert Downey Jr.
Move 2: Robert Downey Jr. → "Iron Man 2" → Scarlett Johansson
✓ You win in 2 moves!
```

## ✨ Features

- 🎬 **Real TMDb Data** - Actual actors and movies from The Movie Database
- 🔍 **Smart Autocomplete** - Find actors and movies as you type
- 📊 **Path Visualization** - See your connection path as a graph
- 🎯 **Challenge Mode** - Limited attempts to make it interesting
- 💫 **Beautiful UI** - Modern, responsive design with smooth animations

## 🚀 Quick Start

### Prerequisites

- Python 3.9+
- Node.js 18+
- TMDb API Key ([Get one free](https://www.themoviedb.org/settings/api))

### 1. Build the Actor-Movie Graph

```bash
cd build
python -m venv venv
source venv/bin/activate  # On Windows: .\venv\Scripts\Activate.ps1
pip install -r requirements-build.txt

# Create .env with your TMDb API key
echo "TMDB_API_KEY=your_key_here" > .env

# Build the graph (~5-10 minutes)
python build_actor_movie_graph.py --out ../backend/global_actor_movie_graph.gpickle --top 150
```

### 2. Start the Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: .\venv\Scripts\Activate.ps1
pip install -r requirements.txt

# Start the API server
uvicorn main:app --reload
```

API will be available at `http://localhost:8000`

### 3. Start the Frontend

```bash
cd frontend
npm install

# Create .env with API URL
echo "VITE_API_URL=http://localhost:8000" > .env

# Start development server
npm run dev
```

Open `http://localhost:5173` in your browser!

## 📁 Project Structure

```
cinelinks/
├── README.md                  # This file
├── docs/
│   ├── INSTALLATION.md        # Detailed installation guide
│   ├── API.md                 # API reference
│   ├── GAME_RULES.md          # How to play
│   └── TROUBLESHOOTING.md     # Common issues and solutions
├── build/
│   ├── build_actor_movie_graph.py  # Graph builder script
│   ├── verify_graph.py             # Graph verification
│   └── requirements-build.txt
├── backend/
│   ├── main.py                     # FastAPI server
│   ├── game_logic.py               # Game mechanics
│   └── requirements.txt
└── frontend/
    ├── src/
    │   └── App.jsx                 # React app
    └── package.json
```

## 📖 Documentation

- **[Installation Guide](docs/INSTALLATION.md)** - Detailed setup instructions
- **[API Reference](docs/API.md)** - Complete API documentation
- **[Game Rules](docs/GAME_RULES.md)** - How to play and scoring
- **[Troubleshooting](docs/TROUBLESHOOTING.md)** - Common issues and fixes

## 🛠️ Technology Stack

### Backend
- **FastAPI** - Modern Python web framework
- **NetworkX** - Graph data structure and algorithms
- **Matplotlib** - Path visualization
- **TMDb API** - Movie and actor data

### Frontend
- **React** - UI framework
- **Tailwind CSS** - Styling
- **Vite** - Build tool

### Data Pipeline
- **Python** - Data fetching and processing
- **TMDb API** - Source data
- **NetworkX** - Graph construction

## 🎯 Graph Statistics

With default settings (`--top 150`):
- **Actors**: ~150 popular actors
- **Movies**: ~2,700 movies
- **Connections**: ~8,500 actor-movie edges
- **Build Time**: ~8 minutes
- **File Size**: ~4-5 MB

## 🔧 Configuration

### Adjust Graph Size

```bash
# Smaller graph (faster build, easier games)
python build_actor_movie_graph.py --top 100

# Larger graph (more variety, harder games)
python build_actor_movie_graph.py --top 200
```

### Adjust Game Difficulty

Edit `backend/main.py`:

```python
MovieConnectionGame(
    GRAPH, a1, a2,
    max_incorrect_guesses=5,  # Easier: more attempts
    # max_incorrect_guesses=1, # Harder: one mistake
)
```

## 🐛 Troubleshooting

### "Graph not ready" error
- Make sure `global_actor_movie_graph.gpickle` exists in `backend/`
- Rebuild the graph if corrupted

### No autocomplete suggestions
- Backend must be running
- Check `VITE_API_URL` in frontend `.env`

### Build takes too long
- Use cached data (don't use `--force-refresh`)
- Reduce number of actors with `--top 100`

See [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for more solutions.

## 🤝 Contributing

Contributions welcome! Common areas:

- **New Game Modes** - Time trials, hint system, multiplayer
- **UI Themes** - Dark mode, custom color schemes
- **Data Sources** - Add TV shows, directors, etc.
- **Analytics** - Track statistics and leaderboards

## 📝 License

MIT License - feel free to use this project however you'd like!

## 🙏 Credits

- **[TMDb](https://www.themoviedb.org/)** - Movie and actor data
- **[NetworkX](https://networkx.org/)** - Graph algorithms
- **[FastAPI](https://fastapi.tiangolo.com/)** - Backend framework
- **[React](https://react.dev/)** - Frontend framework
- **[Tailwind CSS](https://tailwindcss.com/)** - Styling

## 📧 Support

Having issues? Check our [Troubleshooting Guide](docs/TROUBLESHOOTING.md) or review the backend logs for error messages.

---

**Made with ❤️ for movie lovers and puzzle enthusiasts**

🎬 Start connecting actors and have fun! ✨