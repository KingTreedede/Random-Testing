// Pokémon Connections - Simple NYT Connections-like game with Pokémon
// Images: https://img.pokemondb.net/artwork/large/<name>.jpg
// Metadata: https://pokeapi.co/

// Basic list of Gen 1 pokémon names (national dex 1-151), in lowercase, hyphen-separated for multi-word names
// For brevity we include a subset of Gen 1 here; you can expand as desired.
const GEN1 = [
  "bulbasaur","ivysaur","venusaur","charmander","charmeleon","charizard","squirtle","wartortle","blastoise",
  "caterpie","metapod","butterfree","weedle","kakuna","beedrill","pidgey","pidgeotto","pidgeot","rattata","raticate",
  "pikachu","raichu","sandshrew","sandslash","nidoran-f","nidorina","nidoqueen","nidoran-m","nidorino","nidoking",
  "clefairy","clefable","vulpix","ninetales","jigglypuff","wigglytuff","zubat","golbat","oddish","gloom","vileplume",
  "paras","parasect","venonat","venomoth","diglett","dugtrio","meowth","persian","psyduck","golduck","mankey","primeape",
  "growlithe","arcanine","poliwag","poliwhirl","poliwrath","abra","kadabra","alakazam","machop","machoke","machamp",
  "bellsprout","weepinbell","victreebel","tentacool","tentacruel","geodude","graveler","golem","ponyta","rapidash",
  "slowpoke","slowbro","magnemite","magneton","farfetchd","doduo","dodrio","seel","dewgong","grimer","muk","shellder",
  "cloyster","gastly","haunter","gengar","onix","drowzee","hypno","krabby","kingler","voltorb","electrode","exeggcute",
  "exeggutor","cubone","marowak","hitmonlee","hitmonchan","lickitung","koffing","weezing","rhyhorn","rhydon","chansey",
  "tangela","kangaskhan","horsea","seadra","goldeen","seaking","staryu","starmie","mr-mime","scyther","jynx","electabuzz",
  "magmar","pinsir","tauros","magikarp","gyarados","lapras","ditto","eevee","vaporeon","jolteon","flareon","porygon",
  "omanyte","omastar","kabuto","kabutops","aerodactyl","snorlax","articuno","zapdos","moltres","dratini","dragonair",
  "dragonite","mewtwo","mew"
];

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

newGameBtn.addEventListener('click', startGame);
revealBtn.addEventListener('click', revealAnswers);
lockGroupBtn.addEventListener('click', lockSelection);
clearSelectionBtn.addEventListener('click', clearSelection);

startGame();

// --- Core Flow ---
async function startGame(){
  setStatus('Generating game...');
  resetState();
  // pick 4 "connection seeds" randomly: we'll create groups by type, generation (gen 1), evolution family, legendary/legendary-ish
  // For simplicity we will:
  // - Choose a few types and pick 4 Pokémon of that primary type
  // - Choose one evolution family with 4 members if possible
  // - Choose Legendary trio/group if possible
  // - Fill remaining groups by type
  try {
    // Build pool of candidates (Gen1 list)
    const pool = GEN1.slice();

    // We'll build 4 groups, each group = 4 names
    const groups = [];

    // 1) Try to build a type-based group: pick a common type that appears at least 4 times
    const typeGroup = await buildTypeGroup(pool, 4);
    if (typeGroup) {
      groups.push(typeGroup);
      removeFromPool(pool, typeGroup);
    }

    // 2) Try to build an evolution-family group of 3+ (some families might be 3, we'll allow mixing)
    const evoGroup = await buildEvolutionGroup(pool, 4);
    if (evoGroup) {
      // If evoGroup has less than 4, fill with same type or similar species
      if (evoGroup.length < 4) {
        const filler = await findSameTypeFiller(pool, evoGroup[0], 4 - evoGroup.length);
        groups.push(evoGroup.concat(filler));
        removeFromPool(pool, evoGroup.concat(filler));
      } else {
        groups.push(evoGroup.slice(0,4));
        removeFromPool(pool, evoGroup.slice(0,4));
      }
    }

    // 3) Legendary / birds group: try to pick legendaries (articuno, zapdos, moltres, mewtwo) etc
    const legendaryNames = ["articuno","zapdos","moltres","mewtwo","mew"];
    const legendGroup = legendaryNames.filter(n => pool.includes(n)).slice(0,4);
    if (legendGroup.length >= 2) {
      // If less than 4, fill with other rare pokemon
      while (legendGroup.length < 4) {
        const pop = pool.pop();
        if (!legendGroup.includes(pop)) legendGroup.push(pop);
      }
      groups.push(legendGroup);
      removeFromPool(pool, legendGroup);
    }

    // 4) Fill remaining groups by picking types randomly
    while (groups.length < 4) {
      const g = await buildTypeGroup(pool,4) || sampleArray(pool,4);
      groups.push(g);
      removeFromPool(pool, g);
    }

    // Now we have 4 groups of 4 names
    solutions = groups.map(g => g.map(n => n.toLowerCase()));
    const flat = solutions.flat();
    // Shuffle the flat list to populate board
    const shuffled = shuffle(flat.slice());

    // Build cardData with metadata fetched in parallel
    setStatus('Fetching Pokémon metadata (this may take a few seconds)...');
    const metaPromises = shuffled.map(name => fetchPokemonData(name));
    const metas = await Promise.all(metaPromises);
    cardData = shuffled.map((name, i) => {
      const meta = metas[i];
      return {
        name,
        imageUrl: getPokeDbArtworkUrl(name),
        metadata: meta,
        groupId: solutions.findIndex(g => g.includes(name)),
        locked: false
      };
    });

    renderBoard();
    setStatus('Game ready — find the 4 groups!');
  } catch (err) {
    console.error(err);
    setStatus('Error generating game. See console.');
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
    el.innerHTML = `
      <img src="${card.imageUrl}" alt="${card.name}" onerror="this.onerror=null;this.src='https://img.pokemondb.net/sprites/home/normal/${card.name}.png'"/>
      <div class="name">${card.name.replace(/-/g,' ')}</div>
      <div class="meta">${card.metadata && card.metadata.types ? card.metadata.types.map(t=>t.type.name).join(', ') : ''}</div>
    `;
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
    if (selected.length >= 4) {
      setStatus('You can select up to 4 Pokémon per group.');
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
  if (selected.length !== 4) {
    setStatus('Select exactly 4 Pokémon to lock as a group.');
    return;
  }
  // Check which solution group (if any) matches this selection
  const names = selected.map(i=>cardData[i].name);
  // Find if all have same solution group id
  const groupIds = new Set(names.map(n => solutions.findIndex(g => g.includes(n))));
  if (groupIds.size === 1) {
    // correct group
    const gid = groupIds.values().next().value;
    // mark these cards as locked
    selected.forEach(i => cardData[i].locked = true);
    // mark progress
    addProgressItem(`Group ${gid+1}: Correct` , true);
    setStatus('Correct! Group locked.');
    // remove group from solutions to avoid double-claim
    solutions[gid] = [];
    renderBoard();
    selected = [];
    renderSelection();
    checkWin();
  } else {
    addProgressItem(`Incorrect group: ${names.map(n=>n).join(', ')}` , false);
    setStatus('Not a correct group.');
    // mark briefly as wrong
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
  if (lockedCount === 16) {
    setStatus('Congratulations — you found all groups!');
  }
}

// Reveal answers by highlighting the correct groups and showing their connection hints
function revealAnswers(){
  // Reconstruct original groups: We'll use original solutions built earlier but some may have been cleared — we built savedSolutions earlier
  setStatus('Revealing answers...');
  // If solutions have been mutated (cleared when locked) we cannot rely on it; reconstruct mapping from cardData.groupId if present
  const groupMap = {};
  cardData.forEach(c => {
    const gid = c.groupId;
    if (gid == null) return;
    groupMap[gid] = groupMap[gid] || [];
    groupMap[gid].push(c.name);
  });
  // Highlight groups by border color, and show a modal-like status describing connection
  // We'll add a colored border to each locked / solution card
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
  // Provide simple hint lines: try to infer: if types common -> show type; if same species family -> "same family"; if legendary -> "legendary"
  const hints = Object.values(groupMap).map(garr => inferHintForGroup(garr));
  setStatus('Hints: ' + hints.map((h,i)=>`Group ${parseInt(i)+1}: ${h}`).join(' | '));
}

// --- Utility functions / group builders ---

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

function getPokeDbArtworkUrl(name){
  // pokemondb artwork path uses hyphenated lowercase names like 'mr-mime' -> 'mr-mime.jpg'
  return `https://img.pokemondb.net/artwork/large/${name}.jpg`;
}

async function fetchPokemonData(name){
  // Use PokéAPI to fetch types, species, and generation (via species endpoint)
  try {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon/${name}`);
    if (!res.ok) throw new Error('not found');
    const data = await res.json();
    // fetch species for generation
    const speciesRes = await fetch(data.species.url);
    const species = await speciesRes.json();
    return {
      name,
      types: data.types,
      species: species.name,
      is_legendary: species.is_legendary,
      generation: species.generation ? species.generation.name : null,
      evolution_chain: species.evolution_chain ? species.evolution_chain.url : null
    };
  } catch (err) {
    console.warn('Failed to fetch metadata for', name, err);
    return { name, types: [], is_legendary: false };
  }
}

async function buildTypeGroup(pool, size){
  // Try to find a type that appears at least `size` times among pool by sampling metadata
  const sample = pool.slice();
  shuffle(sample);
  // We'll fetch metadata in batches until we find a type group
  const typeCounts = {};
  const typeMembers = {};
  for (const name of sample) {
    const meta = await fetchPokemonData(name);
    const primaryType = meta.types && meta.types.length ? meta.types[0].type.name : null;
    if (!primaryType) continue;
    typeCounts[primaryType] = (typeCounts[primaryType] || 0) + 1;
    typeMembers[primaryType] = typeMembers[primaryType] || [];
    typeMembers[primaryType].push(name);
    if (typeMembers[primaryType].length >= size) {
      return typeMembers[primaryType].slice(0,size);
    }
  }
  return null;
}

async function buildEvolutionGroup(pool, minSize){
  // Find species that share the same evolution chain; use species endpoint evolution_chain
  // We'll sample pool, fetch species, then fetch evolution chains and pick those with >= minSize
  const chainMap = {}; // chainUrl -> array of names
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
    } catch (err) { continue; }
  }
  // If none large enough, return the largest found (could be 3 or 2)
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
  }
  while (matches.length < count) {
    const pick = pool.pop();
    if (!matches.includes(pick)) matches.push(pick);
  }
  return matches;
}

function inferHintForGroup(names){
  // Try to infer a human-friendly hint for a group by looking up the metadata in cardData or by fetching
  const metas = names.map(n => {
    const c = cardData.find(cd => cd.name === n);
    return c && c.metadata ? c.metadata : null;
  }).filter(Boolean);

  if (!metas.length) return 'Unknown';
  // Check if all share a primary type
  const firstType = metas[0].types && metas[0].types[0] && metas[0].types[0].type.name;
  if (firstType && metas.every(m => (m.types && m.types[0] && m.types[0].type.name) === firstType)) {
    return `All are ${firstType} type`;
  }
  // All same generation?
  const gen = metas[0].generation && metas[0].generation.name;
  if (gen && metas.every(m => (m.generation && m.generation.name) === gen)) {
    return `All from ${gen.replace('-',' ')}`;
  }
  // All legendary?
  if (metas.every(m => m.is_legendary)) return 'All Legendary';
  // All same species family?
  // If evolution_chain present and equal
  const chain = metas[0].evolution_chain;
  if (chain && metas.every(m => m.evolution_chain === chain)) return 'Same evolution family';
  // fallback
  return 'A shared connection';
}

function setStatus(txt){
  statusEl.textContent = txt;
}
