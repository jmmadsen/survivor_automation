/* ============================================
   TEMPLE'S MADNESS SURVIVOR POOL
   Dashboard application
   ============================================ */

(function () {
  'use strict';

  // ── Global State ──────────────────────────────
  let DATA = null;
  let currentTab = 'home';
  let boardFilter = 'all';
  let boardSort = { key: 'rank', dir: 'asc' };
  let expandedRow = null;
  let pickDistChart = null;
  let seedDistChart = null;
  let homeSurvivalChart = null;
  let statsSurvivalChart = null;

  // ── Boot ──────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    try {
      const resp = await fetch('data/pool.json');
      if (!resp.ok) throw new Error('Failed to load pool data');
      DATA = await resp.json();
    } catch (err) {
      console.error('Data load error:', err);
      document.querySelector('.app-main').innerHTML =
        '<div style="padding:40px;text-align:center;color:#ef4444;">' +
        '<h2 style="font-family:var(--font-display);letter-spacing:2px;">DATA UNAVAILABLE</h2>' +
        '<p style="margin-top:8px;color:#94a3b8;">Could not load pool.json. Make sure the data file exists.</p></div>';
      return;
    }

    setupTabs();
    renderHome();
    renderBoard();
    renderStats();
    setupPlayerSearch();

    // Handle initial hash
    const hash = window.location.hash.replace('#', '');
    if (['home', 'board', 'stats', 'players'].includes(hash)) {
      switchTab(hash);
    }
  }

  // ── Tab Navigation ────────────────────────────

  function setupTabs() {
    const allTabBtns = document.querySelectorAll('[data-tab]');
    allTabBtns.forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // "See all" links
    document.querySelectorAll('[data-goto]').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.goto));
    });

    window.addEventListener('hashchange', () => {
      const h = window.location.hash.replace('#', '');
      if (['home', 'board', 'stats', 'players'].includes(h)) {
        switchTab(h, false);
      }
    });
  }

  function switchTab(tab, pushHash = true) {
    currentTab = tab;
    if (pushHash) window.location.hash = '#' + tab;

    // Update tab buttons
    document.querySelectorAll('[data-tab]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Show/hide content
    document.querySelectorAll('.tab-content').forEach(sec => {
      sec.classList.toggle('active', sec.id === 'tab-' + tab);
    });

    // Resize charts after tab switch
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 50);
  }

  // ── HOME TAB ──────────────────────────────────

  function renderHome() {
    const meta = DATA.meta;

    // Hero stats
    setText('heroAlive', meta.alive_players);
    setText('heroTotal', meta.total_players);
    setText('heroDay', 'Day ' + meta.current_day);
    setText('heroPot', '$' + meta.pot.toLocaleString());
    setText('navPot', '$' + meta.pot.toLocaleString());

    // Alive bar
    const pct = (meta.alive_players / meta.total_players) * 100;
    document.getElementById('heroAliveBar').style.width = pct + '%';

    // Recap
    renderRecap();

    // Top 3
    renderTop3();

    // Survival curve (small)
    renderSurvivalChart('homeSurvivalChart', false);

    // Superlatives
    renderSuperlatives();

    // Home search
    setupHomeSearch();
  }

  function renderRecap() {
    const latestDay = DATA.daily_results[DATA.daily_results.length - 1];
    if (!latestDay) return;
    const s = latestDay.stats;

    setText('recapDay', latestDay.label);

    const templates = [
      () => {
        const elim = latestDay.eliminations;
        const names = elim.map(e => e.player).join(', ');
        const upsetCount = latestDay.upsets.length;
        return `<p>Day ${latestDay.day} was <span class="recap-highlight">absolutely ruthless</span>. ` +
          `<strong>${s.eliminated - (DATA.daily_results.length > 1 ? DATA.daily_results[DATA.daily_results.length - 2].stats.eliminated : 0)}</strong> more survivors bit the dust, ` +
          `leaving us with <span class="recap-alive">${s.survivors} souls still standing</span>.</p>` +
          `<p style="margin-top:8px;"><span class="recap-dead">${s.deadliest_team.team}</span> (${s.deadliest_team.seed}-seed) was the grim reaper, ` +
          `claiming ${s.deadliest_team.kills} victim${s.deadliest_team.kills > 1 ? 's' : ''}. ` +
          (upsetCount > 0 ? `We saw <span class="recap-highlight">${upsetCount} upset${upsetCount > 1 ? 's' : ''}</span> that shook the bracket. ` : '') +
          `Meanwhile, <span class="recap-highlight">${s.biggest_degen_pick.player}</span> picked ` +
          `#${s.biggest_degen_pick.seed} <strong>${s.biggest_degen_pick.team}</strong> like an absolute degen ` +
          `and <span class="recap-alive">${s.biggest_degen_pick.result === 'win' ? 'SURVIVED' : ''}</span>` +
          `${s.biggest_degen_pick.result === 'loss' ? '<span class="recap-dead">got wrecked</span>' : ''}.</p>` +
          `<p style="margin-top:8px;">The chalk crowd rallied behind <strong>${s.most_picked_today.team}</strong> ` +
          `(${s.most_picked_today.count} picks) — ${s.most_picked_today.result === 'win' ? 'and they lived to fight another day.' : 'and they all went home crying.'}</p>`;
      },
      () => {
        return `<p><span class="recap-highlight">${latestDay.label}</span> is in the books. ` +
          `<strong>${s.survivors}</strong> of ${DATA.meta.total_players} remain, fighting for the <span class="recap-highlight">$${DATA.meta.pot} pot</span>.</p>` +
          `<p style="margin-top:8px;">The most popular pick was <strong>${s.most_picked_today.team}</strong> ` +
          `(grabbed by ${s.most_picked_today.count} players). ` +
          `${s.most_picked_today.result === 'win' ? 'They coasted through.' : 'Oof. Mass extinction event.'} ` +
          `<span class="recap-highlight">${s.degen_king.player}</span> went full degen with ` +
          `a #${s.degen_king.seed} <strong>${s.degen_king.team}</strong> pick — absolute madlad behavior.</p>` +
          `<p style="margin-top:8px;"><span class="recap-dead">${s.deadliest_team.team}</span> ended dreams today. ` +
          `${s.chalk_king.player} played it safe with #${s.chalk_king.seed} ${s.chalk_king.team}. ` +
          `Boring? Maybe. Still alive? Yes.</p>`;
      }
    ];

    const idx = latestDay.day % templates.length;
    document.getElementById('recapBody').innerHTML = templates[idx]();
  }

  function renderTop3() {
    const alive = DATA.players
      .filter(p => p.status === 'alive')
      .sort((a, b) => b.degen_score - a.degen_score)
      .slice(0, 3);

    const container = document.getElementById('top3');
    container.innerHTML = alive.map((p, i) => `
      <div class="top3-row" data-player="${esc(p.name)}">
        <span class="top3-rank rank-${i + 1}">${i + 1}</span>
        <span class="top3-name">${esc(p.name)}</span>
        <span class="top3-score">${p.degen_score}<span class="top3-score-label">pts</span></span>
      </div>
    `).join('');

    container.querySelectorAll('.top3-row').forEach(row => {
      row.addEventListener('click', () => {
        switchTab('players');
        setTimeout(() => selectPlayer(row.dataset.player), 100);
      });
    });
  }

  function renderSuperlatives() {
    const latestDay = DATA.daily_results[DATA.daily_results.length - 1];
    if (!latestDay) return;
    const s = latestDay.stats;

    const cards = [
      {
        emoji: '&#129297;',
        title: 'DEGEN OF THE DAY',
        value: s.degen_king.player,
        sub: '#' + s.degen_king.seed + ' ' + s.degen_king.team
      },
      {
        emoji: '&#128128;',
        title: 'DEADLIEST TEAM',
        value: s.deadliest_team.team,
        sub: s.deadliest_team.kills + ' kill' + (s.deadliest_team.kills > 1 ? 's' : '')
      },
      {
        emoji: '&#128076;',
        title: 'CHALK KING',
        value: s.chalk_king.player,
        sub: '#' + s.chalk_king.seed + ' ' + s.chalk_king.team
      },
      {
        emoji: '&#128293;',
        title: 'MOST POPULAR',
        value: s.most_picked_today.team,
        sub: s.most_picked_today.count + ' picks — ' + s.most_picked_today.result
      }
    ];

    document.getElementById('superlativesGrid').innerHTML = cards.map(c => `
      <div class="superlative-card">
        <span class="superlative-emoji">${c.emoji}</span>
        <div class="superlative-title">${c.title}</div>
        <div class="superlative-value">${esc(c.value)}</div>
        <div class="superlative-sub">${c.sub}</div>
      </div>
    `).join('');
  }

  function setupHomeSearch() {
    const input = document.getElementById('homeSearch');
    const results = document.getElementById('homeSearchResults');
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (q.length < 1) { results.classList.remove('visible'); return; }
      const matches = DATA.players.filter(p => p.name.toLowerCase().includes(q)).slice(0, 5);
      if (matches.length === 0) { results.classList.remove('visible'); return; }
      results.innerHTML = matches.map(p => `
        <div class="search-result-item" data-player="${esc(p.name)}">
          <span class="search-result-name">${esc(p.name)}</span>
          <span class="search-result-meta">${p.status === 'alive' ? '&#128994;' : '&#128308;'} Rank #${p.rank}</span>
        </div>
      `).join('');
      results.classList.add('visible');
      results.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
          switchTab('players');
          setTimeout(() => selectPlayer(item.dataset.player), 100);
          results.classList.remove('visible');
          input.value = '';
        });
      });
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.home-search')) results.classList.remove('visible');
    });
  }

  // ── BOARD TAB ─────────────────────────────────

  function renderBoard() {
    const searchInput = document.getElementById('boardSearch');
    searchInput.addEventListener('input', () => renderBoardRows());

    // Filters
    document.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        boardFilter = btn.dataset.filter;
        renderBoardRows();
      });
    });

    // Sortable headers
    document.querySelectorAll('.th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (boardSort.key === key) {
          boardSort.dir = boardSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          boardSort.key = key;
          boardSort.dir = key === 'name' ? 'asc' : (key === 'degen_score' ? 'desc' : 'asc');
        }
        document.querySelectorAll('.th').forEach(t => t.classList.remove('sort-active'));
        th.classList.add('sort-active');
        renderBoardRows();
      });
    });

    renderBoardRows();
  }

  function renderBoardRows() {
    const query = document.getElementById('boardSearch').value.trim().toLowerCase();
    let players = [...DATA.players];

    // Filter
    if (boardFilter === 'alive') players = players.filter(p => p.status === 'alive');
    if (boardFilter === 'eliminated') players = players.filter(p => p.status === 'eliminated');

    // Search
    if (query.length > 0) {
      players = players.filter(p => p.name.toLowerCase().includes(query));
    }

    // Sort
    players.sort((a, b) => {
      let va = a[boardSort.key];
      let vb = b[boardSort.key];
      if (boardSort.key === 'name') {
        va = va.toLowerCase(); vb = vb.toLowerCase();
      }
      if (boardSort.key === 'status') {
        va = va === 'alive' ? 0 : 1;
        vb = vb === 'alive' ? 0 : 1;
      }
      if (va < vb) return boardSort.dir === 'asc' ? -1 : 1;
      if (va > vb) return boardSort.dir === 'asc' ? 1 : -1;
      return 0;
    });

    const tbody = document.getElementById('tableBody');
    tbody.innerHTML = players.map(p => {
      const isElim = p.status === 'eliminated';
      return `
        <div class="table-row ${isElim ? 'eliminated-row' : ''}" data-player="${esc(p.name)}">
          <div class="td-rank">${p.rank}</div>
          <div class="td-name">${esc(p.name)}</div>
          <div class="td-score">${p.degen_score}</div>
          <div class="td-status">
            <span class="status-badge ${p.status}">${p.status === 'alive' ? 'ALIVE' : 'OUT'}</span>
          </div>
        </div>
        <div class="picks-row" data-picks-for="${esc(p.name)}">
          <div class="picks-label">Pick History</div>
          <div class="picks-list">
            ${p.picks.map(pk => `
              <span class="pick-pill ${pk.result}">
                ${esc(pk.team)} <span class="pill-seed">(${pk.seed})</span>
              </span>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');

    // Row expand/collapse
    tbody.querySelectorAll('.table-row').forEach(row => {
      row.addEventListener('click', () => {
        const name = row.dataset.player;
        const picksRow = tbody.querySelector(`.picks-row[data-picks-for="${name}"]`);
        if (expandedRow === name) {
          row.classList.remove('expanded');
          picksRow.classList.remove('visible');
          expandedRow = null;
        } else {
          // Collapse previous
          tbody.querySelectorAll('.table-row.expanded').forEach(r => r.classList.remove('expanded'));
          tbody.querySelectorAll('.picks-row.visible').forEach(r => r.classList.remove('visible'));
          row.classList.add('expanded');
          picksRow.classList.add('visible');
          expandedRow = name;
        }
      });
    });
  }

  // ── STATS TAB ─────────────────────────────────

  function renderStats() {
    // Day selector
    const sel = document.getElementById('daySelect');
    DATA.daily_results.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d.day;
      opt.textContent = d.label;
      sel.appendChild(opt);
    });
    sel.value = DATA.daily_results[DATA.daily_results.length - 1].day;
    sel.addEventListener('change', () => {
      renderPickDistribution(parseInt(sel.value));
      renderSeedDistribution(parseInt(sel.value));
    });

    renderPickDistribution(DATA.daily_results[DATA.daily_results.length - 1].day);
    renderSurvivalChart('statsSurvivalChart', true);
    renderOverlap();
    renderSeedDistribution(DATA.daily_results[DATA.daily_results.length - 1].day);
  }

  function renderPickDistribution(dayNum) {
    const dayData = DATA.daily_results.find(d => d.day === dayNum);
    if (!dayData) return;

    // Count picks for this day
    const pickCounts = {};
    DATA.players.forEach(p => {
      const pick = p.picks.find(pk => pk.day === dayNum);
      if (pick) {
        if (!pickCounts[pick.team]) pickCounts[pick.team] = { count: 0, result: pick.result, seed: pick.seed };
        pickCounts[pick.team].count++;
      }
    });

    const sorted = Object.entries(pickCounts).sort((a, b) => b[1].count - a[1].count);
    const labels = sorted.map(([team, d]) => team + ' (' + d.seed + ')');
    const counts = sorted.map(([, d]) => d.count);
    const colors = sorted.map(([, d]) => {
      if (d.result === 'win') return 'rgba(34, 197, 94, 0.8)';
      if (d.result === 'loss') return 'rgba(239, 68, 68, 0.8)';
      return 'rgba(234, 179, 8, 0.8)';
    });
    const borderColors = sorted.map(([, d]) => {
      if (d.result === 'win') return '#22c55e';
      if (d.result === 'loss') return '#ef4444';
      return '#eab308';
    });

    if (pickDistChart) pickDistChart.destroy();

    const ctx = document.getElementById('pickDistChart').getContext('2d');
    pickDistChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Picks',
          data: counts,
          backgroundColor: colors,
          borderColor: borderColors,
          borderWidth: 1,
          borderRadius: 4,
          barPercentage: 0.7
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1e2538',
            titleColor: '#f1f5f9',
            bodyColor: '#94a3b8',
            borderColor: 'rgba(148,163,184,0.15)',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: function (ctx) {
                return ctx.raw + ' player' + (ctx.raw > 1 ? 's' : '');
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { color: '#64748b', stepSize: 1, font: { size: 11 } },
            grid: { color: 'rgba(148,163,184,0.06)' }
          },
          y: {
            ticks: { color: '#94a3b8', font: { size: 12 } },
            grid: { display: false }
          }
        }
      }
    });
  }

  function renderSurvivalChart(canvasId, full) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    const curve = DATA.survival_curve;

    const labels = curve.map(d => d.label);
    const values = curve.map(d => d.alive);

    const gradient = ctx.createLinearGradient(0, 0, 0, full ? 280 : 220);
    gradient.addColorStop(0, 'rgba(251, 191, 36, 0.3)');
    gradient.addColorStop(1, 'rgba(251, 191, 36, 0.02)');

    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Survivors',
          data: values,
          borderColor: '#fbbf24',
          backgroundColor: gradient,
          borderWidth: 3,
          fill: true,
          tension: 0.3,
          pointBackgroundColor: '#fbbf24',
          pointBorderColor: '#0f1419',
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1e2538',
            titleColor: '#f1f5f9',
            bodyColor: '#fbbf24',
            borderColor: 'rgba(148,163,184,0.15)',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: function (ctx) {
                return ctx.raw + ' alive';
              }
            }
          }
        },
        scales: {
          x: {
            ticks: { color: '#94a3b8', font: { size: 11 } },
            grid: { color: 'rgba(148,163,184,0.06)' }
          },
          y: {
            beginAtZero: true,
            max: DATA.meta.total_players + 2,
            ticks: { color: '#64748b', stepSize: 5, font: { size: 11 } },
            grid: { color: 'rgba(148,163,184,0.06)' }
          }
        }
      }
    });

    if (canvasId === 'homeSurvivalChart') homeSurvivalChart = chart;
    else statsSurvivalChart = chart;
  }

  function renderOverlap() {
    const overlap = DATA.predictions.pick_overlap;
    const sorted = Object.entries(overlap)
      .filter(([, d]) => d.alive_users_used > 0)
      .sort((a, b) => b[1].alive_users_used - a[1].alive_users_used);

    const maxCount = Math.max(...sorted.map(([, d]) => d.alive_users_used), 1);
    const container = document.getElementById('overlapList');

    container.innerHTML = sorted.map(([team, d]) => {
      const pct = (d.alive_users_used / maxCount) * 100;
      return `
        <div class="overlap-item">
          <span class="overlap-team">${esc(team)}</span>
          <div class="overlap-bar-bg">
            <div class="overlap-bar-fill" style="width:${pct}%"></div>
          </div>
          <span class="overlap-count">${d.alive_users_used}</span>
        </div>
      `;
    }).join('');
  }

  function renderSeedDistribution(dayNum) {
    const seedCounts = {};
    DATA.players.forEach(p => {
      const pick = p.picks.find(pk => pk.day === dayNum);
      if (pick) {
        const s = pick.seed;
        if (!seedCounts[s]) seedCounts[s] = 0;
        seedCounts[s]++;
      }
    });

    const seeds = Object.keys(seedCounts).map(Number).sort((a, b) => a - b);
    const counts = seeds.map(s => seedCounts[s]);

    // Color gradient from green (safe/low seed) to red (degen/high seed)
    const colors = seeds.map(s => {
      const ratio = (s - 1) / 15;
      const r = Math.round(34 + (239 - 34) * ratio);
      const g = Math.round(197 - (197 - 68) * ratio);
      const b = Math.round(94 - (94 - 68) * ratio);
      return `rgba(${r}, ${g}, ${b}, 0.8)`;
    });

    if (seedDistChart) seedDistChart.destroy();

    const ctx = document.getElementById('seedDistChart').getContext('2d');
    seedDistChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: seeds.map(s => '#' + s),
        datasets: [{
          label: 'Picks',
          data: counts,
          backgroundColor: colors,
          borderRadius: 6,
          barPercentage: 0.6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#1e2538',
            titleColor: '#f1f5f9',
            bodyColor: '#94a3b8',
            borderColor: 'rgba(148,163,184,0.15)',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8
          }
        },
        scales: {
          x: {
            ticks: { color: '#94a3b8', font: { size: 12 } },
            grid: { display: false }
          },
          y: {
            beginAtZero: true,
            ticks: { color: '#64748b', stepSize: 1, font: { size: 11 } },
            grid: { color: 'rgba(148,163,184,0.06)' }
          }
        }
      }
    });
  }

  // ── PLAYERS TAB ───────────────────────────────

  function setupPlayerSearch() {
    const input = document.getElementById('playerSearch');
    const dropdown = document.getElementById('playerDropdown');

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (q.length < 1) { dropdown.classList.remove('visible'); return; }
      const matches = DATA.players.filter(p => p.name.toLowerCase().includes(q)).slice(0, 8);
      if (matches.length === 0) { dropdown.classList.remove('visible'); return; }

      dropdown.innerHTML = matches.map(p => `
        <div class="search-result-item" data-player="${esc(p.name)}">
          <span class="search-result-name">${esc(p.name)}</span>
          <span class="search-result-meta">${p.status === 'alive' ? '&#128994;' : '&#128308;'} #${p.rank} &middot; ${p.degen_score} pts</span>
        </div>
      `).join('');
      dropdown.classList.add('visible');

      dropdown.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
          selectPlayer(item.dataset.player);
          dropdown.classList.remove('visible');
          input.value = '';
        });
      });
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#tab-players .search-container')) dropdown.classList.remove('visible');
    });
  }

  function selectPlayer(name) {
    const player = DATA.players.find(p => p.name === name);
    if (!player) return;

    const card = document.getElementById('playerCard');
    const prompt = document.getElementById('playerPrompt');
    card.style.display = 'block';
    prompt.style.display = 'none';

    // Avatar
    document.getElementById('playerAvatar').textContent = player.name.charAt(0).toUpperCase();

    // Info
    setText('playerName', player.name);
    const statusEl = document.getElementById('playerStatus');
    statusEl.textContent = player.status.toUpperCase();
    statusEl.className = 'player-status ' + player.status;
    setText('playerRank', 'Rank #' + player.rank);
    setText('playerDegenScore', player.degen_score);

    // Timeline
    const timeline = document.getElementById('playerTimeline');
    timeline.innerHTML = player.picks.map(pk => `
      <div class="timeline-day">
        <span class="timeline-day-label">Day ${pk.day}</span>
        <span class="pick-pill ${pk.result}">
          ${esc(pk.team)} <span class="pill-seed">(${pk.seed})</span>
        </span>
      </div>
    `).join('');

    // Degen breakdown table
    const breakdown = document.getElementById('degenBreakdown');
    breakdown.innerHTML = `
      <table class="degen-table">
        <thead>
          <tr><th>DAY</th><th>TEAM</th><th>SEED</th><th>RESULT</th></tr>
        </thead>
        <tbody>
          ${player.picks.map(pk => `
            <tr>
              <td>${pk.day}</td>
              <td>${esc(pk.team)}</td>
              <td class="seed-col">${pk.seed}</td>
              <td><span class="pick-pill ${pk.result}" style="font-size:11px;padding:3px 8px;">${pk.result.toUpperCase()}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    // Avg seed
    const avgSeed = player.picks.reduce((sum, pk) => sum + pk.seed, 0) / player.picks.length;
    const avgContainer = document.getElementById('avgSeed');
    avgContainer.innerHTML = `
      <span class="avg-seed-label">Average Seed Picked</span>
      <div class="avg-seed-value">${avgSeed.toFixed(1)}</div>
    `;
  }

  // ── Utilities ─────────────────────────────────

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function esc(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

})();
