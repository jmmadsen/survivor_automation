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
  let pickFlowHighlighted = null;
  let pickFlowRendered = false;

  // ── Boot ──────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    try {
      const resp = await fetch('data/pool.json?v=' + Date.now());
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

    // Lazy render pick flow on first stats visit
    if (tab === 'stats' && !pickFlowRendered) {
      setTimeout(renderPickFlow, 100);
    }
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

    // Pending day — show pick-based preview instead of results recap
    if (latestDay.status === 'pending') {
      let out = `<p>Today's games haven't finished yet, but the picks are in. ` +
        `<strong>${s.survivors}</strong> players are still alive heading into <strong>${latestDay.label}</strong>.</p>`;
      if (s.most_picked_today && s.most_picked_today.team !== '\u2014') {
        out += `<p><strong>${s.most_picked_today.team}</strong> is the most popular pick today with ` +
          `<strong>${s.most_picked_today.count}</strong> player${s.most_picked_today.count > 1 ? 's' : ''} riding on them. `;
        if (s.biggest_degen_pick && s.biggest_degen_pick.player !== '\u2014') {
          out += `Meanwhile, <strong>${s.biggest_degen_pick.player}</strong> is going full degen with ` +
            `${s.biggest_degen_pick.seed}-seed <strong>${s.biggest_degen_pick.team}</strong>. Bold move.`;
        }
        out += `</p>`;
      }
      out += `<p style="color:#fbbf24;font-style:italic;">Results will update once games are final.</p>`;
      recapBody.innerHTML = out;
      return;
    }

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
    // For superlatives, use the latest day with final results (skip pending)
    const finalDays = DATA.daily_results.filter(d => d.status !== 'pending');
    const latestDay = finalDays.length > 0 ? finalDays[finalDays.length - 1] : DATA.daily_results[DATA.daily_results.length - 1];
    if (!latestDay) return;
    const s = latestDay.stats;
    const isPending = latestDay.status === 'pending';

    const cards = [
      {
        emoji: '&#129297;',
        title: isPending ? 'BOLDEST PICK' : 'DEGEN OF THE DAY',
        value: s.biggest_degen_pick.player,
        sub: s.biggest_degen_pick.seed > 0
          ? '#' + s.biggest_degen_pick.seed + ' ' + s.biggest_degen_pick.team
          : '\u2014'
      },
      {
        emoji: '&#128128;',
        title: 'DEADLIEST TEAM',
        value: s.deadliest_team.team,
        sub: s.deadliest_team.kills > 0
          ? s.deadliest_team.kills + ' kill' + (s.deadliest_team.kills > 1 ? 's' : '')
          : isPending ? 'Pending' : '\u2014'
      },
      {
        emoji: '&#128076;',
        title: 'CHALK KING',
        value: s.chalk_king.player,
        sub: s.chalk_king.seed > 0
          ? '#' + s.chalk_king.seed + ' ' + s.chalk_king.team
          : isPending ? 'Pending' : '\u2014'
      },
      {
        emoji: '&#128293;',
        title: 'MOST POPULAR',
        value: s.most_picked_today.team,
        sub: s.most_picked_today.count + ' picks' +
          (isPending ? ' — pending' : ' — ' + s.most_picked_today.result)
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

            const words = ['WASTED', 'FATALITY', 'ELIMINATED', 'YOU DIED', 'GAME OVER', '//RUN_COMPLETE', 'FLATLINED', 'TIME OVER', 'YOUR LIGHT FADES AWAY', 'You have died of dysentery', 'Snake? SNAKE??? SNAAAAAAAKKKEEEEE!!!!!'];
            const styles = ['death-wasted', 'death-fatality', 'death-eliminated', 'death-youdied', 'death-gameover', 'death-marathon', 'death-flatlined', 'death-timeover', 'death-destiny', 'death-oregon', 'death-mgs'];
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
      opt.textContent = d.label + (d.status === 'pending' ? ' (Pending)' : '');
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

  function pfColor(result) {
    if (result === 'win') return '#22c55e';
    if (result === 'loss') return '#ef4444';
    return '#eab308';
  }

  function renderPickFlow() {
    const container = document.getElementById('pickFlowContainer');
    if (!container) return;

    if (typeof d3 === 'undefined' || typeof d3.sankey !== 'function') {
      container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:40px 0;">Visualization loading\u2026</p>';
      return;
    }

    // Need at least 2 days with picks to show flows
    const playedDays = DATA.daily_results.filter(dr =>
      DATA.players.some(p => p.picks.some(pk => pk.day === dr.day))
    );
    if (playedDays.length < 2) {
      container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:40px 0;">Pick Flow appears after Day 2.</p>';
      return;
    }

    // Build nodes & links from player pick data
    const nodeMap = {};
    const linkMap = {};

    DATA.players.forEach(p => {
      const sorted = p.picks.slice().sort((a, b) => a.day - b.day);
      sorted.forEach(pk => {
        const nid = 'd' + pk.day + '-' + pk.team;
        if (!nodeMap[nid]) {
          nodeMap[nid] = { id: nid, day: pk.day, team: pk.team, seed: pk.seed, result: pk.result, pNames: [] };
        }
        nodeMap[nid].pNames.push(p.name);
      });
      for (let i = 0; i < sorted.length - 1; i++) {
        const src = 'd' + sorted[i].day + '-' + sorted[i].team;
        const tgt = 'd' + sorted[i + 1].day + '-' + sorted[i + 1].team;
        const lid = src + '>' + tgt;
        if (!linkMap[lid]) linkMap[lid] = { source: src, target: tgt, value: 0, pNames: [] };
        linkMap[lid].value++;
        linkMap[lid].pNames.push(p.name);
      }
    });

    const nodes = Object.values(nodeMap);
    const links = Object.values(linkMap);
    if (nodes.length === 0 || links.length === 0) return;

    // Dimensions — bail if container not visible yet
    const width = container.clientWidth;
    if (width === 0) return;
    const maxPerDay = Math.max(...playedDays.map(d =>
      nodes.filter(n => n.day === d.day).length
    ));
    const height = Math.max(360, Math.min(620, maxPerDay * 34 + 60));

    container.innerHTML = '';

    const svg = d3.select(container).append('svg')
      .attr('width', width)
      .attr('height', height)
      .style('overflow', 'visible');

    // Defs — glow filters
    const defs = svg.append('defs');
    const glow = defs.append('filter').attr('id', 'pf-glow')
      .attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    glow.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', '3').attr('result', 'blur');
    const gm = glow.append('feMerge');
    gm.append('feMergeNode').attr('in', 'blur');
    gm.append('feMergeNode').attr('in', 'SourceGraphic');

    const goldGlow = defs.append('filter').attr('id', 'pf-gold-glow')
      .attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
    goldGlow.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', '5').attr('result', 'blur');
    const ggm = goldGlow.append('feMerge');
    ggm.append('feMergeNode').attr('in', 'blur');
    ggm.append('feMergeNode').attr('in', 'SourceGraphic');

    // Sankey layout
    const margin = { top: 36, right: 90, bottom: 8, left: 8 };
    const sankey = d3.sankey()
      .nodeId(d => d.id)
      .nodeAlign(d3.sankeyLeft)
      .nodeWidth(14)
      .nodePadding(5)
      .nodeSort((a, b) => b.pNames.length - a.pNames.length)
      .extent([[margin.left, margin.top], [width - margin.right, height - margin.bottom]]);

    const graph = sankey({
      nodes: nodes.map(d => Object.assign({}, d)),
      links: links.map(d => Object.assign({}, d))
    });

    // Day column labels & subtle guide lines
    const dayPos = {};
    graph.nodes.forEach(n => {
      if (!dayPos[n.day]) dayPos[n.day] = (n.x0 + n.x1) / 2;
    });
    Object.keys(dayPos).forEach(day => {
      const x = dayPos[day];
      svg.append('text')
        .attr('x', x).attr('y', 20)
        .attr('text-anchor', 'middle')
        .attr('fill', '#64748b')
        .attr('font-size', '11px')
        .attr('font-family', "'Bebas Neue', Impact, sans-serif")
        .attr('letter-spacing', '1.5px')
        .text('DAY ' + day);
      svg.append('line')
        .attr('x1', x).attr('x2', x)
        .attr('y1', margin.top - 4).attr('y2', height - margin.bottom)
        .attr('stroke', 'rgba(148,163,184,0.05)')
        .attr('stroke-width', 1);
    });

    // Draw links
    svg.append('g').attr('class', 'pf-link-group')
      .selectAll('path')
      .data(graph.links)
      .join('path')
      .attr('class', 'pf-link')
      .attr('d', d3.sankeyLinkHorizontal())
      .attr('stroke', d => pfColor(d.source.result))
      .attr('stroke-opacity', d => d.source.result === 'loss' ? 0.1 : 0.22)
      .attr('stroke-width', d => Math.max(1.5, d.width))
      .attr('fill', 'none')
      .style('mix-blend-mode', 'screen')
      .on('mouseenter', function (event, d) {
        if (pickFlowHighlighted) return;
        d3.select(this).attr('stroke-opacity', 0.55);
        showPfTooltip(event,
          '<strong>' + d.value + ' player' + (d.value !== 1 ? 's' : '') + '</strong><br>' +
          esc(d.source.team) + ' \u2192 ' + esc(d.target.team));
      })
      .on('mousemove', function (event) { movePfTooltip(event); })
      .on('mouseleave', function (event, d) {
        if (pickFlowHighlighted) return;
        d3.select(this).attr('stroke-opacity', d.source.result === 'loss' ? 0.1 : 0.22);
        hidePfTooltip();
      });

    // Draw nodes
    svg.append('g').attr('class', 'pf-node-group')
      .selectAll('rect')
      .data(graph.nodes)
      .join('rect')
      .attr('class', 'pf-node')
      .attr('x', d => d.x0)
      .attr('y', d => d.y0)
      .attr('width', d => d.x1 - d.x0)
      .attr('height', d => Math.max(2, d.y1 - d.y0))
      .attr('fill', d => pfColor(d.result))
      .attr('opacity', d => d.result === 'loss' ? 0.45 : 0.85)
      .attr('rx', 3)
      .on('mouseenter', function (event, d) {
        if (pickFlowHighlighted) return;
        d3.select(this).attr('opacity', 1).attr('filter', 'url(#pf-glow)');
        d3.selectAll('.pf-link').attr('stroke-opacity', l =>
          (l.source.id === d.id || l.target.id === d.id) ? 0.55
            : (l.source.result === 'loss' ? 0.04 : 0.06));
        const list = d.pNames.slice(0, 10).map(esc).join(', ') +
          (d.pNames.length > 10 ? ' +' + (d.pNames.length - 10) + ' more' : '');
        showPfTooltip(event,
          '<strong>' + esc(d.team) + '</strong> <span style="color:#64748b">#' + d.seed + '</span><br>' +
          d.pNames.length + ' pick' + (d.pNames.length !== 1 ? 's' : '') + ' \u00b7 ' + d.result.toUpperCase() + '<br>' +
          '<span style="color:#94a3b8;font-size:11px">' + list + '</span>');
      })
      .on('mousemove', function (event) { movePfTooltip(event); })
      .on('mouseleave', function (event, d) {
        if (pickFlowHighlighted) return;
        d3.select(this).attr('opacity', d.result === 'loss' ? 0.45 : 0.85).attr('filter', null);
        d3.selectAll('.pf-link').attr('stroke-opacity', l =>
          l.source.result === 'loss' ? 0.1 : 0.22);
        hidePfTooltip();
      });

    // Node labels — only for nodes tall enough
    svg.append('g').attr('class', 'pf-label-group')
      .selectAll('text')
      .data(graph.nodes.filter(d => (d.y1 - d.y0) >= 14))
      .join('text')
      .attr('class', 'pf-label')
      .attr('x', d => d.x1 + 6)
      .attr('y', d => (d.y0 + d.y1) / 2)
      .attr('dy', '0.35em')
      .attr('fill', '#94a3b8')
      .attr('font-size', '10px')
      .attr('font-family', "'Barlow Semi Condensed', sans-serif")
      .text(d => {
        const name = d.team.length > 12 ? d.team.substring(0, 11) + '\u2026' : d.team;
        return name + ' (' + d.pNames.length + ')';
      });

    // Tooltip element
    if (!document.getElementById('pfTooltip')) {
      const tt = document.createElement('div');
      tt.id = 'pfTooltip';
      tt.className = 'pf-tooltip';
      document.body.appendChild(tt);
    }

    pickFlowRendered = true;
    setupPickFlowSearch();
  }

  function showPfTooltip(event, html) {
    const tt = document.getElementById('pfTooltip');
    if (!tt) return;
    tt.innerHTML = html;
    tt.classList.add('visible');
    movePfTooltip(event);
  }

  function movePfTooltip(event) {
    const tt = document.getElementById('pfTooltip');
    if (!tt) return;
    tt.style.left = (event.clientX + 14) + 'px';
    tt.style.top = (event.clientY - 14) + 'px';
  }

  function hidePfTooltip() {
    const tt = document.getElementById('pfTooltip');
    if (tt) tt.classList.remove('visible');
  }

  function setupPickFlowSearch() {
    const input = document.getElementById('pickFlowSearch');
    const dropdown = document.getElementById('pickFlowDropdown');
    const clearBtn = document.getElementById('pickFlowClear');
    if (!input || !dropdown || !clearBtn) return;
    if (input._pfBound) return;
    input._pfBound = true;

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      if (q.length < 1) {
        dropdown.classList.remove('visible');
        clearBtn.style.display = 'none';
        clearPickFlowHighlight();
        return;
      }
      const matches = DATA.players.filter(p => p.name.toLowerCase().includes(q)).slice(0, 6);
      if (matches.length === 0) { dropdown.classList.remove('visible'); return; }
      dropdown.innerHTML = matches.map(p =>
        '<div class="search-result-item" data-player="' + esc(p.name) + '">' +
        '<span class="search-result-name">' + esc(p.name) + '</span>' +
        '<span class="search-result-meta">' + (p.status === 'alive' ? '&#128994;' : '&#128308;') +
        ' #' + p.rank + '</span></div>'
      ).join('');
      dropdown.classList.add('visible');
      dropdown.querySelectorAll('.search-result-item').forEach(item => {
        item.addEventListener('click', () => {
          input.value = item.dataset.player;
          dropdown.classList.remove('visible');
          clearBtn.style.display = 'flex';
          highlightPickFlowPlayer(item.dataset.player);
        });
      });
    });

    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.style.display = 'none';
      clearPickFlowHighlight();
      input.focus();
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('.pick-flow-search-wrapper')) {
        dropdown.classList.remove('visible');
      }
    });
  }

  function highlightPickFlowPlayer(name) {
    const player = DATA.players.find(p => p.name === name);
    if (!player) return;
    pickFlowHighlighted = name;
    hidePfTooltip();

    const nodeIds = new Set(player.picks.map(pk => 'd' + pk.day + '-' + pk.team));
    const linkKeys = new Set();
    const sorted = player.picks.slice().sort((a, b) => a.day - b.day);
    for (let i = 0; i < sorted.length - 1; i++) {
      linkKeys.add('d' + sorted[i].day + '-' + sorted[i].team + '>' + 'd' + sorted[i + 1].day + '-' + sorted[i + 1].team);
    }

    // Fade & recolor links
    d3.selectAll('.pf-link')
      .attr('stroke', d => linkKeys.has(d.source.id + '>' + d.target.id) ? '#fbbf24' : pfColor(d.source.result))
      .attr('stroke-opacity', d => linkKeys.has(d.source.id + '>' + d.target.id) ? 0.85 : 0.03);

    // Animated gold trace line on player's path
    d3.selectAll('.pf-trace-line').remove();
    d3.selectAll('.pf-link')
      .filter(d => linkKeys.has(d.source.id + '>' + d.target.id))
      .each(function () {
        d3.select(this.parentNode).append('path')
          .attr('class', 'pf-trace-line')
          .attr('d', d3.select(this).attr('d'))
          .attr('stroke', '#fbbf24')
          .attr('stroke-width', 2.5)
          .attr('stroke-opacity', 0.9)
          .attr('fill', 'none')
          .attr('filter', 'url(#pf-gold-glow)')
          .attr('pointer-events', 'none');
      });

    // Fade & highlight nodes
    d3.selectAll('.pf-node')
      .attr('opacity', d => nodeIds.has(d.id) ? 1 : 0.06)
      .attr('filter', d => nodeIds.has(d.id) ? 'url(#pf-gold-glow)' : null)
      .attr('stroke', d => nodeIds.has(d.id) ? '#fbbf24' : 'none')
      .attr('stroke-width', d => nodeIds.has(d.id) ? 1.5 : 0);

    // Fade & highlight labels
    d3.selectAll('.pf-label')
      .attr('opacity', d => nodeIds.has(d.id) ? 1 : 0.06)
      .attr('fill', d => nodeIds.has(d.id) ? '#fbbf24' : '#94a3b8');
  }

  function clearPickFlowHighlight() {
    pickFlowHighlighted = null;
    d3.selectAll('.pf-trace-line').remove();
    d3.selectAll('.pf-link')
      .attr('stroke', d => pfColor(d.source.result))
      .attr('stroke-opacity', d => d.source.result === 'loss' ? 0.1 : 0.22);
    d3.selectAll('.pf-node')
      .attr('opacity', d => d.result === 'loss' ? 0.45 : 0.85)
      .attr('filter', null)
      .attr('stroke', 'none')
      .attr('stroke-width', 0);
    d3.selectAll('.pf-label')
      .attr('opacity', 1)
      .attr('fill', '#94a3b8');
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
      // Death animation — random style matching board tab
      card.classList.add('player-card-death');
      const words = ['WASTED', 'FATALITY', 'ELIMINATED', 'YOU DIED', 'GAME OVER', '//RUN_COMPLETE', 'FLATLINED', 'TIME OVER', 'YOUR LIGHT FADES AWAY', 'You have died of dysentery', 'Snake? SNAKE??? SNAAAAAAAKKKEEEEE!!!!!'];
      const styles = ['death-wasted', 'death-fatality', 'death-eliminated', 'death-youdied', 'death-gameover', 'death-marathon', 'death-flatlined', 'death-timeover', 'death-destiny', 'death-oregon', 'death-mgs'];
      const pick = Math.floor(Math.random() * words.length);
      const overlay = document.createElement('div');
      overlay.className = 'player-card-death-overlay';
      overlay.innerHTML = '<span class="death-text ' + styles[pick] + '">' + words[pick] + '</span>';
      card.appendChild(overlay);
      setTimeout(() => {
        if (overlay.parentNode) overlay.remove();
      }, 2500);
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
