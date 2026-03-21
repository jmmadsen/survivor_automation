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
    const pot = meta.total_players * 25;
    setText('heroPot', '$' + pot.toLocaleString());
    setText('navPot', '$' + pot.toLocaleString());

    // Alive bar
    const pct = (meta.alive_players / meta.total_players) * 100;
    document.getElementById('heroAliveBar').style.width = pct + '%';

    // Recap
    renderRecap();

    // Top players
    renderTopPlayers();

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

    // Add dateline above the body
    const recapCard = document.getElementById('recapCard');
    const recapBody = document.getElementById('recapBody');
    let dateline = recapCard.querySelector('.recap-dateline');
    if (!dateline) {
      dateline = document.createElement('div');
      dateline.className = 'recap-dateline';
      recapBody.parentNode.insertBefore(dateline, recapBody);
    }
    dateline.textContent = latestDay.date + ' \u2014 ' + latestDay.label.toUpperCase();

    const prevElim = DATA.daily_results.length > 1
      ? DATA.daily_results[DATA.daily_results.length - 2].stats.eliminated
      : 0;
    const todayKilled = s.eliminated - prevElim;
    const upsetCount = latestDay.upsets ? latestDay.upsets.length : 0;

    const templates = [
      () => {
        let out = `<p>${todayKilled} more people got sent home today. ` +
          `We're down to <strong>${s.survivors}</strong> out of ${DATA.meta.total_players}, ` +
          `and the $${DATA.meta.pot} pot is starting to look real interesting for whoever's left standing.</p>`;

        out += `<p><strong>${s.deadliest_team.team}</strong> was the grim reaper today, ` +
          `taking out ${s.deadliest_team.kills} player${s.deadliest_team.kills > 1 ? 's' : ''} who probably should have known better. ` +
          (upsetCount > 0
            ? `${upsetCount} upset${upsetCount > 1 ? 's' : ''} wrecked some brackets too, because March does what March does.`
            : `No major upsets though, so if you got eliminated today you really have no excuse.`) +
          `</p>`;

        const degenResult = s.biggest_degen_pick.result === 'win'
          ? `walked away alive like some kind of degenerate savant`
          : `went down in flames, shocking absolutely nobody`;
        out += `<p><strong>${s.biggest_degen_pick.player}</strong> picked ` +
          `${s.biggest_degen_pick.seed}-seed <strong>${s.biggest_degen_pick.team}</strong> and ${degenResult}. ` +
          `Meanwhile ${s.most_picked_today.count} people piled onto <strong>${s.most_picked_today.team}</strong> ` +
          `because originality is dead` +
          `${s.most_picked_today.result === 'win' ? ' \u2014 at least they survived.' : ' \u2014 and so are they.'}</p>`;
        return out;
      },
      () => {
        const chalkLine = s.chalk_king
          ? `<strong>${s.chalk_king.player}</strong> played it safer than a helmet in a bouncy castle with ` +
            `${s.chalk_king.seed}-seed <strong>${s.chalk_king.team}</strong>. Boring? Absolutely. Still breathing? Also yes.`
          : '';

        let out = `<p>Another day, another bloodbath. <strong>${s.survivors}</strong> survivors remain and ` +
          `${todayKilled} poor soul${todayKilled > 1 ? 's' : ''} just got vaporized. ` +
          `The pot sits at <strong>$${DATA.meta.pot}</strong> and it's only Day ${latestDay.day}.</p>`;

        out += `<p><strong>${s.most_picked_today.team}</strong> was the herd pick with ` +
          `${s.most_picked_today.count} people riding that bandwagon. ` +
          `${s.most_picked_today.result === 'win' ? 'They coasted.' : 'The wheels came off. Spectacularly.'} ` +
          `On the other end of the sanity spectrum, <strong>${s.biggest_degen_pick.player}</strong> grabbed ` +
          `${s.biggest_degen_pick.seed}-seed <strong>${s.biggest_degen_pick.team}</strong> because apparently ` +
          `they have a death wish AND a gambling problem` +
          `${s.biggest_degen_pick.result === 'win' ? ' \u2014 and somehow lived to tell about it.' : '.'}</p>`;

        if (chalkLine) {
          out += `<p>${chalkLine}</p>`;
        }
        return out;
      }
    ];

    const idx = latestDay.day % templates.length;
    recapBody.innerHTML = templates[idx]();
  }

  function renderTopPlayers() {
    const medals = ['\u{1F947}', '\u{1F948}', '\u{1F949}'];
    const alive = DATA.players
      .filter(p => p.status === 'alive')
      .sort((a, b) => b.degen_score - a.degen_score)
      .slice(0, 10);

    const container = document.getElementById('top3');
    container.innerHTML = alive.map((p, i) => {
      const rankDisplay = i < 3
        ? `<span class="top3-rank rank-${i + 1}">${medals[i]}</span>`
        : `<span class="top3-rank">${i + 1}</span>`;
      return `
        <div class="top3-row" data-player="${esc(p.name)}">
          ${rankDisplay}
          <span class="top3-name">${esc(p.name)}</span>
          <span class="top3-score">${p.degen_score}<span class="top3-score-label">pts</span></span>
        </div>
      `;
    }).join('') +
    `<button class="view-full-board" data-goto="board">View Full Board \u2192</button>`;

    container.querySelectorAll('.top3-row').forEach(row => {
      row.addEventListener('click', () => {
        switchTab('players');
        setTimeout(() => selectPlayer(row.dataset.player), 100);
      });
    });

    container.querySelector('.view-full-board').addEventListener('click', () => {
      switchTab('board');
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
        value: s.biggest_degen_pick.player,
        sub: '#' + s.biggest_degen_pick.seed + ' ' + s.biggest_degen_pick.team
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
          <div class="picks-inner">
            <div class="picks-label">Pick History</div>
            <div class="picks-list">
              ${p.picks.map(pk => `
                <span class="pick-pill ${pk.result}">
                  ${esc(pk.team)} <span class="pill-seed">(${pk.seed})</span>
                </span>
              `).join('')}
            </div>
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
          const oldOverlay = picksRow.querySelector('.death-overlay');
          if (oldOverlay) oldOverlay.remove();
          expandedRow = null;
        } else {
          // Collapse previous
          tbody.querySelectorAll('.table-row.expanded').forEach(r => r.classList.remove('expanded'));
          tbody.querySelectorAll('.picks-row.visible').forEach(r => {
            r.classList.remove('visible');
            const ov = r.querySelector('.death-overlay');
            if (ov) ov.remove();
          });
          row.classList.add('expanded');
          picksRow.classList.add('visible');
          expandedRow = name;

          // Death animation for eliminated players — hide picks until animation finishes
          const player = DATA.players.find(p => p.name === name);
          const picksContent = picksRow.querySelector('.picks-inner');
          if (player && player.status === 'eliminated' && picksContent) {
            picksContent.classList.add('picks-hidden');

            const words = ['WASTED', 'FATALITY', 'ELIMINATED', 'RIP'];
            const styles = ['death-wasted', 'death-fatality', 'death-eliminated', 'death-rip'];
            const pick = Math.floor(Math.random() * words.length);

            const overlay = document.createElement('div');
            overlay.className = 'death-overlay';
            overlay.innerHTML = '<span class="death-text ' + styles[pick] + '">' + words[pick] + '</span>';
            picksRow.appendChild(overlay);

            setTimeout(() => {
              if (overlay.parentNode) overlay.remove();
              picksContent.classList.remove('picks-hidden');
              picksContent.classList.add('picks-reveal');
              setTimeout(() => picksContent.classList.remove('picks-reveal'), 400);
            }, 1500);
          }
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
    renderRisk();
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

  function renderRisk() {
    const remaining = DATA.predictions.remaining_teams_by_player;
    if (!remaining) return;

    const entries = Object.entries(remaining)
      .map(([name, teams]) => ({ name, count: teams.length }))
      .sort((a, b) => a.count - b.count)
      .slice(0, 10);

    const maxCount = Math.max(...entries.map(e => e.count), 1);
    const container = document.getElementById('riskList');

    container.innerHTML = entries.map(e => {
      const pct = (e.count / maxCount) * 100;
      const danger = e.count <= 5 ? 'risk-high' : e.count <= 15 ? 'risk-med' : 'risk-low';
      return `
        <div class="risk-item">
          <span class="risk-name">${esc(e.name)}</span>
          <div class="overlap-bar-bg">
            <div class="risk-bar-fill ${danger}" style="width:${pct}%"></div>
          </div>
          <span class="risk-count">${e.count} teams left</span>
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

    // Remove previous animation classes & overlays
    card.classList.remove('player-card-death', 'player-card-alive');
    const oldOverlay = card.querySelector('.player-card-death-overlay');
    if (oldOverlay) oldOverlay.remove();

    if (player.status === 'eliminated') {
      // Death animation
      card.classList.add('player-card-death');
      const overlay = document.createElement('div');
      overlay.className = 'player-card-death-overlay';
      overlay.innerHTML = '<span>ELIMINATED</span>';
      card.appendChild(overlay);
      setTimeout(() => {
        if (overlay.parentNode) overlay.remove();
      }, 1300);
    } else {
      // Alive pulse
      card.classList.add('player-card-alive');
    }

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
