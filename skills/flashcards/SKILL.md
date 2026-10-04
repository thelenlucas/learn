---
name: flashcards
description: "End-of-session spaced-repetition cards. Use when a teaching session is wrapping up (goal reached, the user says they're done, or /flashcards is run): turn the session's dependency graph into a small set of high-quality cards and save them with save_flashcards to the user's Obsidian Spaced Repetition deck."
---

# Flashcards

The teach skill builds a dependency graph in his head. Spaced repetition keeps it there. The cards are a *maintenance schedule for that graph*: they test the **nodes** (unconditional truths, key derived facts) and, more importantly, the **edges** (why one thing follows from another). A deck of isolated trivia would rebuild exactly the pile of lonely facts the teaching was meant to replace. Don't write that deck.

## When

Once, at the end of a session, after the last node's quiz-check has passed. Also whenever he runs `/flashcards`. If the session taught nothing durable (pure Q&A, logistics), say so and skip it.

## What to card (in priority order)

1. **Roots.** Each unconditional truth from the plan's dependency map, stated so it can be accepted at face value. Universal statements and real definitions make the best cards.
2. **Edges.** For each important derived node: *"Why does B follow from A?"*, *"What problem forces us to introduce B?"*, *"Starting from A, how could you have discovered B?"* The answer is the motivated step, compressed.
3. **Misses.** Every quiz he got wrong or answered "I don't know" during this session, including Phase 1 probing, if it falls inside the goal's scope. Target the *misconception* he actually showed. Ask the question that separates the wrong model from the right one, not just the fact he missed.
4. **The click.** If the session had a compressing insight (many facts collapsing into one generating idea), card it as such: *"What single idea generates X, Y and Z?"*

Skip anything he can derive in seconds from a carded root. That's the point of having roots.

## How to write each card

- **One idea per card (minimum information).** If the answer has an "and", split it. Answers should be short: a phrase, a formula, one or two sentences.
- **Unambiguous prompt.** Only one correct answer should fit the front. Add context ("In TCP, …", "For a linear map $T$, …") so the card still makes sense months from now, outside the session.
- **Ask for understanding, not wording.** Prefer *why / what follows / what would break if* over *what is the name of*. Keep the answer gradable: he must be able to tell right from wrong himself.
- **No lists or enumerations.** If something really is a set, use overlapping cloze cards or redesign it around the principle that generates the set.
- **Self-contained answers.** The back may include a short "because …" when the reason *is* the knowledge being tested. Don't pad.
- **Math in LaTeX** (`$...$`, `$$...$$`), same as the rest of the vault.
- **Kinds:**
  - `basic`: the default.
  - `reversed`: only for true two-way pairs where both directions are worth recalling (term ⇄ definition, symbol ⇄ meaning). Never for why-questions.
  - `cloze`: for a key sentence or formula where a specific piece is the thing to recall. Wrap each deletion in `==...==`. Keep deletions small and few.
- **Format constraints** (enforced by the tool; invalid cards are skipped and reported): no blank lines inside a card, no `::`, no line consisting only of `?`/`??`, and `==highlight==` only inside cloze cards.

## Size

Usually 5–15 cards. Scale with what was actually locked in, not with how long the session ran. Fewer good cards beat many weak ones, because every card costs review time for years.

## Process

1. Re-read the plan's dependency map and the session's quiz results (the md-log file, if linked, has all of it).
2. Draft the cards following the priorities above.
3. Audit cold: read each front as if it were six months from now. Is it unambiguous? Is the answer one idea? Does it test an edge or root rather than trivia? Fix or drop.
4. Call `save_flashcards` **once** with `topic` (short session title) and all `cards`.
5. If it reports invalid cards, fix and resubmit only those. Ignore "already in deck".
6. Tell him in one line how many cards went where. Don't reprint the deck.
