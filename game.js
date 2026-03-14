'use strict';

// ── Constants ──────────────────────────────────────────────────────────────
const OPS = ['+', '-', '*', '/'];
const OP_SYMBOLS = { '+': '+', '-': '−', '*': '×', '/': '÷' };
const MAX_PATH_LEN = 6;   // up to 6 numbers (5 operators)
const MAX_TARGET = 999;
const MIN_TARGET = 10;    // 2+ digit targets for challenge

// ── State ──────────────────────────────────────────────────────────────────
let G = {};   // game state
let timerInterval = null;
let toastTimeout = null;
let selectedPlayerCount = 2;

function freshState(playerCount) {
  const grid = makeGrid();
  const targets = makeTargets(grid);
  return {
    grid,
    targets,        // [{value, owner: null | 0 | 1}]
    path: [],       // selected cell indices
    ops: [],        // operators between cells (ops.length === path.length - 1)
    player: 0,      // current player (0 or 1)
    scores: [[], []], // target indices claimed by each player
    playerCount,
    gameOver: false,
    elapsed: 0,     // seconds (solo timer)
  };
}

// ── Grid ───────────────────────────────────────────────────────────────────
function makeGrid() {
  return Array.from({ length: 25 }, () => Math.floor(Math.random() * 10));
}

// ── Adjacency ──────────────────────────────────────────────────────────────
function isAdjacent(a, b) {
  const ar = (a / 5) | 0, ac = a % 5;
  const br = (b / 5) | 0, bc = b % 5;
  return Math.abs(ar - br) <= 1 && Math.abs(ac - bc) <= 1 && a !== b;
}

function adjacentOf(idx) {
  const r = (idx / 5) | 0, c = idx % 5;
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < 5 && nc >= 0 && nc < 5) out.push(nr * 5 + nc);
    }
  }
  return out;
}

// ── Left-to-right evaluation ───────────────────────────────────────────────
// Returns null for invalid (div-by-zero, non-integer division)
function evalLR(nums, ops) {
  let result = nums[0];
  for (let i = 0; i < ops.length; i++) {
    const n = nums[i + 1];
    switch (ops[i]) {
      case '+': result += n; break;
      case '-': result -= n; break;
      case '*': result *= n; break;
      case '/':
        if (n === 0 || result % n !== 0) return null;
        result /= n;
        break;
    }
  }
  return result;
}

// ── Target generation ──────────────────────────────────────────────────────
function makeTargets(grid) {
  const achievable = computeAchievable(grid);
  let candidates = achievable.filter(v => v >= MIN_TARGET && v <= MAX_TARGET);
  if (candidates.length < 3) {
    candidates = achievable.filter(v => v >= 1 && v <= MAX_TARGET);
  }
  if (candidates.length < 3) {
    // Extremely rare fallback – just pick any 3 reachable values
    candidates = achievable.filter(v => v >= 1);
  }
  if (candidates.length < 3) {
    // Absolute last resort
    return [{ value: 12, owner: null }, { value: 34, owner: null }, { value: 56, owner: null }];
  }
  // Shuffle and pick 3 distinct values
  shuffle(candidates);
  const picked = [];
  const seen = new Set();
  for (const v of candidates) {
    if (!seen.has(v)) { seen.add(v); picked.push({ value: v, owner: null }); }
    if (picked.length === 3) break;
  }
  return picked;
}

function computeAchievable(grid) {
  const results = new Set();

  function dfs(path, visited) {
    if (path.length >= 2) collectValues(path, grid, results);
    if (path.length >= MAX_PATH_LEN) return;
    const last = path[path.length - 1];
    for (const nb of adjacentOf(last)) {
      if (!visited.has(nb)) {
        visited.add(nb);
        path.push(nb);
        dfs(path, visited);
        path.pop();
        visited.delete(nb);
      }
    }
  }

  for (let i = 0; i < 25; i++) {
    dfs([i], new Set([i]));
  }

  return [...results];
}

function collectValues(path, grid, out) {
  const nums = path.map(i => grid[i]);
  const nOps = path.length - 1;

  function recurse(opArr) {
    if (opArr.length === nOps) {
      const v = evalLR(nums, opArr);
      if (v !== null && v > 0 && v <= MAX_TARGET && Number.isInteger(v)) out.add(v);
      return;
    }
    for (const op of OPS) {
      opArr.push(op);
      recurse(opArr);
      opArr.pop();
    }
  }

  recurse([]);
}

// ── Utilities ──────────────────────────────────────────────────────────────
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function currentNums() { return G.path.map(i => G.grid[i]); }

// ── Game actions ───────────────────────────────────────────────────────────
function handleCellClick(idx) {
  if (G.gameOver) return;
  const path = G.path;

  if (path.length === 0) {
    // Start a new path
    G.path = [idx];
    G.ops = [];
  } else if (path[path.length - 1] === idx) {
    // Tap last cell again → remove it
    G.path.pop();
    G.ops.pop();
  } else if (path.includes(idx)) {
    shakeCell(idx);
    showToast('Already in path', 'error');
    return;
  } else if (!isAdjacent(path[path.length - 1], idx)) {
    shakeCell(idx);
    showToast('Not adjacent', 'error');
    return;
  } else {
    G.path.push(idx);
    G.ops.push('+');
  }

  renderAll();
}

function cycleOperator(opIdx) {
  const cur = OPS.indexOf(G.ops[opIdx]);
  G.ops[opIdx] = OPS[(cur + 1) % OPS.length];
  renderAll();
}

function clearSelection() {
  G.path = [];
  G.ops = [];
  renderAll();
}

function submitExpression() {
  if (G.path.length < 2) { showToast('Select at least 2 numbers', 'error'); return; }

  const nums = currentNums();
  const val = evalLR(nums, G.ops);

  if (val === null) { showToast('Invalid — check division', 'error'); return; }

  const tIdx = G.targets.findIndex(t => t.owner === null && t.value === val);
  if (tIdx === -1) {
    showToast(`${val} doesn't match any target`, 'error');
    return;
  }

  // Claim the target!
  G.targets[tIdx].owner = G.playerCount === 1 ? 'solo' : G.player;
  if (G.playerCount > 1) G.scores[G.player].push(tIdx);

  const label = G.playerCount === 1 ? '🎯 Got it!' : `🎯 Player ${G.player + 1} claims ${val}!`;
  showToast(label, 'success');

  clearSelection();
  checkWin();
}

function passTurn() {
  if (G.playerCount === 1 || G.gameOver) return;
  clearSelection();
  G.player = 1 - G.player;
  renderAll();
  showToast(`Player ${G.player + 1}'s turn`, 'info');
}

function checkWin() {
  const allClaimed = G.targets.every(t => t.owner !== null);

  if (G.playerCount === 1) {
    if (allClaimed) { endGame(); return; }
    renderAll();
    return;
  }

  // 2-player: first to 2 targets wins, or most when all claimed
  for (let p = 0; p < 2; p++) {
    if (G.scores[p].length >= 2) { endGame(p); return; }
  }
  if (allClaimed) {
    const winner = G.scores[0].length >= G.scores[1].length ? 0 : 1;
    endGame(winner);
    return;
  }

  G.player = 1 - G.player;
  renderAll();
}

function endGame(winner) {
  G.gameOver = true;
  stopTimer();
  renderAll();

  setTimeout(() => {
    const titleEl = document.getElementById('win-title');
    const subEl = document.getElementById('win-subtitle');
    const badgeEl = document.getElementById('win-badge');
    const targetsEl = document.getElementById('win-targets');
    const timeEl = document.getElementById('win-time');

    if (G.playerCount === 1) {
      titleEl.textContent = 'Puzzle Complete!';
      const mins = (G.elapsed / 60) | 0;
      const secs = G.elapsed % 60;
      subEl.textContent = 'All 3 targets found!';
      timeEl.innerHTML = `Time: <span>${mins}:${String(secs).padStart(2, '0')}</span>`;
      timeEl.classList.remove('hidden');
      badgeEl.textContent = '🎉';
    } else {
      titleEl.textContent = `Player ${winner + 1} Wins!`;
      subEl.textContent = `Claimed ${G.scores[winner].length} out of 3 targets`;
      timeEl.classList.add('hidden');
      badgeEl.textContent = winner === 0 ? '🟢' : '🔵';
    }

    // Show target cards
    targetsEl.innerHTML = '';
    G.targets.forEach(t => {
      const card = document.createElement('div');
      const ownerClass = t.owner === 'solo' ? 'solo' : t.owner === 0 ? 'p1' : 'p2';
      const ownerLabel = t.owner === 'solo' ? 'Found' : t.owner === 0 ? 'Player 1' : 'Player 2';
      card.className = `win-target-card ${ownerClass}`;
      card.innerHTML = `<span class="wt-value">${t.value}</span><span class="wt-by">${ownerLabel}</span>`;
      targetsEl.appendChild(card);
    });

    showScreen('win-screen');
  }, 800);
}

// ── Timer ──────────────────────────────────────────────────────────────────
function startTimer() {
  if (G.playerCount !== 1) return;
  stopTimer();
  document.getElementById('solo-timer').classList.remove('hidden');
  timerInterval = setInterval(() => {
    G.elapsed++;
    const m = (G.elapsed / 60) | 0;
    const s = G.elapsed % 60;
    document.getElementById('timer-display').textContent = `${m}:${String(s).padStart(2, '0')}`;
  }, 1000);
}

function stopTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

// ── Toast ──────────────────────────────────────────────────────────────────
function showToast(text, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.className = `toast ${type}`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.add('hidden'), 2000);
}

function shakeCell(idx) {
  const cells = document.querySelectorAll('.cell');
  const cell = cells[idx];
  if (!cell) return;
  cell.classList.remove('shake');
  void cell.offsetWidth; // reflow
  cell.classList.add('shake');
}

// ── Rendering ──────────────────────────────────────────────────────────────
function renderAll() {
  renderGrid();
  renderTargets();
  renderExpression();
  renderPlayers();
  requestAnimationFrame(drawCanvas);
}

function renderGrid() {
  const cells = document.querySelectorAll('.cell');
  const lastInPath = G.path[G.path.length - 1];
  const adjacentSet = lastInPath !== undefined
    ? new Set(adjacentOf(lastInPath).filter(i => !G.path.includes(i)))
    : new Set();

  cells.forEach((cell, idx) => {
    const pos = G.path.indexOf(idx);
    // Reset classes
    cell.className = 'cell';
    cell.innerHTML = '';
    cell.textContent = G.grid[idx];

    if (pos !== -1) {
      cell.classList.add('selected');
      const badge = document.createElement('span');
      badge.className = 'cell-badge';
      badge.textContent = pos + 1;
      cell.appendChild(badge);
    } else if (G.path.length > 0 && adjacentSet.has(idx)) {
      cell.classList.add('adjacent-hint');
    }
  });
}

function renderTargets() {
  const el = document.getElementById('targets');
  const curVal = G.path.length >= 2 ? evalLR(currentNums(), G.ops) : null;

  el.innerHTML = '';
  G.targets.forEach((t, i) => {
    const card = document.createElement('div');
    card.className = 'target-card';
    card.dataset.i = i;

    if (t.owner !== null) {
      const cls = t.owner === 'solo' ? 'claimed-solo' : t.owner === 0 ? 'claimed-p1' : 'claimed-p2';
      const label = t.owner === 'solo' ? '' : t.owner === 0 ? 'P1' : 'P2';
      card.classList.add('claimed', cls);
      card.innerHTML = `<span class="target-value">${t.value}</span>${label ? `<span class="target-by">${label}</span>` : ''}`;
    } else {
      if (curVal !== null && curVal === t.value) card.classList.add('matching');
      card.innerHTML = `<span class="target-value">${t.value}</span>`;
    }
    el.appendChild(card);
  });
}

function renderExpression() {
  const tokensEl = document.getElementById('expr-tokens');
  const valueEl = document.getElementById('expr-value');

  tokensEl.innerHTML = '';

  if (G.path.length === 0) {
    const hint = document.createElement('span');
    hint.className = 'expr-hint';
    hint.textContent = 'Tap numbers above to build an expression';
    tokensEl.appendChild(hint);
    valueEl.textContent = '= ?';
    valueEl.className = 'expr-value neutral';
    return;
  }

  G.path.forEach((cellIdx, pos) => {
    const numSpan = document.createElement('span');
    numSpan.className = 'expr-num';
    numSpan.textContent = G.grid[cellIdx];
    tokensEl.appendChild(numSpan);

    if (pos < G.path.length - 1) {
      const opBtn = document.createElement('button');
      opBtn.className = 'expr-op';
      opBtn.textContent = OP_SYMBOLS[G.ops[pos]];
      opBtn.setAttribute('aria-label', `Change operator (currently ${G.ops[pos]})`);
      opBtn.addEventListener('click', () => cycleOperator(pos));
      tokensEl.appendChild(opBtn);
    }
  });

  const val = evalLR(currentNums(), G.ops);
  if (val === null) {
    valueEl.textContent = '= ✗';
    valueEl.className = 'expr-value invalid';
  } else {
    const isTarget = G.targets.some(t => t.owner === null && t.value === val);
    valueEl.textContent = `= ${val}`;
    valueEl.className = `expr-value ${isTarget ? 'match' : 'value'}`;
  }
}

function renderPlayers() {
  const banner = document.getElementById('turn-banner');
  const passRow = document.getElementById('pass-row');

  if (G.playerCount === 1) {
    banner.classList.add('hidden');
    passRow.classList.add('hidden');
    return;
  }

  banner.classList.remove('hidden');
  passRow.classList.remove('hidden');

  // Active player highlight
  document.getElementById('chip-p1').classList.toggle('active', G.player === 0);
  document.getElementById('chip-p2').classList.toggle('active', G.player === 1);
  document.getElementById('turn-label').textContent = `Player ${G.player + 1}'s Turn`;

  // Score pips
  function buildPips(containerId, playerIdx) {
    const el = document.getElementById(containerId);
    el.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const pip = document.createElement('div');
      const colorClass = playerIdx === 0 ? 'p1' : 'p2';
      pip.className = `pip ${i < G.scores[playerIdx].length ? colorClass : 'empty'}`;
      el.appendChild(pip);
    }
  }
  buildPips('pips-p1', 0);
  buildPips('pips-p2', 1);
}

// ── Canvas path lines ──────────────────────────────────────────────────────
function drawCanvas() {
  const canvas = document.getElementById('path-canvas');
  const grid = document.getElementById('grid');
  const cells = grid.querySelectorAll('.cell');
  if (!cells.length) return;

  canvas.width = grid.offsetWidth;
  canvas.height = grid.offsetHeight;
  canvas.style.width = grid.offsetWidth + 'px';
  canvas.style.height = grid.offsetHeight + 'px';

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (G.path.length < 2) return;

  function center(idx) {
    const cell = cells[idx];
    return {
      x: cell.offsetLeft + cell.offsetWidth / 2,
      y: cell.offsetTop + cell.offsetHeight / 2,
    };
  }

  const lineW = Math.max(3, cells[0].offsetWidth * 0.12);

  // Shadow / glow
  ctx.strokeStyle = 'rgba(201,180,88,0.25)';
  ctx.lineWidth = lineW * 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const s = center(G.path[0]);
  ctx.moveTo(s.x, s.y);
  for (let i = 1; i < G.path.length; i++) {
    const pt = center(G.path[i]);
    ctx.lineTo(pt.x, pt.y);
  }
  ctx.stroke();

  // Main line
  ctx.strokeStyle = 'rgba(201,180,88,0.75)';
  ctx.lineWidth = lineW;
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  for (let i = 1; i < G.path.length; i++) {
    const pt = center(G.path[i]);
    ctx.lineTo(pt.x, pt.y);
  }
  ctx.stroke();

  // Direction arrowhead at last segment
  if (G.path.length >= 2) {
    const last = center(G.path[G.path.length - 1]);
    const prev = center(G.path[G.path.length - 2]);
    const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
    const aLen = lineW * 2;
    ctx.fillStyle = 'rgba(201,180,88,0.9)';
    ctx.beginPath();
    ctx.moveTo(last.x + Math.cos(angle) * aLen, last.y + Math.sin(angle) * aLen);
    ctx.lineTo(last.x + Math.cos(angle + 2.4) * aLen, last.y + Math.sin(angle + 2.4) * aLen);
    ctx.lineTo(last.x + Math.cos(angle - 2.4) * aLen, last.y + Math.sin(angle - 2.4) * aLen);
    ctx.closePath();
    ctx.fill();
  }
}

// ── Screen management ──────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.add('hidden');
    s.classList.remove('active');
  });
  const target = document.getElementById(id);
  target.classList.remove('hidden');
}

// ── Game start ─────────────────────────────────────────────────────────────
function startGame() {
  stopTimer();

  G = freshState(selectedPlayerCount);

  // Build grid cells (done once; renderGrid updates them)
  buildGridCells();

  // Solo timer
  const timerEl = document.getElementById('solo-timer');
  timerEl.classList.toggle('hidden', G.playerCount !== 1);

  renderAll();
  showScreen('game-screen');

  if (G.playerCount === 1) startTimer();
}

function buildGridCells() {
  const gridEl = document.getElementById('grid');
  gridEl.innerHTML = '';
  for (let i = 0; i < 25; i++) {
    const cell = document.createElement('button');
    cell.className = 'cell';
    cell.dataset.index = i;
    cell.addEventListener('click', () => handleCellClick(i));
    gridEl.appendChild(cell);
  }
}

// ── Bootstrap ──────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Player count toggle
  document.querySelectorAll('.toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedPlayerCount = parseInt(btn.dataset.players, 10);
    });
  });

  // Start / Play Again
  document.getElementById('start-btn').addEventListener('click', startGame);
  document.getElementById('play-again-btn').addEventListener('click', startGame);

  // Main menu from win screen
  document.getElementById('main-menu-btn').addEventListener('click', () => showScreen('start-screen'));

  // Back from game to start
  document.getElementById('back-btn').addEventListener('click', () => {
    stopTimer();
    showScreen('start-screen');
  });

  // Help modal
  function openModal() { document.getElementById('modal').classList.remove('hidden'); }
  function closeModal() { document.getElementById('modal').classList.add('hidden'); }

  document.getElementById('how-btn').addEventListener('click', openModal);
  document.getElementById('help-btn').addEventListener('click', openModal);
  document.getElementById('got-it-btn').addEventListener('click', closeModal);
  document.querySelector('.modal-close').addEventListener('click', closeModal);
  document.getElementById('modal').addEventListener('click', e => {
    if (e.target.classList.contains('modal-backdrop')) closeModal();
  });

  // Game controls
  document.getElementById('clear-btn').addEventListener('click', clearSelection);
  document.getElementById('submit-btn').addEventListener('click', submitExpression);
  document.getElementById('pass-btn').addEventListener('click', passTurn);

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (document.getElementById('game-screen').classList.contains('hidden')) return;
    if (e.key === 'Enter') submitExpression();
    if (e.key === 'Escape') clearSelection();
  });

  // Resize → redraw canvas
  window.addEventListener('resize', drawCanvas);
});
