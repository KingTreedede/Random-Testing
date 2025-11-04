// Pokémon Connections - NYT Connections-like game (Generations 1–7)
// Updated: use PokéAPI generation endpoints to build a pool of Pokémon through Gen 7
// Images: https://img.pokemondb.net/artwork/large/<name>.jpg
// Metadata: https://pokeapi.co/
//
// Notes:
// - Instead of hardcoding Gen1 names, this script queries PokéAPI generation endpoints (1..7)
//   to build the candidate pool dynamically. This keeps the repo smaller and supports many
//   generations without embedding thousands of names.
// - PokéAPI rate limits can still apply. This script fetches species lists first and then
//   only fetches per-Pokémon metadata for the selected candidates (max 16 per game).
// - We normalize names for PokéDB artwork, include a small exceptions map, and provide
//   fallbacks to other sprite sources if artwork 404s.

const MAX_GROUPS = 4;
const GROUP_SIZE = 4;
const MAX_BOARD = MAX_GROUPS * GROUP_SIZE;
const MAX_GEN = 7; // include generations 1..7

// Small exceptions map for pokemondb artwork filenames
const POKE_DB_EXCEPTIONS = {
  "type-null": "type-null",
  "jangmo-o": "jangmo-o",
  "hakamo-o": "hakamo-o",
  "kommo-o": "kommo-o",
  "tapu-koko": "tapu-koko",
  "tapu-lele": "tapu-lele",
  "tapu-bulu": "tapu-bulu",
  "tapu-fini": "tapu-fini",
  "mr-mime": "mr-mime",
  "mime-jr": "mime-jr",
  "farfetchd": "farfetchd",
  "nidoran-f": "nidoran-f",
  "nidoran-m": "nidoran-m"
};

// Helpers for DOM
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

const boardEl = $('#board');
const newGameBtn = $('#newGameBtn');
const revealBtn = $('#revealBtn');
const statusEl = $('#status');
const selectionEl = $('#selection');
const lockGroupBtn = $('#lockGroupBtn');
const clearSelectionBtn = $('#clearSelectionBtn');
const progressEl = $('#progress');

let cardData = []; // {name, imageUrl, metadata, groupId, locked}
let selected = [];
let solutions = []; // array of 4 groups each array of names
let poolCache = null; // cached pool of species names (lowercase, pokeapi species names)

// Attach UI handlers early so they exist even if init errors
newGameBtn.addEventListener('click', startGame);
revealBtn.addEventListener('click', revealAnswers);
lockGroupBtn.addEventListener('click', lockSelection);
clearSelectionBtn.addEventListener('click', clearSelection);

// Kick off initial game
startGame();

// --- Core Flow ---
async function startGame(){
  setStatus('Generating game...');
  resetState();
  try {
    // Build or reuse pool of species names for gens 1..MAX_GEN
    const pool = await getPoolForGens(1, MAX_GEN);
    if (!pool || pool.length < MAX_BOARD) {
      throw new Error(`Not enough Pokémon in pool (${pool ? pool.length : 0})`);
    }

    // Choose MAX_GROUPS groups of GROUP_SIZE each
    const candidatePool = pool.slice();
    shuffle(candidatePool);

    const groups = [];

    // 1) Type-based group if possible
    const typeGroup = await buildTypeGroup(candidatePool, GROUP_SIZE);
    if (typeGroup) { groups.push(typeGroup); removeFromPool(candidatePool, typeGroup); }

    // 2) Evolution-family group
    const evoGroup = await buildEvolutionGroup(candidatePool, GROUP_SIZE);
    if (evoGroup) {
      if (evoGroup.length < GROUP_SIZE) {
        const filler = await findSameTypeFiller(candidatePool, evoGroup[0], GROUP_SIZE - evoGroup.length);
        groups.push(evoGroup.concat(filler));
        removeFromPool(candidatePool, evoGroup.concat(filler));
      } else {
        groups.push(evoGroup.slice(0, GROUP_SIZE));
        removeFromPool(candidatePool, evoGroup.slice(0, GROUP_SIZE));
      }
    }

    // 3) Legendary-ish group (try to pick legendaries in pool)
    const candidateLegends = ['articuno','zapdos','moltres','mewtwo','mew','lugia','ho-oh','suicune','entei','raikou','regirock','regice','registeel','latias','latios','hoopa','zacian','zamazenta']; // extended sample
    const legendGroup = candidateLegends.filter(n => candidatePool.includes(n)).slice(0, GROUP_SIZE);
    if (legendGroup.length >= 2) {
      while (legendGroup.length < GROUP_SIZE) {
        const pop = candidatePool.pop();
        if (!legendGroup.includes(pop)) legendGroup.push(pop);
      }
      groups.push(legendGroup);
      removeFromPool(candidatePool, legendGroup);
    }

    // 4) Fill remaining groups by type or random picks
    while (groups.length < MAX_GROUPS) {
      const g = await buildTypeGroup(candidatePool, GROUP_SIZE) || sampleArray(candidatePool, GROUP_SIZE);
      groups.push(g);
      removeFromPool(candidatePool, g);
    }

    solutions = groups.map(g => g.map(n => n.toLowerCase()));
    const flat = solutions.flat();
    const shuffled = shuffle(flat.slice());

    setStatus('Fetching Pokémon metadata (this may take a few seconds)...');
    // fetch metadata (only for chosen Pokémon)
    const metaPromises = shuffled.map(name => fetchPokemonData(name));
    const metas = await Promise.all(metaPromises);

    cardData = shuffled.map((name, i) => {
      const meta = metas[i];
      const imgUrl = getPokeDbArtworkUrl(name);
      return {
        name,
        imageUrl: imgUrl,
        metadata: meta,
        groupId: solutions.findIndex(g => g.includes(name)),
        locked: false
      };
    });

    renderBoard();
    setStatus('Game ready — find the 4 groups!');
  } catch (err) {
    console.error(err);
    setStatus('Error generating game. See console for details.');
  }
}

function resetState(){
  cardData = [];
  selected = [];
  solutions = [];
  boardEl.innerHTML = '';
  selectionEl.innerHTML = '';
  progressEl.innerHTML = '';
  statusEl.textContent = '';
}

function renderBoard(){
  boardEl.innerHTML = '';
  cardData.forEach((card, idx) => {
    const el = document.createElement('button');
    el.className = 'pokemon-card';
    el.dataset.name = card.name;
    el.dataset.idx = idx;
    if (card.locked) el.classList.add('locked');

    // Use safer onerror fallback chain: pokemondb artwork -> pokedb sprite -> pokeapi official artwork (if id)
    const img = document.createElement('img');
    img.src = card.imageUrl;
    img.alt = card.name.replace(/-/g,' ');
    img.dataset.idx = idx;
    img.addEventListener('error', function onErr(){
      this.removeEventListener('error', onErr);
      // first fallback: sprites home normal on pokemondb
      const fallback1 = `https://img.pokemondb.net/sprites/home/normal/${card.name}.png`;
      this.src = fallback1;
      // add a second error handler to try pokeapi official artwork (requires id)
      this.addEventListener('error', function onErr2(){
        this.removeEventListener('error', onErr2);
        const id = card.metadata && card.metadata.id;
        if (id) {
          this.src = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;
        }
      });
    });

    const nameDiv = document.createElement('div');
    nameDiv.className = 'name';
    nameDiv.textContent = card.name.replace(/-/g,' ');

    const metaDiv = document.createElement('div');
    metaDiv.className = 'meta';
    metaDiv.textContent = (card.metadata && card.metadata.types) ? card.metadata.types.map(t => t.type.name).join(', ') : '';

    el.appendChild(img);
    el.appendChild(nameDiv);
    el.appendChild(metaDiv);

    el.addEventListener('click', ()=>onCardClick(idx, el));
    boardEl.appendChild(el);
  });
  updateProgress();
}

function onCardClick(idx, el){
  const card = cardData[idx];
  if (card.locked) return;
  // toggle selection
  const selIndex = selected.indexOf(idx);
  if (selIndex >= 0) {
    selected.splice(selIndex,1);
    el.classList.remove('selected');
  } else {
    if (selected.length >= GROUP_SIZE) {
      setStatus(`You can select up to ${GROUP_SIZE} Pokémon per group.`);
      return;
    }
    selected.push(idx);
    el.classList.add('selected');
  }
  renderSelection();
}

function renderSelection(){
  selectionEl.innerHTML = '';
  selected.forEach(i => {
    const c = cardData[i];
    const d = document.createElement('div');
    d.className = 'mini';
    d.innerHTML = `<img src="${c.imageUrl}" alt="${c.name}" /><div>${c.name.replace(/-/g,' ')}</div>`;
    selectionEl.appendChild(d);
  });
}

async function lockSelection(){
  if (selected.length !== GROUP_SIZE) {
    setStatus(`Select exactly ${GROUP_SIZE} Pokémon to lock as a group.`);
    return;
  }
  const names = selected.map(i=>cardData[i].name);
  const groupIds = new Set(names.map(n => solutions.findIndex(g => g.includes(n))));
  if (groupIds.size === 1) {
    const gid = groupIds.values().next().value;
    selected.forEach(i => cardData[i].locked = true);
    addProgressItem(`Group ${gid+1}: Correct` , true);
    setStatus('Correct! Group locked.');
    solutions[gid] = [];
    renderBoard();
    selected = [];
    renderSelection();
    checkWin();
  } else {
    addProgressItem(`Incorrect group: ${names.join(', ')}` , false);
    setStatus('Not a correct group.');
    selected.forEach(i => {
      const el = boardEl.querySelector(`button[data-idx="${i}"]`);
      if (el) {
        el.classList.add('wrong');
        setTimeout(()=>el.classList.remove('wrong'), 800);
      }
    });
  }
}

function addProgressItem(text, ok){
  const li = document.createElement('li');
  li.textContent = text;
  li.style.background = ok ? 'rgba(40,199,111,0.12)' : 'rgba(255,107,107,0.08)';
  progressEl.appendChild(li);
}

function clearSelection(){
  selected.forEach(i=>{
    const el = boardEl.querySelector(`button[data-idx="${i}"]`);
    if (el) el.classList.remove('selected');
  });
  selected = [];
  renderSelection();
  setStatus('');
}

function checkWin(){
  const lockedCount = cardData.filter(c => c.locked).length;
  if (lockedCount === MAX_BOARD) {
    setStatus('Congratulations — you found all groups!');
  }
}

function revealAnswers(){
  setStatus('Revealing answers...');
  const groupMap = {};
  cardData.forEach(c => {
    const gid = c.groupId;
    if (gid == null) return;
    groupMap[gid] = groupMap[gid] || [];
    groupMap[gid].push(c.name);
  });
  $$('.pokemon-card').forEach(el => el.style.borderColor = 'transparent');
  Object.keys(groupMap).forEach((gid, idx) => {
    const names = groupMap[gid];
    names.forEach(name => {
      const cardEl = boardEl.querySelector(`.pokemon-card[data-name="${name}"]`);
      if (cardEl) {
        const colors = ['#ffd600','#00d1ff','#ff7ab6','#9aff7a'];
        cardEl.style.borderColor = colors[idx % colors.length];
      }
    });
  });
  const hints = Object.values(groupMap).map(garr => inferHintForGroup(garr));
  setStatus('Hints: ' + hints.map((h,i)=>`Group ${parseInt(i)+1}: ${h}`).join(' | '));
}

// --- Pool building and group heuristics ---

// Get a pool of species names from generation endpoints [fromGen .. toGen], cached
async function getPoolForGens(fromGen = 1, toGen = MAX_GEN){
  if (poolCache) return poolCache.slice();
  const pool = [];
  try {
    for (let g = fromGen; g <= toGen; g++) {
      const genUrl = `https://pokeapi.co/api/v2/generation/${g}`;
      const res = await fetch(genUrl);
      if (!res.ok) {
        console.warn('Failed to fetch generation', g, res.status);
        continue;
      }
      const genData = await res.json();
      if (genData && genData.pokemon_species) {
        // species have names like 'bulbasaur' — normalize to lower-case and hyphenated form
        genData.pokemon_species.forEach(s => {
          if (s && s.name) pool.push(s.name.toLowerCase());
        });
      }
      // small delay to be polite to API
      await delay(120);
    }
  } catch (err) {
    console.warn('Error building pool', err);
  }
  // remove duplicates and sort
  const unique = Array.from(new Set(pool));
  poolCache = unique;
  return unique.slice();
}

async function fetchPokemonData(name){
  try {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${name}`);
    if (!res.ok) throw new Error(`not found: ${name}`);
    const data = await res.json();
    // species for generation and is_legendary/evolution chain
    let species = null;
    try {
      const speciesRes = await fetch(data.species.url);
      species = await speciesRes.json();
    } catch (err) {
      species = null;
    }
    return {
      id: data.id,
      name,
      types: data.types || [],
      species: species ? species.name : null,
      is_legendary: species ? species.is_legendary : false,
      generation: species && species.generation ? species.generation.name : null,
      evolution_chain: species && species.evolution_chain ? species.evolution_chain.url : null
    };
  } catch (err) {
    console.warn('Failed to fetch metadata for', name, err);
    return { name, id: null, types: [], is_legendary: false };
  }
}

async function buildTypeGroup(pool, size){
  const sample = pool.slice();
  shuffle(sample);
  const typeMembers = {};
  for (const name of sample) {
    try {
      const meta = await fetchPokemonData(name);
      const primaryType = meta.types && meta.types.length ? meta.types[0].type.name : null;
      if (!primaryType) continue;
      typeMembers[primaryType] = typeMembers[primaryType] || [];
      typeMembers[primaryType].push(name);
      if (typeMembers[primaryType].length >= size) {
        return typeMembers[primaryType].slice(0, size);
      }
      // be polite to the API
      await delay(60);
    } catch (err) {
      continue;
    }
  }
  return null;
}

async function buildEvolutionGroup(pool, minSize){
  const chainMap = {};
  for (const name of pool) {
    try {
      const p = await fetchPokemonData(name);
      const chainUrl = p.evolution_chain;
      if (!chainUrl) continue;
      chainMap[chainUrl] = chainMap[chainUrl] || [];
      chainMap[chainUrl].push(name);
      if (chainMap[chainUrl].length >= minSize) {
        return chainMap[chainUrl].slice(0, minSize);
      }
      await delay(60);
    } catch (err) { continue; }
  }
  let best = [];
  for (const k of Object.keys(chainMap)) {
    if (chainMap[k].length > best.length) best = chainMap[k];
  }
  return best.length ? best : null;
}

async function findSameTypeFiller(pool, referenceName, count){
  const meta = await fetchPokemonData(referenceName);
  const targetType = meta.types && meta.types[0] && meta.types[0].type.name;
  if (!targetType) return sampleArray(pool, count);
  const matches = [];
  for (const name of pool) {
    const m = await fetchPokemonData(name);
    const t = m.types && m.types[0] && m.types[0].type.name;
    if (t === targetType) matches.push(name);
    if (matches.length >= count) break;
    await delay(40);
  }
  while (matches.length < count && pool.length) {
    const pick = pool.pop();
    if (!matches.includes(pick)) matches.push(pick);
  }
  return matches;
}

// --- Utility functions ---

function sampleArray(arr, n){
  const a = arr.slice();
  shuffle(a);
  return a.slice(0,n);
}
function shuffle(a){ for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]} return a }
function removeFromPool(pool, items){
  items.forEach(it => {
    const idx = pool.indexOf(it);
    if (idx >= 0) pool.splice(idx,1);
  });
}
function delay(ms){ return new Promise(res=>setTimeout(res, ms)); }

function normalizeForPokeDb(name){
  if (!name) return name;
  const n = name.toLowerCase().trim();
  if (POKE_DB_EXCEPTIONS[n]) return POKE_DB_EXCEPTIONS[n];
  return n.replace(/\s+/g,'-').replace(/['.]/g,'').replace(/_+/g,'-');
}

function getPokeDbArtworkUrl(name){
  const n = normalizeForPokeDb(name);
  return `https://img.pokemondb.net/artwork/large/${n}.jpg`;
}

function inferHintForGroup(names){
  const metas = names.map(n => {
    const c = cardData.find(cd => cd.name === n);
    return c && c.metadata ? c.metadata : null;
  }).filter(Boolean);

  if (!metas.length) return 'Unknown';
  const firstType = metas[0].types && metas[0].types[0] && metas[0].types[0].type.name;
  if (firstType && metas.every(m => (m.types && m.types[0] && m.types[0].type.name) === firstType)) {
    return `All are ${firstType} type`;
  }
  const gen = metas[0].generation && metas[0].generation.name;
  if (gen && metas.every(m => (m.generation && m.generation.name) === gen)) {
    return `All from ${gen.replace('-',' ')}`;
  }
  if (metas.every(m => m.is_legendary)) return 'All Legendary';
  const chain = metas[0].evolution_chain;
  if (chain && metas.every(m => m.evolution_chain === chain)) return 'Same evolution family';
  return 'A shared connection';
}

function setStatus(txt){
  statusEl.textContent = txt;
}

function updateProgress(){
  // placeholder for future progress UI
}
