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
