# Game Rules

Learn how to play CineLinks and master the game!

## Table of Contents

- [Objective](#objective)
- [How to Play](#how-to-play)
- [Game Mechanics](#game-mechanics)
- [Scoring](#scoring)
- [Strategies](#strategies)
- [Example Games](#example-games)
- [Advanced Tips](#advanced-tips)

---

## Objective

**Connect two actors through a chain of movies they've appeared in.**

You start with an **Start Actor** and must reach the **Target Actor** by finding movies and actors that connect them.

Think of it as "Six Degrees of Kevin Bacon" meets a puzzle game!

---

## How to Play

### Step 1: Start a Game

Click **"Start New Game"** to receive:
- A **Start Actor** (your current position)
- A **Target Actor** (your goal)

These actors never appear in the same movie directly, so you'll need to find a path through other actors.

### Step 2: Make Your First Move

1. Think of a **movie** that your current actor (the Start Actor) appeared in
2. Think of **another actor** who also appeared in that same movie
3. Type both into the input fields (use autocomplete to help!)
4. Click **"Submit Guess"**

### Step 3: Continue the Chain

- If your guess is correct, the actor you selected becomes your new current position
- Now find a movie *that actor* appeared in
- Pick another actor from that movie
- Keep going until you reach the Target Actor!

### Step 4: Win or Lose

**You win if:**
- You successfully reach the Target Actor
- You do this before running out of attempts

**You lose if:**
- You make 3 incorrect guesses
- The game ends and you haven't reached the target

---

## Game Mechanics

### Valid Moves

A move is valid when:
1. The **movie** (by TMDb ID) exists in the comprehensive movie index
2. The **current actor** appeared in that movie (verified from comprehensive filmography)
3. The **new actor** also appeared in that movie (verified from comprehensive filmography)
4. Both actors are connected in the CineLinks actor-actor graph (neighbors)

**Note**: The game uses a comprehensive index of ALL filmographies, so even lesser-known shared movies between actors are valid!

### Invalid Moves

Common reasons moves fail:

| Error | Meaning | Example |
|-------|---------|---------|
| Movie not found | Movie doesn't exist in our database | Typing "Avengerz" instead of "Avengers" |
| Actor not in movie | The actor you chose wasn't in that movie | Saying Brad Pitt was in "The Avengers" |
| Movie not connected | Current actor wasn't in that movie | Saying Tom Hanks was in "Iron Man" |

**Tip**: Use the autocomplete feature! It only shows actors and movies that exist in the database.

### The Path

Your path through the game tracks actors you've visited:

```
Actor 1 → Actor 2 → Actor 3 → Target Actor
```

The movies you use to connect them are tracked separately in `movies_used`.

For example, if you go:
- Tom Hanks → (via "The Avengers") → Robert Downey Jr.
- Robert Downey Jr. → (via "Iron Man 2") → Scarlett Johansson

Your path is: `[Tom Hanks, Robert Downey Jr., Scarlett Johansson]`

Your movies_used are: `["The Avengers", "Iron Man 2"]`

### Attempts

You have **3 attempts** (incorrect guesses allowed):
- Each incorrect guess reduces your remaining attempts by 1
- At 0 attempts remaining, the game ends
- Correct guesses don't consume attempts

---

## Scoring

### Metrics

The game tracks:

| Metric | Description |
|--------|-------------|
| **Total Guesses** | Every move you make (correct or incorrect) |
| **Incorrect Guesses** | Number of failed attempts |
| **Remaining Attempts** | How many mistakes you can still make |
| **Path Length** | How many moves it took to win |

### Optimal Play

While there's no formal scoring system, you can challenge yourself:

- **Minimize moves**: Try to win in the fewest guesses
- **Perfect game**: Win without any incorrect guesses
- **Speed run**: Win as fast as possible

### Difficulty Factors

Games can vary in difficulty based on:
- **Actor popularity**: More popular actors have more connections
- **Era differences**: Actors from different eras are harder to connect
- **Genre specialization**: Actors who stick to one genre have fewer connections

---

## Strategies

### Beginner Strategies

1. **Use Hub Actors**: Think of actors who appear in many movies
   - Examples: Samuel L. Jackson, Robert Downey Jr., Scarlett Johansson
   - These actors are well-connected and often provide shortcuts

2. **Follow Franchises**: Use movie franchises as bridges
   - Marvel Cinematic Universe movies connect many actors
   - Other franchises: Fast & Furious, Ocean's movies, etc.

3. **Use the Autocomplete**: Type slowly and watch suggestions
   - Helps you find actors you didn't know were in movies
   - Prevents typos that waste attempts

### Intermediate Strategies

1. **Plan Ahead**: Don't just take the first path you see
   - Think 2-3 moves ahead
   - Is the actor you're moving to well-connected?

2. **Genre Bridging**: Use actors who work across genres
   - Action stars who also do drama
   - Comedic actors in serious films

3. **Avoid Dead Ends**: Some actors have limited connections
   - Check if the actor appears in franchise films
   - Avoid character actors with few credits

### Advanced Strategies

1. **Reverse Engineering**: Start from both ends
   - Think about movies the target actor is in
   - Find movies the start actor is in
   - Look for actors who could connect them

2. **Use Ensemble Casts**: Big ensemble movies are gold
   - "The Avengers" connects many Marvel actors
   - "Ocean's Eleven" connects many Hollywood stars
   - "Inception" has a star-studded cast

3. **Era Analysis**: Consider when actors were active
   - Modern actors → Use Marvel/DC movies
   - Classic actors → Use timeless films
   - Mixed eras → Find crossover actors

---

## Example Games

### Easy Game (2 moves)

```
Start: Tom Hanks → Target: Scarlett Johansson

Move 1: Tom Hanks → "Toy Story 4" → Tim Allen
Move 2: Tim Allen → "The Santa Clause 3" → Martin Short
❌ This doesn't work! Martin Short isn't connected to Scarlett

Better approach:
Move 1: Tom Hanks → "The Avengers" → Robert Downey Jr.
Move 2: Robert Downey Jr. → "Iron Man 2" → Scarlett Johansson
✅ You win in 2 moves!
```

### Medium Game (4 moves)

```
Start: Leonardo DiCaprio → Target: Samuel L. Jackson

Move 1: Leonardo DiCaprio → "Inception" → Tom Hardy
Move 2: Tom Hardy → "The Dark Knight Rises" → Gary Oldman
Move 3: Gary Oldman → "The Dark Knight" → Morgan Freeman
Move 4: Morgan Freeman → "The Avengers" → Samuel L. Jackson
✅ You win in 4 moves!
```

### Hard Game (5+ moves)

```
Start: Kate Winslet → Target: Chris Hemsworth

This requires careful planning as these actors don't share
obvious connections. You might need to go through:
Kate Winslet → Leonardo DiCaprio → Matt Damon → 
Ben Affleck → Robert Downey Jr. → Chris Hemsworth

Or find a shorter path using less obvious connections!
```

---

## Advanced Tips

### Know Your Graph

The CineLinks graph contains:
- **~9,720 total actors** from popular movies
- **~1,000 playable actors** (selected by centrality - well-connected)
- **~100 starting pool actors** (selected by StartActorScore - most recognizable)
- **~1,681 movies** in the comprehensive index
- **~71,565 connections** (actor-to-actor collaborations)

This means:
- Not every actor is in the database
- Not every movie is included
- Focus on popular, recognizable actors and blockbusters
- Starting actor pairs are always from the 100 most recognizable actors

### Common "Hub" Actors

These actors are exceptionally well-connected:

**Marvel Universe:**
- Robert Downey Jr. (Iron Man)
- Scarlett Johansson (Black Widow)
- Samuel L. Jackson (Nick Fury)
- Chris Hemsworth (Thor)

**Versatile Stars:**
- Tom Hanks (wide range of films)
- Brad Pitt (many genres)
- Matt Damon (action and drama)
- Leonardo DiCaprio (varied filmography)

**Character Actors:**
- Gary Oldman (many films)
- Morgan Freeman (diverse roles)
- Ben Kingsley (extensive career)

### Common "Bridge" Movies

These movies connect many actors:

**Superhero Films:**
- The Avengers series
- Justice League
- Spider-Man films

**Ensemble Casts:**
- Ocean's series
- Inception
- The Departed
- Love Actually

**Big Productions:**
- Dunkirk
- Interstellar
- The Dark Knight trilogy

### When You're Stuck

If you can't find a path:

1. **Think bigger productions**: Blockbusters have larger casts
2. **Consider recent films**: More actors share recent movies
3. **Use franchise films**: Connect through Marvel, DC, Fast & Furious
4. **Try different genres**: The actor might have done one action film
5. **Use the autocomplete**: Type actor names to see what's available

### Practice Makes Perfect

- Play multiple games to learn the graph
- Remember successful paths for future games
- Notice which actors are "hubs" in your games
- Learn which movies have ensemble casts

---

## Game Variants (Future Ideas)

While not currently implemented, here are fun variants:

### Speed Mode
- Timer counting up
- Try to beat your best time

### Hard Mode
- Only 1 incorrect guess allowed
- No autocomplete
- Longer minimum path required

### Hint System
- Spend points for hints
- Show possible next movies
- Reveal shortest path length

### Multiplayer
- Race against another player
- Same start and end actors
- First to connect wins

### Daily Challenge
- Everyone gets the same puzzle
- Compare scores globally
- New puzzle each day

---

## Frequently Asked Questions

### Q: Why isn't [Actor Name] in the game?

**A**: The game prioritizes recognizable actors for starting pairs (100 actors selected by StartActorScore). Less popular actors might be in the full graph (~9,720 actors) but won't appear as starting/target actors. Use autocomplete to see what's available.

### Q: I know this actor was in this movie, why doesn't it work?

**A**: The actor or movie might not be in our database. Use autocomplete to see what's available.

### Q: What if there's no path between the actors?

**A**: The game only starts with actor pairs that have a valid connection path. There's always a solution!

### Q: Can I replay the same puzzle?

**A**: Currently no, but each game generates random actor pairs so there are thousands of possible combinations.

### Q: How is the graph built?

**A**: We fetch data from TMDb, select popular actors, and build a network of their movie connections. See [INSTALLATION.md](INSTALLATION.md) for details.

---

## Tips Summary

✅ **DO:**
- Use autocomplete to avoid typos
- Think about popular, well-connected actors
- Consider franchise films (Marvel, DC, etc.)
- Plan 2-3 moves ahead
- Use actors who work across many genres

❌ **DON'T:**
- Guess without using autocomplete
- Pick character actors with few credits
- Forget to check remaining attempts
- Rush - take time to think
- Give up if stuck - try different genres!

---

**Ready to play? Start connecting actors and have fun!** 🎬✨

[Back to Main README](../README.md) | [Troubleshooting](TROUBLESHOOTING.md)