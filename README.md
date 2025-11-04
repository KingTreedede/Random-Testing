# Pokémon Connections — NYT-style connection game with Pokémon

What this is
- A small single-page web app that implements a "Connections" style game using Pokémon instead of words.
- The game creates 16 Pokémon split into 4 groups of 4 Pokémon each. Each group is defined by a shared connection (for example: same primary type, same generation, same evolutionary family, or both share Legendary status).
- Images are loaded from PokéDB (the artwork images at img.pokemondb.net). Additional metadata (types / generation / species) is fetched from the public PokéAPI to help form connections.

Notes / legal
- Images are loaded from pokemondb (img.pokemondb.net). Check PokéDB and Pokémon intellectual property rules if you plan to publish this widely.
- This app uses the public PokéAPI (https://pokeapi.co/) for metadata. Respect their API usage policy.
- This is a simple demo / learning project — you may want to add caching, error handling, or a backend for production.

How to run
1. Clone the repository or copy the files locally.
2. Open `index.html` in a modern browser. The app will fetch data from PokéAPI and images from PokéDB.
3. Click Pokémon to select; form groups of 4. When you think a group is correct, click "Lock Group". The app will tell you if it's correct. You may also "Reveal Answers".

Files
- index.html — UI
- style.css — small styles
- script.js — game logic and API calls
