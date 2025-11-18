/* client/script.js - updated to use remote API for auth & leaderboard (optionally)
   Configure API_BASE to your deployed API url (no trailing slash), e.g.:
     const API_BASE = "https://your-snake-api.up.railway.app"
   If API_BASE is empty string, the client uses localStorage auth (legacy behavior).
*/

const API_BASE = ""; // <-- set this to your server URL to enable global backend integration

// Helper for API calls
async function apiPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch((API_BASE || '') + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  return res.json();
}
async function apiGet(path) {
  const res = await fetch((API_BASE || '') + path);
  return res.json();
}

// Minimal integration: when API_BASE is set, use server for register/login/leaderboard/score
// Otherwise fallback to localStorage single-browser mode (legacy).

// ----- The rest of the client uses the previous local game code but simplified auth switching -----
// For brevity this file includes a compact version of the game with server hooks only for auth/leaderboard submission.

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const btnStart = document.getElementById('btnStart');
  const btnPause = document.getElementById('btnPause');
  const btnReset = document.getElementById('btnReset');
  const btnResetRecord = document.getElementById('btnResetRecord');
  const btnSettings = document.getElementById('btnSettings');
  const btnLeaderboard = document.getElementById('btnLeaderboard');
  const btnLogout = document.getElementById('btnLogout');
  const playerInfoEl = document.getElementById('playerInfo');
  const playerNameEl = document.getElementById('playerName');
  const authOverlay = document.getElementById('authOverlay');
  const formLogin = document.getElementById('formLogin');
  const formCreate = document.getElementById('formCreate');
  const tabLogin = document.getElementById('tabLogin');
  const tabCreate = document.getElementById('tabCreate');
  const loginUser = document.getElementById('loginUser');
  const loginPass = document.getElementById('loginPass');
  const createUser = document.getElementById('createUser');
  const createPass = document.getElementById('createPass');
  const createPass2 = document.getElementById('createPass2');
  const authMessage = document.getElementById('authMessage');
  const leaderModal = document.getElementById('leaderModal');
  const leaderList = document.getElementById('leaderList');
  const btnCloseLeader = document.getElementById('btnCloseLeader');
  const btnClearLeader = document.getElementById('btnClearLeader');

  let cols = 24, rows = 24;
  const GRID = 20;
  let snake = [], dir={x:1,y:0}, nextDir={x:1,y:0}, food=null;
  let running=false, paused=false, score=0, gameInterval=null, speed=120;

  // session can be local or from server token
  let session = {
    username: localStorage.getItem('snake_user') || null,
    token: localStorage.getItem('snake_token') || null
  };

  function showAuthMessage(msg, type='') { authMessage.textContent = msg; authMessage.className = 'auth-message' + (type ? ' ' + type : ''); }

  function showOverlay() { authOverlay.style.display = 'flex'; authOverlay.setAttribute('aria-hidden','false'); }
  function hideOverlay() { authOverlay.style.display = 'none'; authOverlay.setAttribute('aria-hidden','true'); }

  tabLogin.addEventListener('click', ()=>{ tabLogin.classList.add('active'); tabCreate.classList.remove('active'); formLogin.classList.remove('hidden'); formCreate.classList.add('hidden'); });
  tabCreate.addEventListener('click', ()=>{ tabCreate.classList.add('active'); tabLogin.classList.remove('active'); formCreate.classList.remove('hidden'); formLogin.classList.add('hidden'); });

  async function registerServer(username, password) {
    if (!API_BASE) { return { ok:false, error:'no_api' }; }
    try {
      const data = await apiPost('/api/register', { username, password });
      return data;
    } catch (e) { return { ok:false, error:'network' }; }
  }
  async function loginServer(username, password) {
    if (!API_BASE) return { ok:false, error:'no_api' };
    try {
      const data = await apiPost('/api/login', { username, password });
      return data;
    } catch(e) { return { ok:false, error:'network' }; }
  }
  async function submitScoreToServer(scoreVal) {
    if (!API_BASE || !session.token) return;
    try {
      await apiPost('/api/score', { score: scoreVal }, session.token);
    } catch(e){}
  }
  async function fetchLeaderboardFromServer() {
    if (!API_BASE) return { ok:false, leaderboard: [] };
    try {
      const q = '?limit=100';
      const res = await apiGet('/api/leaderboard' + q);
      return res;
    } catch(e){ return { ok:false, leaderboard: [] }; }
  }

  // form handlers
  formCreate.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const u = (createUser.value||'').trim();
    const p = createPass.value||'';
    const p2 = createPass2.value||'';
    if (p !== p2) { showAuthMessage('As senhas não coincidem.', 'err'); return; }
    if (API_BASE) {
      const r = await registerServer(u,p);
      if (r && r.ok) { showAuthMessage('Conta criada! Faça login.', 'ok'); tabLogin.click(); createUser.value=''; createPass.value=''; createPass2.value=''; }
      else showAuthMessage('Erro: ' + (r.error||'unknown'), 'err');
    } else {
      // local fallback: store in localStorage
      const users = JSON.parse(localStorage.getItem('snake_users') || '{}');
      if (users[u]) { showAuthMessage('Usuário já existe (local).', 'err'); return; }
      users[u] = { pass: btoa(p), best: 0 };
      localStorage.setItem('snake_users', JSON.stringify(users));
      showAuthMessage('Conta criada localmente. Faça login.', 'ok'); tabLogin.click();
    }
  });

  formLogin.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const u = (loginUser.value||'').trim();
    const p = loginPass.value||'';
    if (API_BASE) {
      const r = await loginServer(u,p);
      if (r && r.ok && r.token) {
        session.username = r.user.username;
        session.token = r.token;
        localStorage.setItem('snake_user', session.username);
        localStorage.setItem('snake_token', session.token);
        initializeForUser(session.username);
        hideOverlay();
      } else {
        showAuthMessage('Erro: ' + (r.error||'Credenciais inválidas'), 'err');
      }
    } else {
      // local fallback
      const users = JSON.parse(localStorage.getItem('snake_users') || '{}');
      if (!users[u] || atob(users[u].pass) !== p) { showAuthMessage('Credenciais inválidas (local).', 'err'); return; }
      session.username = u; session.token = null;
      localStorage.setItem('snake_user', u); localStorage.removeItem('snake_token');
      initializeForUser(u); hideOverlay();
    }
  });

  function initializeForUser(username) {
    playerInfoEl.style.display = 'inline-block'; playerNameEl.textContent = username; btnLogout.style.display = 'inline-block';
    if (!API_BASE) {
      const users = JSON.parse(localStorage.getItem('snake_users') || '{}');
      bestEl.textContent = users[username] ? users[username].best : 0;
    } else {
      bestEl.textContent = '0';
    }
    startGame();
  }

  btnLogout.addEventListener('click', ()=>{
    pauseGame();
    session = { username: null, token: null };
    localStorage.removeItem('snake_user'); localStorage.removeItem('snake_token');
    playerInfoEl.style.display='none'; playerNameEl.textContent='—'; btnLogout.style.display='none'; bestEl.textContent='0';
    showOverlay();
  });

  btnLeaderboard.addEventListener('click', async ()=>{
    if (API_BASE) {
      const res = await fetchLeaderboardFromServer();
      if (res && res.ok) renderLeader(res.leaderboard || []);
      else renderLeader([]);
    } else {
      const users = JSON.parse(localStorage.getItem('snake_users') || '{}');
      const arr = Object.keys(users).map(u=>({ username:u, bestScore: users[u].best || 0 })).sort((a,b)=>b.bestScore-a.bestScore).slice(0,100);
      renderLeader(arr);
    }
    leaderModal.classList.remove('hidden'); leaderModal.setAttribute('aria-hidden','false');
  });
  btnCloseLeader.addEventListener('click', ()=>{ leaderModal.classList.add('hidden'); leaderModal.setAttribute('aria-hidden','true'); });
  btnClearLeader.addEventListener('click', ()=>{ if (confirm('Limpar leaderboard local? (não afeta servidor)')) { localStorage.removeItem('snake_users'); alert('Leaderboard local removido.'); } });

  function renderLeader(list) {
    if (!list || !list.length) { leaderList.innerHTML = '<div class="leader-item">Nenhum resultado ainda.</div>'; return; }
    leaderList.innerHTML = list.slice(0,100).map((it, idx)=>(`<div class="leader-item"><div>#${idx+1} <strong>${escapeHtml(it.username||it.user||'Anon')}</strong></div><div>${it.bestScore||it.score} pts</div></div>`)).join('');
  }

  function escapeHtml(s){ return (s+'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function resizeCanvas() {
    const maxWidth = canvas.parentElement.clientWidth;
    const size = Math.min(maxWidth, 680);
    canvas.width = size; canvas.height = size;
    cols = Math.floor(canvas.width / GRID); rows = Math.floor(canvas.height / GRID);
  }

  function startGame() {
    if (!session.username) { showOverlay(); showAuthMessage('Faça login para começar.', 'err'); return; }
    resizeCanvas();
    snake = [{ x: Math.floor(cols/2), y: Math.floor(rows/2) }];
    dir = {x:1,y:0}; nextDir={x:1,y:0};
    placeFood(); score=0; updateScoreUI(); running=true; paused=false;
    clearInterval(gameInterval); gameInterval = setInterval(tick, speed);
    draw();
  }
  function pauseGame(){ if(!running)return; paused = !paused; if(paused) clearInterval(gameInterval); else { clearInterval(gameInterval); gameInterval = setInterval(tick, speed); } }
  function resetGame(){ clearInterval(gameInterval); running=false; paused=false; startGame(); }

  function placeFood() {
    const x = Math.floor(Math.random()*cols), y = Math.floor(Math.random()*rows);
    food = { x,y };
  }

  function tick() {
    if (!(nextDir.x === -dir.x && nextDir.y === -dir.y)) dir = nextDir;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (head.x < 0) head.x = cols-1;
    if (head.x >= cols) head.x = 0;
    if (head.y < 0) head.y = rows-1;
    if (head.y >= rows) head.y = 0;
    if (snake.some(p=>p.x===head.x && p.y===head.y)) { gameOver(); return; }
    snake.unshift(head);
    if (food && head.x===food.x && head.y===food.y) {
      score += 10; updateScoreUI(); placeFood();
      submitScoreToServer(score);
      if (!API_BASE) {
        const users = JSON.parse(localStorage.getItem('snake_users') || '{}');
        users[session.username].best = Math.max(users[session.username].best || 0, score);
        localStorage.setItem('snake_users', JSON.stringify(users));
        bestEl.textContent = users[session.username].best;
      }
    } else snake.pop();
    draw();
  }

  function updateScoreUI(){ scoreEl.textContent = score; if (session.username && !API_BASE) { const users = JSON.parse(localStorage.getItem('snake_users') || '{}'); bestEl.textContent = users[session.username] ? users[session.username].best : 0; } }

  function gameOver() { clearInterval(gameInterval); running=false; alert('Game over!'); }

  function draw() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#06121a'; roundRect(ctx,0,0,canvas.width,canvas.height,12); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.02)'; ctx.lineWidth=1;
    for (let i=0;i<cols;i++){ const x = i*(canvas.width/cols)+0.5; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); }
    for (let j=0;j<rows;j++){ const y = j*(canvas.height/rows)+0.5; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); }
    if (food) { drawRoundedCell(food.x, food.y, (x,y,w,h)=>{ const gx = ctx.createRadialGradient(x+w/2,y+h/2,2,x+w/2,y+h/2,w); gx.addColorStop(0,'#ffb86b'); gx.addColorStop(1,'#ff6b6b'); ctx.fillStyle=gx; roundRect(ctx,x+2,y+2,w-4,h-4,6); ctx.fill(); }); }
    for (let i=snake.length-1;i>=0;i--){ const p=snake[i]; drawRoundedCell(p.x,p.y,(x,y,w,h)=>{ ctx.fillStyle='hsl(' + (160 - i*2) + ' 70% 50%)'; roundRect(ctx,x,y,w,h,6); ctx.fill(); }); }
  }

  function drawRoundedCell(colIndex,rowIndex,drawFn){ const w = canvas.width/cols; const h = canvas.height/rows; const x = Math.round(colIndex * w); const y = Math.round(rowIndex * h); drawFn(x,y,Math.ceil(w),Math.ceil(h)); }
  function roundRect(ctx,x,y,w,h,r){ if (w < 2*r) r = w/2; if (h < 2*r) r = h/2; ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

  window.addEventListener('keydown', e=>{ if (!running && e.key==='Enter' && session.username) startGame(); if (e.code==='Space'){ pauseGame(); } const map={ ArrowUp:{x:0,y:-1}, ArrowDown:{x:0,y:1}, ArrowLeft:{x:-1,y:0}, ArrowRight:{x:1,y:0}, KeyW:{x:0,y:-1}, KeyS:{x:0,y:1}, KeyA:{x:-1,y:0}, KeyD:{x:1,y:0} }; const nd = map[e.code]; if (nd) { if (!(nd.x === -dir.x && nd.y === -dir.y)) nextDir = nd; } });

  resizeCanvas();
  if (!session.username) showOverlay();
});
/* client/script.js - updated to use remote API for auth & leaderboard (optionally)
   Configure API_BASE to your deployed API url (no trailing slash), e.g.:
     const API_BASE = "https://your-snake-api.up.railway.app"
   If API_BASE is empty string, the client uses localStorage auth (legacy behavior).
*/

 API_BASE = ""; // <-- set this to your server URL to enable global backend integration

// Helper for API calls
async function apiPost(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch((API_BASE || '') + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  return res.json();
}
async function apiGet(path) {
  const res = await fetch((API_BASE || '') + path);
  return res.json();
}

// Minimal integration: when API_BASE is set, use server for register/login/leaderboard/score
// Otherwise fallback to localStorage single-browser mode (legacy).

// ----- The rest of the client uses the previous local game code but simplified auth switching -----
// For brevity this file includes a compact version of the game with server hooks only for auth/leaderboard submission.

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const btnStart = document.getElementById('btnStart');
  const btnPause = document.getElementById('btnPause');
  const btnReset = document.getElementById('btnReset');
  const btnResetRecord = document.getElementById('btnResetRecord');
  const btnSettings = document.getElementById('btnSettings');
  const btnLeaderboard = document.getElementById('btnLeaderboard');
  const btnLogout = document.getElementById('btnLogout');
  const playerInfoEl = document.getElementById('playerInfo');
  const playerNameEl = document.getElementById('playerName');
  const authOverlay = document.getElementById('authOverlay');
  const formLogin = document.getElementById('formLogin');
  const formCreate = document.getElementById('formCreate');
  const tabLogin = document.getElementById('tabLogin');
  const tabCreate = document.getElementById('tabCreate');
  const loginUser = document.getElementById('loginUser');
  const loginPass = document.getElementById('loginPass');
  const createUser = document.getElementById('createUser');
  const createPass = document.getElementById('createPass');
  const createPass2 = document.getElementById('createPass2');
  const authMessage = document.getElementById('authMessage');
  const leaderModal = document.getElementById('leaderModal');
  const leaderList = document.getElementById('leaderList');
  const btnCloseLeader = document.getElementById('btnCloseLeader');
  const btnClearLeader = document.getElementById('btnClearLeader');

  let cols = 24, rows = 24;
  const GRID = 20;
  let snake = [], dir={x:1,y:0}, nextDir={x:1,y:0}, food=null;
  let running=false, paused=false, score=0, gameInterval=null, speed=120;

  // session can be local or from server token
  let session = {
    username: localStorage.getItem('snake_user') || null,
    token: localStorage.getItem('snake_token') || null
  };

  function showAuthMessage(msg, type='') { authMessage.textContent = msg; authMessage.className = 'auth-message' + (type ? ' ' + type : ''); }

  function showOverlay() { authOverlay.style.display = 'flex'; authOverlay.setAttribute('aria-hidden','false'); }
  function hideOverlay() { authOverlay.style.display = 'none'; authOverlay.setAttribute('aria-hidden','true'); }

  tabLogin.addEventListener('click', ()=>{ tabLogin.classList.add('active'); tabCreate.classList.remove('active'); formLogin.classList.remove('hidden'); formCreate.classList.add('hidden'); });
  tabCreate.addEventListener('click', ()=>{ tabCreate.classList.add('active'); tabLogin.classList.remove('active'); formCreate.classList.remove('hidden'); formLogin.classList.add('hidden'); });

  async function registerServer(username, password) {
    if (!API_BASE) { return { ok:false, error:'no_api' }; }
    try {
      const data = await apiPost('/api/register', { username, password });
      return data;
    } catch (e) { return { ok:false, error:'network' }; }
  }
  async function loginServer(username, password) {
    if (!API_BASE) return { ok:false, error:'no_api' };
    try {
      const data = await apiPost('/api/login', { username, password });
      return data;
    } catch(e) { return { ok:false, error:'network' }; }
  }
  async function submitScoreToServer(scoreVal) {
    if (!API_BASE || !session.token) return;
    try {
      await apiPost('/api/score', { score: scoreVal }, session.token);
    } catch(e){}
  }
  async function fetchLeaderboardFromServer() {
    if (!API_BASE) return { ok:false, leaderboard: [] };
    try {
      const q = '?limit=100';
      const res = await apiGet('/api/leaderboard' + q);
      return res;
    } catch(e){ return { ok:false, leaderboard: [] }; }
  }

  // form handlers
  formCreate.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const u = (createUser.value||'').trim();
    const p = createPass.value||'';
    const p2 = createPass2.value||'';
    if (p !== p2) { showAuthMessage('As senhas não coincidem.', 'err'); return; }
    if (API_BASE) {
      const r = await registerServer(u,p);
      if (r && r.ok) { showAuthMessage('Conta criada! Faça login.', 'ok'); tabLogin.click(); createUser.value=''; createPass.value=''; createPass2.value=''; }
      else showAuthMessage('Erro: ' + (r.error||'unknown'), 'err');
    } else {
      // local fallback: store in localStorage
      const users = JSON.parse(localStorage.getItem('snake_users') || '{}');
      if (users[u]) { showAuthMessage('Usuário já existe (local).', 'err'); return; }
      users[u] = { pass: btoa(p), best: 0 };
      localStorage.setItem('snake_users', JSON.stringify(users));
      showAuthMessage('Conta criada localmente. Faça login.', 'ok'); tabLogin.click();
    }
  });

  formLogin.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const u = (loginUser.value||'').trim();
    const p = loginPass.value||'';
    if (API_BASE) {
      const r = await loginServer(u,p);
      if (r && r.ok && r.token) {
        session.username = r.user.username;
        session.token = r.token;
        localStorage.setItem('snake_user', session.username);
        localStorage.setItem('snake_token', session.token);
        initializeForUser(session.username);
        hideOverlay();
      } else {
        showAuthMessage('Erro: ' + (r.error||'Credenciais inválidas'), 'err');
      }
    } else {
      // local fallback
      const users = JSON.parse(localStorage.getItem('snake_users') || '{}');
      if (!users[u] || atob(users[u].pass) !== p) { showAuthMessage('Credenciais inválidas (local).', 'err'); return; }
      session.username = u; session.token = null;
      localStorage.setItem('snake_user', u); localStorage.removeItem('snake_token');
      initializeForUser(u); hideOverlay();
    }
  });

  function initializeForUser(username) {
    playerInfoEl.style.display = 'inline-block'; playerNameEl.textContent = username; btnLogout.style.display = 'inline-block';
    if (!API_BASE) {
      const users = JSON.parse(localStorage.getItem('snake_users') || '{}');
      bestEl.textContent = users[username] ? users[username].best : 0;
    } else {
      bestEl.textContent = '0';
    }
    startGame();
  }

  btnLogout.addEventListener('click', ()=>{
    pauseGame();
    session = { username: null, token: null };
    localStorage.removeItem('snake_user'); localStorage.removeItem('snake_token');
    playerInfoEl.style.display='none'; playerNameEl.textContent='—'; btnLogout.style.display='none'; bestEl.textContent='0';
    showOverlay();
  });

  btnLeaderboard.addEventListener('click', async ()=>{
    if (API_BASE) {
      const res = await fetchLeaderboardFromServer();
      if (res && res.ok) renderLeader(res.leaderboard || []);
      else renderLeader([]);
    } else {
      const users = JSON.parse(localStorage.getItem('snake_users') || '{}');
      const arr = Object.keys(users).map(u=>({ username:u, bestScore: users[u].best || 0 })).sort((a,b)=>b.bestScore-a.bestScore).slice(0,100);
      renderLeader(arr);
    }
    leaderModal.classList.remove('hidden'); leaderModal.setAttribute('aria-hidden','false');
  });
  btnCloseLeader.addEventListener('click', ()=>{ leaderModal.classList.add('hidden'); leaderModal.setAttribute('aria-hidden','true'); });
  btnClearLeader.addEventListener('click', ()=>{ if (confirm('Limpar leaderboard local? (não afeta servidor)')) { localStorage.removeItem('snake_users'); alert('Leaderboard local removido.'); } });

  function renderLeader(list) {
    if (!list || !list.length) { leaderList.innerHTML = '<div class="leader-item">Nenhum resultado ainda.</div>'; return; }
    leaderList.innerHTML = list.slice(0,100).map((it, idx)=>(`<div class="leader-item"><div>#${idx+1} <strong>${escapeHtml(it.username||it.user||'Anon')}</strong></div><div>${it.bestScore||it.score} pts</div></div>`)).join('');
  }

  function escapeHtml(s){ return (s+'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function resizeCanvas() {
    const maxWidth = canvas.parentElement.clientWidth;
    const size = Math.min(maxWidth, 680);
    canvas.width = size; canvas.height = size;
    cols = Math.floor(canvas.width / GRID); rows = Math.floor(canvas.height / GRID);
  }

  function startGame() {
    if (!session.username) { showOverlay(); showAuthMessage('Faça login para começar.', 'err'); return; }
    resizeCanvas();
    snake = [{ x: Math.floor(cols/2), y: Math.floor(rows/2) }];
    dir = {x:1,y:0}; nextDir={x:1,y:0};
    placeFood(); score=0; updateScoreUI(); running=true; paused=false;
    clearInterval(gameInterval); gameInterval = setInterval(tick, speed);
    draw();
  }
  function pauseGame(){ if(!running)return; paused = !paused; if(paused) clearInterval(gameInterval); else { clearInterval(gameInterval); gameInterval = setInterval(tick, speed); } }
  function resetGame(){ clearInterval(gameInterval); running=false; paused=false; startGame(); }

  function placeFood() {
    const x = Math.floor(Math.random()*cols), y = Math.floor(Math.random()*rows);
    food = { x,y };
  }

  function tick() {
    if (!(nextDir.x === -dir.x && nextDir.y === -dir.y)) dir = nextDir;
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    if (head.x < 0) head.x = cols-1;
    if (head.x >= cols) head.x = 0;
    if (head.y < 0) head.y = rows-1;
    if (head.y >= rows) head.y = 0;
    if (snake.some(p=>p.x===head.x && p.y===head.y)) { gameOver(); return; }
    snake.unshift(head);
    if (food && head.x===food.x && head.y===food.y) {
      score += 10; updateScoreUI(); placeFood();
      submitScoreToServer(score);
      if (!API_BASE) {
        const users = JSON.parse(localStorage.getItem('snake_users') || '{}');
        users[session.username].best = Math.max(users[session.username].best || 0, score);
        localStorage.setItem('snake_users', JSON.stringify(users));
        bestEl.textContent = users[session.username].best;
      }
    } else snake.pop();
    draw();
  }

  function updateScoreUI(){ scoreEl.textContent = score; if (session.username && !API_BASE) { const users = JSON.parse(localStorage.getItem('snake_users') || '{}'); bestEl.textContent = users[session.username] ? users[session.username].best : 0; } }

  function gameOver() { clearInterval(gameInterval); running=false; alert('Game over!'); }

  function draw() {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#06121a'; roundRect(ctx,0,0,canvas.width,canvas.height,12); ctx.fill();
    ctx.strokeStyle='rgba(255,255,255,0.02)'; ctx.lineWidth=1;
    for (let i=0;i<cols;i++){ const x = i*(canvas.width/cols)+0.5; ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); }
    for (let j=0;j<rows;j++){ const y = j*(canvas.height/rows)+0.5; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); }
    if (food) { drawRoundedCell(food.x, food.y, (x,y,w,h)=>{ const gx = ctx.createRadialGradient(x+w/2,y+h/2,2,x+w/2,y+h/2,w); gx.addColorStop(0,'#ffb86b'); gx.addColorStop(1,'#ff6b6b'); ctx.fillStyle=gx; roundRect(ctx,x+2,y+2,w-4,h-4,6); ctx.fill(); }); }
    for (let i=snake.length-1;i>=0;i--){ const p=snake[i]; drawRoundedCell(p.x,p.y,(x,y,w,h)=>{ ctx.fillStyle='hsl(' + (160 - i*2) + ' 70% 50%)'; roundRect(ctx,x,y,w,h,6); ctx.fill(); }); }
  }

  function drawRoundedCell(colIndex,rowIndex,drawFn){ const w = canvas.width/cols; const h = canvas.height/rows; const x = Math.round(colIndex * w); const y = Math.round(rowIndex * h); drawFn(x,y,Math.ceil(w),Math.ceil(h)); }
  function roundRect(ctx,x,y,w,h,r){ if (w < 2*r) r = w/2; if (h < 2*r) r = h/2; ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }

  window.addEventListener('keydown', e=>{ if (!running && e.key==='Enter' && session.username) startGame(); if (e.code==='Space'){ pauseGame(); } const map={ ArrowUp:{x:0,y:-1}, ArrowDown:{x:0,y:1}, ArrowLeft:{x:-1,y:0}, ArrowRight:{x:1,y:0}, KeyW:{x:0,y:-1}, KeyS:{x:0,y:1}, KeyA:{x:-1,y:0}, KeyD:{x:1,y:0} }; const nd = map[e.code]; if (nd) { if (!(nd.x === -dir.x && nd.y === -dir.y)) nextDir = nd; } });

  resizeCanvas();
  if (!session.username) showOverlay();
});








































/* script.js — versão estendida com:
   - autenticação local (criar conta + login)
   - frutas diferentes com valores e partículas
   - leaderboard local
   - níveis, skins, som, animações, barreiras, modo difícil
   - configurações por jogador salvas em localStorage
   - sistema de idiomas (pt-BR, en-US, es-ES) com detecção e seletor manual
*/

if (!window.__snakeScriptLoaded) {
  window.__snakeScriptLoaded = true;

  document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    /* -------------------------
       Languages
    -------------------------*/
    const LANGUAGES = {
      "pt-BR": {
        title: "Snake — Jogo da Cobrinha",
        points: "Pontos",
        best: "Recorde",
        start: "Iniciar",
        pause: "Pausar",
        reset: "Reiniciar",
        resetRecord: "Zerar Recorde",
        settings: "Configurações",
        leaderboard: "Leaderboard",
        howToPlay: "Como jogar",
        move: "Use as setas do teclado ou WASD para mover.",
        swipe: "Toque e arraste (swipe) em celulares.",
        eat: "Coma frutas para ganhar pontos — a cobra cresce.",
        space: "Pausa: botão Pausar ou tecla SPACE.",
        loginTitle: "Entrar no Snake",
        loginTab: "Login",
        createTab: "Criar Conta",
        loginBtn: "Entrar",
        createBtn: "Criar Conta",
        username: "Usuário",
        password: "Senha",
        passwordConfirm: "Confirmar Senha",
        level: "Nível",
        levelEasy: "Fácil",
        levelNormal: "Normal",
        levelHard: "Difícil",
        skins: "Skins",
        skinNeon: "Neon",
        skinSunset: "Sunset",
        skinOcean: "Ocean",
        sound: "Som",
        volume: "Volume",
        barriers: "Barras/Obstáculos",
        hardMode: "Modo difícil",
        logout: "Sair",
        leaderTitle: "Leaderboard (Top 20)",
        save: "Salvar",
        close: "Fechar",
        clearLeader: "Limpar Leaderboard",
        uiLevel: "Nível",
        uiSkin: "Skin",
        uiHardOn: "Ligado",
        uiHardOff: "Desligado"
      },
      "en-US": {
        title: "Snake — Classic Snake Game",
        points: "Score",
        best: "High Score",
        start: "Start",
        pause: "Pause",
        reset: "Reset",
        resetRecord: "Reset Record",
        settings: "Settings",
        leaderboard: "Leaderboard",
        howToPlay: "How to play",
        move: "Use arrow keys or WASD to move.",
        swipe: "Swipe on mobile to move.",
        eat: "Eat fruits to grow and gain points.",
        space: "Pause: Pause button or SPACE bar.",
        loginTitle: "Login to Snake",
        loginTab: "Login",
        createTab: "Create Account",
        loginBtn: "Login",
        createBtn: "Create Account",
        username: "Username",
        password: "Password",
        passwordConfirm: "Confirm Password",
        level: "Level",
        levelEasy: "Easy",
        levelNormal: "Normal",
        levelHard: "Hard",
        skins: "Skins",
        skinNeon: "Neon",
        skinSunset: "Sunset",
        skinOcean: "Ocean",
        sound: "Sound",
        volume: "Volume",
        barriers: "Barriers/Obstacles",
        hardMode: "Hard Mode",
        logout: "Logout",
        leaderTitle: "Leaderboard (Top 20)",
        save: "Save",
        close: "Close",
        clearLeader: "Clear Leaderboard",
        uiLevel: "Level",
        uiSkin: "Skin",
        uiHardOn: "On",
        uiHardOff: "Off"
      },
      "es-ES": {
        title: "Snake — Juego de la Serpiente",
        points: "Puntos",
        best: "Récord",
        start: "Iniciar",
        pause: "Pausar",
        reset: "Reiniciar",
        resetRecord: "Reiniciar Récord",
        settings: "Ajustes",
        leaderboard: "Clasificación",
        howToPlay: "Cómo jugar",
        move: "Usa las flechas o WASD para mover.",
        swipe: "Desliza (swipe) en móviles.",
        eat: "Come frutas para crecer y ganar puntos.",
        space: "Pausa: botón Pausar o tecla SPACE.",
        loginTitle: "Iniciar sesión en Snake",
        loginTab: "Iniciar",
        createTab: "Crear Cuenta",
        loginBtn: "Entrar",
        createBtn: "Crear Cuenta",
        username: "Usuario",
        password: "Contraseña",
        passwordConfirm: "Confirmar Contraseña",
        level: "Nivel",
        levelEasy: "Fácil",
        levelNormal: "Normal",
        levelHard: "Difícil",
        skins: "Aspectos",
        skinNeon: "Neon",
        skinSunset: "Sunset",
        skinOcean: "Ocean",
        sound: "Sonido",
        volume: "Volumen",
        barriers: "Barras/Obstáculos",
        hardMode: "Modo difícil",
        logout: "Salir",
        leaderTitle: "Clasificación (Top 20)",
        save: "Guardar",
        close: "Cerrar",
        clearLeader: "Limpiar Clasificación",
        uiLevel: "Nivel",
        uiSkin: "Aspecto",
        uiHardOn: "Activado",
        uiHardOff: "Desactivado"
      }
    };

    function detectLanguage() {
      const saved = localStorage.getItem('snake_lang');
      if (saved && LANGUAGES[saved]) return saved;
      const lang = navigator.language || navigator.userLanguage || 'pt-BR';
      if (LANGUAGES[lang]) return lang;
      if (lang.startsWith('en')) return 'en-US';
      if (lang.startsWith('es')) return 'es-ES';
      return 'pt-BR';
    }
    let currentLang = detectLanguage();

    function applyLanguage() {
      const t = LANGUAGES[currentLang] || LANGUAGES['pt-BR'];
      // header / controls
      const h1 = document.querySelector('h1');
      if (h1) h1.textContent = t.title;
      const scoreNode = document.querySelector('.score');
      if (scoreNode) scoreNode.childNodes[0].nodeValue = t.points + ': ';
      const bestNode = document.querySelector('.best');
      if (bestNode) bestNode.childNodes[0].nodeValue = t.best + ': ';
      document.getElementById('btnStart').textContent = t.start;
      document.getElementById('btnPause').textContent = t.pause;
      document.getElementById('btnReset').textContent = t.reset;
      document.getElementById('btnResetRecord').textContent = t.resetRecord;
      document.getElementById('btnSettings').title = t.settings;
      document.getElementById('btnLeaderboard').title = t.leaderboard;
      const logoutBtn = document.getElementById('btnLogout');
      if (logoutBtn) logoutBtn.textContent = t.logout;

      // instructions
      const list = document.querySelector('.instructions ul');
      if (list) {
        list.innerHTML = `
          <li>${t.move}</li>
          <li>${t.swipe}</li>
          <li>${t.eat}</li>
          <li>${t.space}</li>
        `;
      }

      // auth modal
      const authTitle = document.getElementById('authTitle');
      if (authTitle) authTitle.textContent = t.loginTitle;
      const tabLogin = document.getElementById('tabLogin');
      const tabCreate = document.getElementById('tabCreate');
      if (tabLogin) tabLogin.textContent = t.loginTab;
      if (tabCreate) tabCreate.textContent = t.createTab;
      const btnLoginSubmit = document.getElementById('btnLoginSubmit');
      const btnCreateSubmit = document.getElementById('btnCreateSubmit');
      if (btnLoginSubmit) btnLoginSubmit.textContent = t.loginBtn;
      if (btnCreateSubmit) btnCreateSubmit.textContent = t.createBtn;

      // update placeholders for inputs
      const loginUser = document.getElementById('loginUser');
      const loginPass = document.getElementById('loginPass');
      const createUser = document.getElementById('createUser');
      const createPass = document.getElementById('createPass');
      const createPass2 = document.getElementById('createPass2');
      if (loginUser) loginUser.placeholder = t.username;
      if (loginPass) loginPass.placeholder = t.password;
      if (createUser) createUser.placeholder = t.username;
      if (createPass) createPass.placeholder = t.password;
      if (createPass2) createPass2.placeholder = t.passwordConfirm;

      // settings modal texts & options
      const settingsTitle = document.getElementById('settingsTitle');
      if (settingsTitle) settingsTitle.textContent = t.settings;
      const selectLevel = document.getElementById('selectLevel');
      if (selectLevel) {
        // set text of options
        selectLevel.querySelector('option[value="easy"]').textContent = t.levelEasy;
        selectLevel.querySelector('option[value="normal"]').textContent = t.levelNormal;
        selectLevel.querySelector('option[value="hard"]').textContent = t.levelHard;
      }
      const selectSkin = document.getElementById('selectSkin');
      if (selectSkin) {
        selectSkin.querySelector('option[value="neon"]').textContent = t.skinNeon;
        selectSkin.querySelector('option[value="sunset"]').textContent = t.skinSunset;
        selectSkin.querySelector('option[value="ocean"]').textContent = t.skinOcean;
      }
      const btnSaveSettings = document.getElementById('btnSaveSettings');
      const btnCloseSettings = document.getElementById('btnCloseSettings');
      if (btnSaveSettings) btnSaveSettings.textContent = t.save;
      if (btnCloseSettings) btnCloseSettings.textContent = t.close;

      // leader modal
      const leaderTitle = document.getElementById('leaderTitle');
      if (leaderTitle) leaderTitle.textContent = t.leaderTitle;
      const btnClearLeader = document.getElementById('btnClearLeader');
      if (btnClearLeader) btnClearLeader.textContent = t.clearLeader;

      // update UI indicator texts
      const uiLevel = document.getElementById('uiLevel');
      const uiSkin = document.getElementById('uiSkin');
      const uiHard = document.getElementById('uiHard');
      if (uiLevel) uiLevel.textContent = t.uiLevel;
      if (uiSkin) uiSkin.textContent = t.uiSkin;
      if (uiHard) uiHard.textContent = t.uiHardOff;

      // set langSelect value
      const sel = document.getElementById('langSelect');
      if (sel) sel.value = currentLang;
      // persist selected language globally
      localStorage.setItem('snake_lang', currentLang);
    }

    // language selector behavior
    document.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'langSelect') {
        currentLang = e.target.value;
        localStorage.setItem('snake_lang', currentLang);
        applyLanguage();
      }
    });

    // initial apply
    applyLanguage();

    /* -------------------------
       DOM elements
    -------------------------*/
    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    const scoreEl = document.getElementById('score');
    const bestEl = document.getElementById('best');
    const btnStart = document.getElementById('btnStart');
    const btnPause = document.getElementById('btnPause');
    const btnReset = document.getElementById('btnReset');
    const btnResetRecord = document.getElementById('btnResetRecord');
    const btnSettings = document.getElementById('btnSettings');
    const btnLeaderboard = document.getElementById('btnLeaderboard');
    const btnLogout = document.getElementById('btnLogout');
    const playerInfoEl = document.getElementById('playerInfo');
    const playerNameEl = document.getElementById('playerName');
    const uiLevel = document.getElementById('uiLevel');
    const uiSkin = document.getElementById('uiSkin');
    const uiHard = document.getElementById('uiHard');

    // Auth UI
    const authOverlay = document.getElementById('authOverlay');
    const tabLogin = document.getElementById('tabLogin');
    const tabCreate = document.getElementById('tabCreate');
    const formLogin = document.getElementById('formLogin');
    const formCreate = document.getElementById('formCreate');
    const loginUser = document.getElementById('loginUser');
    const loginPass = document.getElementById('loginPass');
    const createUser = document.getElementById('createUser');
    const createPass = document.getElementById('createPass');
    const createPass2 = document.getElementById('createPass2');
    const authMessage = document.getElementById('authMessage');

    // Settings modal
    const settingsModal = document.getElementById('settingsModal');
    const selectLevel = document.getElementById('selectLevel');
    const toggleHardMode = document.getElementById('toggleHardMode');
    const selectSkin = document.getElementById('selectSkin');
    const toggleSound = document.getElementById('toggleSound');
    const volumeRange = document.getElementById('volumeRange');
    const toggleBarriers = document.getElementById('toggleBarriers');
    const btnSaveSettings = document.getElementById('btnSaveSettings');
    const btnCloseSettings = document.getElementById('btnCloseSettings');

    // Leaderboard modal
    const leaderModal = document.getElementById('leaderModal');
    const leaderList = document.getElementById('leaderList');
    const btnCloseLeader = document.getElementById('btnCloseLeader');
    const btnClearLeader = document.getElementById('btnClearLeader');

    /* -------------------------
       Game config
    -------------------------*/
    const GRID = 20;
    let cols = 24, rows = 24;
    // base speed (ms). We'll change per level
    let baseSpeed = 120;
    let speed = baseSpeed;

    let snake = [];
    let dir = { x: 1, y: 0 };
    let nextDir = { x: 1, y: 0 };
    let food = null; // {x,y,type}
    let particles = [];
    let barriers = []; // obstacle list
    let running = false;
    let paused = false;
    let score = 0;
    let gameInterval = null;

    /* -------------------------
       Auth + storage
    -------------------------*/
    function loadUsers() {
      try { return JSON.parse(localStorage.getItem('snake_users') || '{}'); } catch { return {}; }
    }
    function saveUsers(u) { localStorage.setItem('snake_users', JSON.stringify(u)); }
    function setSession(username) { localStorage.setItem('snake_session', username); }
    function clearSession() { localStorage.removeItem('snake_session'); }
    function getSession() { return localStorage.getItem('snake_session') || null; }
    function encodePass(p) { try { return btoa(p); } catch { return p; } }
    function decodePass(p) { try { return atob(p); } catch { return p; } }

    function loadLeader() {
      try { return JSON.parse(localStorage.getItem('snake_leader') || '[]'); } catch { return []; }
    }
    function saveLeader(arr) { localStorage.setItem('snake_leader', JSON.stringify(arr)); }

    let users = loadUsers();
    let currentUser = getSession();

    const DEFAULT_SETTINGS = {
      level: 'normal',
      skin: 'neon',
      sound: true,
      volume: 0.6,
      barriers: false,
      hardMode: false
    };

    const FRUITS = [
      { id: 'apple', score: 10, colorA: '#ffb86b', colorB: '#ff6b6b', prob: 0.7 },
      { id: 'cherry', score: 20, colorA: '#ff7ab6', colorB: '#ff4a9a', prob: 0.25 },
      { id: 'star', score: 50, colorA: '#fff27a', colorB: '#ffd76b', prob: 0.05 }
    ];

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    function playTone(freq, type='sine', duration=0.12, gain=0.12) {
      if (!getCurrentSettings().sound) return;
      try {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = type;
        o.frequency.value = freq;
        g.gain.value = gain * getCurrentSettings().volume;
        o.connect(g); g.connect(audioCtx.destination);
        o.start();
        g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
        setTimeout(() => { try { o.stop(); } catch{} }, duration*1000 + 50);
      } catch(e){}
    }
    function playEatSound() { playTone(880, 'triangle', 0.08, 0.12); playTone(1320, 'sine', 0.12, 0.06); }
    function playDieSound() { playTone(120, 'sawtooth', 0.35, 0.18); playTone(80, 'sine', 0.35, 0.1); }
    function playClick() { playTone(1000, 'square', 0.06, 0.06); }

    function chooseFruit(level='normal') {
      const multiplier = level === 'easy' ? 1 : (level === 'normal' ? 1.1 : 1.4);
      const pool = [];
      FRUITS.forEach(f => {
        const count = Math.max(1, Math.round(f.prob * 100 * multiplier));
        for (let i=0;i<count;i++) pool.push(f);
      });
      return pool[Math.floor(Math.random() * pool.length)];
    }

    function spawnParticles(x,y,color,count=12) {
      for (let i=0;i<count;i++) {
        particles.push({
          x, y,
          vx: (Math.random()-0.5)*2.4,
          vy: (Math.random()-0.9)*2.4,
          life: 40 + Math.random()*30,
          color,
          size: 2 + Math.random()*3
        });
      }
    }
    function updateParticles() {
      for (let i = particles.length-1; i>=0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.06;
        p.life--;
        if (p.life <= 0) particles.splice(i,1);
      }
    }
    function drawParticles() {
      particles.forEach(p => {
        ctx.globalAlpha = Math.max(0, p.life/80);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI*2);
        ctx.fill();
        ctx.globalAlpha = 1;
      });
    }

    function resizeCanvasToCSS() {
      const maxWidth = canvas.parentElement.clientWidth;
      const size = Math.min(maxWidth, 680);
      canvas.width = size;
      canvas.height = size;
      cols = Math.floor(canvas.width / GRID);
      rows = Math.floor(canvas.height / GRID);
    }

    function initBarriersForLevel(level, count) {
      barriers = [];
      const attempts = 200;
      for (let k=0;k<count;k++) {
        let placed=false;
        for (let a=0;a<attempts && !placed;a++){
          const w = 1 + Math.floor(Math.random()*3);
          const h = 1 + Math.floor(Math.random()*3);
          const x = Math.floor(Math.random()*(cols - w));
          const y = Math.floor(Math.random()*(rows - h));
          const centerX = Math.floor(cols/2), centerY = Math.floor(rows/2);
          if (Math.abs(x-centerX)<4 && Math.abs(y-centerY)<4) continue;
          let ok=true;
          for (const b of barriers) {
            if (!(x+w < b.x || x > b.x+b.w-1 || y+h < b.y || y > b.y+b.h-1)) { ok=false; break; }
          }
          if (ok) { barriers.push({x,y,w,h}); placed=true; }
        }
      }
    }

    function startGame() {
      if (!currentUser) {
        showOverlay();
        showAuthMessage(LANGUAGES[currentLang].loginTitle || 'Faça login para começar.', 'err');
        return;
      }
      resizeCanvasToCSS();
      const cfg = getCurrentSettings();
      if (cfg.level === 'easy') baseSpeed = 160;
      else if (cfg.level === 'normal') baseSpeed = 120;
      else baseSpeed = 90;
      baseSpeed = Math.round(baseSpeed * (cfg.hardMode ? 0.85 : 1));
      speed = baseSpeed;

      snake = [{ x: Math.floor(cols / 2), y: Math.floor(rows / 2) }];
      dir = { x: 1, y: 0 }; nextDir = { x: 1, y: 0 };
      if (cfg.barriers) {
        const counts = cfg.level === 'easy' ? 3 : (cfg.level === 'normal' ? 6 : 10);
        initBarriersForLevel(cfg.level, counts);
      } else {
        barriers = [];
      }
      placeFood();
      score = 0; updateScoreUI();
      running = true; paused = false;
      clearInterval(gameInterval);
      gameInterval = setInterval(tick, speed);
      draw();
    }

    function pauseGame() {
      if (!running) return;
      paused = !paused;
      if (paused) clearInterval(gameInterval);
      else { clearInterval(gameInterval); gameInterval = setInterval(tick, speed); }
    }

    function resetGame() {
      clearInterval(gameInterval);
      running = false; paused = false;
      startGame();
    }

    function placeFood() {
      const cfg = getCurrentSettings();
      const fruitDef = chooseFruit(cfg.level);
      let valid=false, tries=0;
      while(!valid && tries<400) {
        const x = Math.floor(Math.random()*cols), y = Math.floor(Math.random()*rows);
        if (!snake.some(s=>s.x===x && s.y===y) && !barriers.some(b=> x>=b.x && x< b.x+b.w && y>=b.y && y< b.y+b.h)) {
          food = { x, y, type: fruitDef.id, score: fruitDef.score, colorA: fruitDef.colorA, colorB: fruitDef.colorB };
          valid=true;
        }
        tries++;
      }
      if (!valid) food = null;
    }

    function tick() {
      if (!(nextDir.x === -dir.x && nextDir.y === -dir.y)) dir = nextDir;
      const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
      const cfg = getCurrentSettings();
      const hard = cfg.hardMode;

      if (!hard) {
        if (head.x < 0) head.x = cols - 1;
        if (head.x >= cols) head.x = 0;
        if (head.y < 0) head.y = rows - 1;
        if (head.y >= rows) head.y = 0;
      } else {
        if (head.x < 0 || head.x >= cols || head.y < 0 || head.y >= rows) { gameOver(); return; }
      }

      if (barriers.some(b => head.x >= b.x && head.x < b.x+b.w && head.y >= b.y && head.y < b.y+b.h)) { gameOver(); return; }
      if (snake.some(p => p.x === head.x && p.y === head.y)) { gameOver(); return; }

      snake.unshift(head);

      if (food && head.x === food.x && head.y === food.y) {
        score += food.score;
        updateScoreUI();
        const centerX = (food.x + 0.5) * (canvas.width/cols);
        const centerY = (food.y + 0.5) * (canvas.height/rows);
        spawnParticles(centerX, centerY, food.colorA, 16);
        spawnParticles(centerX, centerY, food.colorB, 8);
        playEatSound();
        placeFood();

        if (score % 50 === 0 && speed > 40) {
          speed = Math.max(40, speed - 6);
          clearInterval(gameInterval);
          gameInterval = setInterval(tick, speed);
        }
      } else {
        snake.pop();
      }

      updateParticles();
      draw();
    }

    function updateScoreUI() {
      scoreEl.textContent = score;
      if (!currentUser) return;
      users = loadUsers();
      const uobj = users[currentUser] || { pass: encodePass(''), best: 0, settings: DEFAULT_SETTINGS };
      if (score > (uobj.best || 0)) {
        uobj.best = score;
        users[currentUser] = uobj;
        saveUsers(users);
        bestEl.textContent = uobj.best;
      }
    }

    function gameOver() {
      clearInterval(gameInterval);
      running = false;
      playDieSound();
      if (score > 0) {
        const leader = loadLeader();
        leader.push({ user: currentUser || 'Anon', score, date: new Date().toISOString() });
        leader.sort((a,b)=>b.score - a.score);
        saveLeader(leader.slice(0,200));
      }
      try {
        const prev = ctx.getImageData(0,0,canvas.width,canvas.height);
        ctx.fillStyle = 'rgba(255,20,20,0.14)';
        ctx.fillRect(0,0,canvas.width,canvas.height);
        setTimeout(()=>{ ctx.putImageData(prev,0,0); startGame(); }, 900);
      } catch(e){
        setTimeout(()=> startGame(), 800);
      }
    }

    function draw() {
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.save();
      ctx.fillStyle = '#06121a';
      roundRect(ctx, 0, 0, canvas.width, canvas.height, 12);
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = 'rgba(255,255,255,0.02)';
      ctx.lineWidth = 1;
      for (let i=0;i<cols;i++){
        const x = i*(canvas.width/cols)+0.5;
        ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke();
      }
      for (let j=0;j<rows;j++){
        const y = j*(canvas.height/rows)+0.5;
        ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke();
      }

      barriers.forEach(b=>{
        const w = canvas.width/cols * b.w;
        const h = canvas.height/rows * b.h;
        const x = b.x * (canvas.width/cols);
        const y = b.y * (canvas.height/rows);
        ctx.fillStyle = 'rgba(255,80,80,0.06)';
        roundRect(ctx, x+2, y+2, w-4, h-4, 6); ctx.fill();
        ctx.strokeStyle = 'rgba(255,80,80,0.12)';
        roundRect(ctx, x+2, y+2, w-4, h-4, 6); ctx.stroke();
      });

      if (food) {
        drawRoundedCell(food.x, food.y, (cellX, cellY, w, h) => {
          const gx = ctx.createRadialGradient(cellX + w/2, cellY + h/2, 2, cellX + w/2, cellY + h/2, w);
          gx.addColorStop(0, food.colorA); gx.addColorStop(1, food.colorB);
          ctx.fillStyle = gx;
          roundRect(ctx, cellX+2, cellY+2, w-4, h-4, 6);
          ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.fillRect(cellX + w*0.55, cellY + h*0.12, w*0.18, h*0.14);
        });
      }

      const skin = getCurrentSettings().skin || 'neon';
      for (let i=snake.length-1;i>=0;i--){
        const p = snake[i];
        const t = i / Math.max(1, snake.length-1);
        const colorA = skin === 'neon' ? `hsl(${160 - Math.floor(t*80)} 70% ${60 + Math.floor(t*20)}%)`
                     : skin === 'sunset' ? `hsl(${30 + Math.floor(t*30)} 80% ${50 + Math.floor(t*10)}%)`
                     : `hsl(${200 - Math.floor(t*40)} 60% ${45 + Math.floor(t*10)}%)`;
        const colorB = skin === 'neon' ? 'hsl(190 70% 40%)' : (skin === 'sunset' ? '#ff7b6b' : '#2ec4ff');
        drawRoundedCell(p.x, p.y, (x,y,w,h)=>{
          ctx.fillStyle = 'rgba(0,0,0,0.12)';
          ctx.fillRect(x+2,y+2,w,h);
          const g = ctx.createLinearGradient(x,y,x+w,y+h);
          g.addColorStop(0, colorA); g.addColorStop(1, colorB);
          ctx.fillStyle = g;
          roundRect(ctx,x,y,w,h,6); ctx.fill();
        });
      }

      const head = snake[0];
      if (head) {
        drawRoundedCell(head.x, head.y, (x,y,w,h)=>{
          ctx.fillStyle = 'rgba(255,255,255,0.12)';
          ctx.fillRect(x + w*0.12, y + h*0.06, w*0.76, h*0.28);
        });
      }

      drawParticles();
    }

    function drawRoundedCell(colIndex, rowIndex, drawFn) {
      const w = canvas.width / cols;
      const h = canvas.height / rows;
      const x = Math.round(colIndex * w);
      const y = Math.round(rowIndex * h);
      drawFn(x, y, Math.ceil(w), Math.ceil(h));
    }

    function roundRect(ctx, x, y, w, h, r) {
      if (w < 2*r) r = w/2;
      if (h < 2*r) r = h/2;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    window.addEventListener('keydown', e=>{
      if (!running && e.key === 'Enter' && currentUser) startGame();
      if (e.code === 'Space') { pauseGame(); }
      const map = {
        ArrowUp: { x:0, y:-1 }, ArrowDown:{x:0,y:1}, ArrowLeft:{x:-1,y:0}, ArrowRight:{x:1,y:0},
        KeyW:{x:0,y:-1}, KeyS:{x:0,y:1}, KeyA:{x:-1,y:0}, KeyD:{x:1,y:0}
      };
      const nd = map[e.code];
      if (nd) { if (!(nd.x === -dir.x && nd.y === -dir.y)) nextDir = nd; }
    });

    let touchStart = null;
    canvas.addEventListener('touchstart', e=>{
      if (e.touches.length===1) touchStart = { x:e.touches[0].clientX, y:e.touches[0].clientY };
    });
    canvas.addEventListener('touchend', e=>{
      if (!touchStart) return;
      const touchEnd = e.changedTouches[0];
      const dx = touchEnd.clientX - touchStart.x;
      const dy = touchEnd.clientY - touchStart.y;
      const absX = Math.abs(dx), absY = Math.abs(dy);
      if (Math.max(absX, absY) < 20) { touchStart = null; return; }
      if (absX > absY) nextDir = dx > 0 ? {x:1,y:0} : {x:-1,y:0};
      else nextDir = dy > 0 ? {x:0,y:1} : {x:0,y:-1};
      touchStart = null;
    });

    btnStart.addEventListener('click', ()=>{ if (!running) { playClick(); startGame(); } });
    btnPause.addEventListener('click', ()=>{ playClick(); pauseGame(); });
    btnReset.addEventListener('click', ()=>{ playClick(); resetGame(); });
    btnResetRecord.addEventListener('click', ()=>{
      const t = LANGUAGES[currentLang];
      if (!currentUser) { alert(t.loginTitle || 'Faça login para zerar o recorde.'); return; }
      if (!confirm((t.resetRecord || 'Reset record') + '?')) return;
      users = loadUsers();
      if (users[currentUser]) { users[currentUser].best = 0; saveUsers(users); bestEl.textContent = '0'; alert(t.resetRecord + ' done.'); }
    });

    btnSettings.addEventListener('click', ()=>{ playClick(); openSettings(); });
    btnCloseSettings.addEventListener('click', ()=>{ playClick(); closeSettings(); });
    btnSaveSettings.addEventListener('click', ()=>{ playClick(); saveSettingsFromUI(); });

    btnLeaderboard.addEventListener('click', ()=>{ playClick(); openLeader(); });
    btnCloseLeader.addEventListener('click', ()=>{ playClick(); closeLeader(); });
    btnClearLeader.addEventListener('click', ()=>{
      if (!confirm('Clear leaderboard?')) return;
      saveLeader([]); renderLeader(); alert('Leaderboard cleared.');
    });

    btnLogout.addEventListener('click', ()=>{
      pauseGame();
      clearSession();
      currentUser = null;
      playerInfoEl.style.display = 'none';
      playerNameEl.textContent = '—';
      btnLogout.style.display = 'none';
      bestEl.textContent = '0';
      showOverlay();
    });

    window.addEventListener('resize', ()=>{ if (running) resizeCanvasToCSS(); });

    function openSettings() {
      const cfg = getCurrentSettings();
      selectLevel.value = cfg.level || 'normal';
      toggleHardMode.checked = !!cfg.hardMode;
      selectSkin.value = cfg.skin || 'neon';
      toggleSound.checked = !!cfg.sound;
      volumeRange.value = (cfg.volume || 0.6);
      toggleBarriers.checked = !!cfg.barriers;
      settingsModal.classList.remove('hidden'); settingsModal.setAttribute('aria-hidden','false');
    }
    function closeSettings() {
      settingsModal.classList.add('hidden'); settingsModal.setAttribute('aria-hidden','true');
    }
    function saveSettingsFromUI() {
      if (!currentUser) { alert('Faça login para salvar configurações.'); return; }
      users = loadUsers();
      const u = users[currentUser] || { pass: encodePass(''), best:0, settings: DEFAULT_SETTINGS };
      u.settings = {
        level: selectLevel.value,
        skin: selectSkin.value,
        sound: toggleSound.checked,
        volume: parseFloat(volumeRange.value),
        barriers: toggleBarriers.checked,
        hardMode: toggleHardMode.checked
      };
      users[currentUser] = u;
      saveUsers(users);
      applySettingsToUI();
      closeSettings();
      alert('Configurações salvas.');
    }

    function applySettingsToUI() {
      const cfg = getCurrentSettings();
      const t = LANGUAGES[currentLang];
      uiLevel.textContent = (t.uiLevel || 'Nível') + ': ' + (t['level' + (cfg.level[0].toUpperCase() + cfg.level.slice(1))] || cfg.level);
      uiSkin.textContent = (t.uiSkin || 'Skin') + ': ' + (t['skin' + (cfg.skin[0].toUpperCase() + cfg.skin.slice(1))] || cfg.skin);
      uiHard.textContent = cfg.hardMode ? (t.uiHardOn || 'Ligado') : (t.uiHardOff || 'Desligado');
    }

    function getCurrentSettings() {
      users = loadUsers();
      if (currentUser && users[currentUser] && users[currentUser].settings) {
        return Object.assign({}, DEFAULT_SETTINGS, users[currentUser].settings);
      }
      return DEFAULT_SETTINGS;
    }

    function openLeader() { renderLeader(); leaderModal.classList.remove('hidden'); leaderModal.setAttribute('aria-hidden','false'); }
    function closeLeader() { leaderModal.classList.add('hidden'); leaderModal.setAttribute('aria-hidden','true'); }

    function renderLeader() {
      const arr = loadLeader().slice(0,20);
      if (!arr.length) leaderList.innerHTML = '<div class="leader-item">Nenhum resultado ainda.</div>';
      else {
        leaderList.innerHTML = arr.map((it,idx)=> {
          const d = new Date(it.date);
          return `<div class="leader-item"><div>#${idx+1} <strong>${escapeHtml(it.user)}</strong></div><div>${it.score} pts • ${d.toLocaleString()}</div></div>`;
        }).join('');
      }
    }

    function showAuthMessage(msg, type='') {
      authMessage.textContent = msg;
      authMessage.className = 'auth-message' + (type ? ' ' + type : '');
    }
    function showOverlay() { authOverlay.setAttribute('aria-hidden','false'); authOverlay.style.display='flex'; }
    function hideOverlay() { authOverlay.setAttribute('aria-hidden','true'); authOverlay.style.display='none'; }

    tabLogin.addEventListener('click', ()=>{
      tabLogin.classList.add('active'); tabCreate.classList.remove('active');
      formLogin.classList.remove('hidden'); formCreate.classList.add('hidden');
      showAuthMessage('');
    });
    tabCreate.addEventListener('click', ()=>{
      tabCreate.classList.add('active'); tabLogin.classList.remove('active');
      formCreate.classList.remove('hidden'); formLogin.classList.add('hidden');
      showAuthMessage('');
    });

    formCreate.addEventListener('submit', e=>{
      e.preventDefault();
      const u = (createUser.value||'').trim();
      const p1 = createPass.value||'';
      const p2 = createPass2.value||'';
      if (u.length < 3) { showAuthMessage('Usuário precisa ter ao menos 3 caracteres.', 'err'); return; }
      if (p1.length < 4) { showAuthMessage('Senha precisa ter ao menos 4 caracteres.', 'err'); return; }
      if (p1 !== p2) { showAuthMessage('As senhas não coincidem.', 'err'); return; }
      users = loadUsers();
      if (users[u]) { showAuthMessage('Usuário já existe. Escolha outro nome.', 'err'); return; }
      users[u] = { pass: encodePass(p1), best: 0, settings: DEFAULT_SETTINGS };
      saveUsers(users);
      showAuthMessage('Conta criada! Faça login.', 'ok');
      createUser.value=''; createPass.value=''; createPass2.value='';
      tabLogin.click();
    });

    formLogin.addEventListener('submit', e=>{
      e.preventDefault();
      const u = (loginUser.value||'').trim();
      const p = loginPass.value||'';
      users = loadUsers();
      if (!users[u]) { showAuthMessage('Usuário não encontrado.', 'err'); return; }
      if (decodePass(users[u].pass) !== p) { showAuthMessage('Senha incorreta.', 'err'); return; }
      currentUser = u; setSession(u);
      showAuthMessage('Login efetuado. Bem-vindo, ' + u + '!', 'ok');
      initializeForUser(u);
      setTimeout(()=>{ hideOverlay(); }, 300);
    });

    function initializeForUser(username) {
      users = loadUsers();
      const urec = users[username] || { best: 0, settings: DEFAULT_SETTINGS };
      playerInfoEl.style.display = 'inline-block';
      playerNameEl.textContent = username;
      btnLogout.style.display = 'inline-block';
      bestEl.textContent = (urec.best || 0);
      applySettingsToUI();
      applyLanguage();
      startGame();
    }

    if (currentUser && users[currentUser]) {
      initializeForUser(currentUser);
      hideOverlay();
    } else {
      showOverlay();
    }

    function escapeHtml(s){ return (s+'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

    function updatePlayerUI() {
      if (currentUser) {
        playerInfoEl.style.display='inline-block';
        playerNameEl.textContent = currentUser;
        btnLogout.style.display='inline-block';
      } else {
        playerInfoEl.style.display='none';
        playerNameEl.textContent='—';
        btnLogout.style.display='none';
      }
      applySettingsToUI();
    }

    function animLoop() {
      if (running) {
        updateParticles();
        draw();
      }
      requestAnimationFrame(animLoop);
    }
    animLoop();

    resizeCanvasToCSS();

    function getCurrentSettings() { return getCurrentSettings_real(); }
    function getCurrentSettings_real() {
      users = loadUsers();
      if (currentUser && users[currentUser] && users[currentUser].settings) {
        return Object.assign({}, DEFAULT_SETTINGS, users[currentUser].settings);
      }
      return DEFAULT_SETTINGS;
    }

    updatePlayerUI();

    document.addEventListener('click', ()=>{ try{ if (audioCtx.state === 'suspended') audioCtx.resume(); }catch(e){} }, { once:true });

  }); // DOMContentLoaded
} // guard
