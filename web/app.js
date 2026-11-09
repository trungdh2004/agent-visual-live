'use strict';

// Nothing here is declared by the user: the server derives the fleets and the
// arrows from the session registry and the transcripts, and this file only
// lays the result out. Cards are reused across frames so a click target does
// not vanish under the pointer every two seconds.

const STATUS_META = {
  busy:    { label: 'Đang chạy', glyph: '●' },
  waiting: { label: 'Đang chờ',  glyph: '▲' },
  shell:   { label: 'Shell',     glyph: '◆' },
  idle:    { label: 'Nghỉ',      glyph: '○' },
  exited:  { label: 'Đã đóng',   glyph: '◌' },
};

const TOOL_STATE = {
  connected: '● Đã kết nối',
  auth:      '◆ Cần đăng nhập',
  failed:    '▲ Lỗi kết nối',
  unknown:   '○ Chưa kiểm tra',
  used:      '● Đã gọi',
};

const BLOCKED_TEXT = {
  'permission prompt': 'Chờ duyệt quyền (Permission)',
  'sandbox request':   'Chờ duyệt Sandbox',
  'worker request':    'Chờ duyệt Worker',
  'goal proposal':     'Chờ duyệt Mục tiêu',
  'input needed':      'Chờ nhập liệu',
  'dialog open':       'Đang mở hộp thoại',
};

const DEFAULT_TITLE = 'Claude Session Monitor — Tactical Telemetry';
const FAVICON_NORMAL = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3.5' fill='%2313171F' stroke='%23283142'/%3E%3Ccircle cx='5' cy='5' r='2' fill='%2334D399'/%3E%3Ccircle cx='11' cy='5' r='2' fill='%2338BDF8'/%3E%3Ccircle cx='8' cy='11' r='2' fill='%23F87171'/%3E%3Cpath d='M5 7 C5 9, 8 9, 8 9 M11 7 C11 9, 8 9, 8 9' stroke='%23475569' stroke-width='1' fill='none'/%3E%3C/svg%3E";
const FAVICON_ALERT  = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect width='16' height='16' rx='3.5' fill='%232D0F14' stroke='%23EF4444' stroke-width='1.5'/%3E%3Ccircle cx='8' cy='8' r='4.2' fill='%23F87171'/%3E%3C/svg%3E";

const PROVIDER_META = {
  claude:      { label: 'CLAUDE',      short: 'Claude' },
  antigravity: { label: 'ANTIGRAVITY', short: 'Antigravity' },
  opencode:    { label: 'OPENCODE',    short: 'OpenCode' },
};

let latest = null;
let selection = null;       // {kind: 'session'|'edge'|'tool', id, peer, groupKey, slug}
let activeTab = 'overview'; // 'overview' | 'terminal' | 'messages' | 'bash'
let statusFilter = null;    // null | 'busy' | 'waiting' | 'shell' | 'idle' | 'exited'
let providerFilter = null;  // null | 'claude' | 'antigravity' | 'opencode'
let searchQuery = '';
let viewMode = localStorage.getItem('csm_view_mode') || '3d'; // '2d' | '3d'
let hoverTarget = null;     // {kind: 'session'|'tool', id, groupKey, slug}
let lastRenderedSelectionKey = '';
let alertsEnabled = localStorage.getItem('csm_alerts_enabled') === '1';
let prevWaitingIds = new Set();

const cardNodes = new Map();
const fleetNodes = new Map();
const collapsed = new Set();
const showTools = new Set();
const toolNodes = new Map();
let office3dScene = null;

function ensureOffice3D() {
  if (!office3dScene && window.Office3DScene) {
    const host = document.getElementById('office3d');
    if (host) {
      office3dScene = new window.Office3DScene(host);
      office3dScene.onSelectSession = (id) => {
        selection = { kind: 'session', id };
        renderPanel(true);
        paintSelection();
      };
      office3dScene.onSelectEdge = (from, to) => {
        selection = { kind: 'edge', id: from, peer: to };
        renderPanel(true);
        paintSelection();
      };
      office3dScene.onJumpSession = (id, btn) => {
        jumpTo(id, btn);
      };
    }
  }
  return office3dScene;
}

function redrawAllWires() {
  if (!latest) return;
  const byId = new Map(latest.sessions.map((s) => [s.id, s]));
  for (const group of latest.groups) {
    drawWires(fleetNodes.get(group.key), group, latest.edges, byId);
  }
}

function short(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(n || 0);
}

function ago(ms) {
  if (!ms) return '—';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return s + ' giây trước';
  if (s < 3600) return Math.round(s / 60) + ' phút trước';
  return Math.round(s / 3600) + ' giờ trước';
}

function until(iso) {
  const at = Date.parse(iso);
  if (!at) return '';
  const s = Math.max(0, Math.round((at - Date.now()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `reset ${h}g ${m}p` : `reset ${m}p`;
}

function shortModel(model) {
  if (!model) return 'Chưa gọi model';
  return model
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '');
}

function shortPath(path, cwd) {
  if (!path) return '';
  if (cwd && path.startsWith(cwd + '/')) return path.slice(cwd.length + 1);
  return path.replace(/^\/home\/[^/]+/, '~');
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function matchesSearch(s, q) {
  if (!q) return true;
  const hay = [
    s.name,
    s.cwd,
    s.model,
    s.preview,
    s.status,
    s.provider,
    s.providerLabel,
    s.git?.branch,
    STATUS_META[s.status]?.label,
    ...(s.mcp || []).map((t) => t.name),
    ...(s.skills || []).map((t) => t.name),
    ...(s.filesEdited || []).map((f) => f.path),
  ].filter(Boolean).join(' ').toLowerCase();
  return hay.includes(q);
}

function isCardVisible(s) {
  if (statusFilter && s.status !== statusFilter) return false;
  if (providerFilter && (s.provider || 'claude') !== providerFilter) return false;
  if (searchQuery && !matchesSearch(s, searchQuery)) return false;
  return true;
}

// ---- Proactive Waiting Alerts (CSM-001) --------------------------------

function playAlertChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const notes = [587.33, 880]; // D5 -> A5
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.11);
      gain.gain.setValueAtTime(0.08, now + idx * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.11 + 0.16);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.11);
      osc.stop(now + idx * 0.11 + 0.17);
    });
    setTimeout(() => ctx.close().catch(() => {}), 500);
  } catch (err) {
    /* ignore audio restrictions when page has not been interacted with */
  }
}

function handleWaitingAlerts(sessions) {
  const currentWaiting = new Set();
  const newlyWaiting = [];
  for (const s of sessions) {
    if (s.status === 'waiting') {
      currentWaiting.add(s.id);
      if (!prevWaitingIds.has(s.id)) {
        newlyWaiting.push(s);
      }
    }
  }
  prevWaitingIds = currentWaiting;

  // Dynamic Tab Title & Favicon
  const count = currentWaiting.size;
  document.title = count > 0 ? `(${count} chờ) Session Monitor` : DEFAULT_TITLE;
  const link = document.querySelector("link[rel='icon']");
  if (link) {
    const targetHref = count > 0 ? FAVICON_ALERT : FAVICON_NORMAL;
    if (link.getAttribute('href') !== targetHref) {
      link.setAttribute('href', targetHref);
    }
  }

  if (!alertsEnabled || !newlyWaiting.length) return;

  playAlertChime();

  if ('Notification' in window && Notification.permission === 'granted') {
    for (const s of newlyWaiting) {
      const reason = BLOCKED_TEXT[s.blockedOn] || s.blockedOn || 'Đang chờ xác nhận';
      try {
        const n = new Notification(`Phiên ${s.name} đang chờ duyệt`, {
          body: `${reason} — ${shortPath(s.cwd)}`,
          tag: `csm-wait-${s.id}`,
        });
        n.onclick = () => {
          window.focus();
          selection = { kind: 'session', id: s.id };
          renderPanel(true);
          paintSelection();
          n.close();
        };
      } catch (err) {
        /* ignore notification errors */
      }
    }
  }
}

function syncAlertButtonUI() {
  const btn = document.getElementById('alert-toggle');
  const icon = document.getElementById('alert-icon');
  if (!btn || !icon) return;
  btn.classList.toggle('alert-on', alertsEnabled);
  icon.textContent = alertsEnabled ? '🔔' : '🔕';
  btn.setAttribute('aria-pressed', String(alertsEnabled));
}

function syncViewModeUI() {
  const ws = document.getElementById('workspace');
  const fleetsEl = document.getElementById('fleets');
  const btn2d = document.getElementById('view-2d');
  const btn3d = document.getElementById('view-3d');
  const is3d = viewMode === '3d';
  if (ws) ws.classList.toggle('view-3d', is3d);
  if (fleetsEl) fleetsEl.classList.toggle('hidden', is3d);
  const scene = ensureOffice3D();
  if (scene) scene.setActive(is3d);
  if (btn2d) {
    btn2d.classList.toggle('active-mode', !is3d);
    btn2d.setAttribute('aria-pressed', String(!is3d));
  }
  if (btn3d) {
    btn3d.classList.toggle('active-mode', is3d);
    btn3d.setAttribute('aria-pressed', String(is3d));
  }
  requestAnimationFrame(() => {
    redrawAllWires();
    paintSelection();
  });
}

// ---- cards -------------------------------------------------------------

function buildCard(id) {
  const card = el('div', 'card');
  card.dataset.id = id;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');

  // Zone 1: Top Header
  const top = el('div', 'card-top');
  top.append(el('span', 'provider-slot'), el('span', 'card-name'), el('span', 'role-slot'), el('span', 'status-pill'));

  // Zone 2: Consolidated Meta (cwd + git branch + model)
  const meta = el('div', 'card-meta');
  meta.append(el('span', 'cwd'), el('span', 'branch-slot'), el('span', 'model-tag'));

  // Zone 3: Preview Well
  const preview = el('div', 'preview');

  // Zone 4: Footer (Context Gauge + Todo Progress + Tool Count Pill)
  const foot = el('div', 'card-foot');
  const ctx = el('div', 'ctx');
  const bar = el('span', 'ctx-bar');
  bar.innerHTML = '<i></i>';
  ctx.append(el('span', 'ctx-text'), bar, el('span', 'ctx-pct'));
  foot.append(ctx, el('span', 'todo-slot'), el('span', 'tool-slot'));

  // Zone 5: 3D Workstation Desk & Agent Stage (Visible in 3D Department mode)
  const deskStage = el('div', 'desk-stage');
  deskStage.setAttribute('aria-hidden', 'true');
  deskStage.innerHTML = `
    <div class="desk-floor-pad"></div>
    <div class="desk-siren"><span class="siren-beacon">🚨</span></div>
    <div class="desk-idle-fx"><span class="zzz-float">☕ zZz</span></div>
    <div class="desk-unit">
      <div class="desk-surface">
        <div class="desk-monitors">
          <div class="monitor-screen main-screen">
            <span class="code-line l1"></span>
            <span class="code-line l2"></span>
            <span class="code-line l3"></span>
          </div>
          <div class="monitor-screen side-screen">
            <span class="code-line l1"></span>
            <span class="code-line l2"></span>
          </div>
        </div>
        <div class="desk-keyboard"></div>
      </div>
      <div class="agent-avatar">
        <div class="agent-head">
          <span class="agent-visor"></span>
        </div>
        <div class="agent-torso"></div>
        <div class="agent-arms">
          <span class="arm left"></span>
          <span class="arm right"></span>
        </div>
      </div>
      <div class="desk-chair"></div>
    </div>
  `;

  card.append(top, meta, preview, foot, el('div', 'conflict-slot'), el('div', 'banner-slot'), deskStage);

  const selectThisCard = (event) => {
    if (event.target.closest('.jump-btn')) return;
    selection = { kind: 'session', id };
    renderPanel(true);
    paintSelection();
  };

  card.addEventListener('click', selectThisCard);
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      if (event.target.closest('.jump-btn')) return;
      event.preventDefault();
      selectThisCard(event);
    }
  });

  card.addEventListener('mouseenter', () => {
    hoverTarget = { kind: 'session', id };
    paintSelection();
  });
  card.addEventListener('mouseleave', () => {
    if (hoverTarget && hoverTarget.kind === 'session' && hoverTarget.id === id) {
      hoverTarget = null;
      paintSelection();
    }
  });

  return card;
}

function fillCard(card, s) {
  const prov = s.provider || 'claude';
  const provLabel = s.providerLabel || PROVIDER_META[prov]?.label || 'CLAUDE';
  const provSlot = card.querySelector('.provider-slot');
  provSlot.replaceChildren(el('span', `provider-badge ${prov}`, provLabel));

  card.dataset.provider = prov;
  card.dataset.status = s.status || 'idle';
  card.classList.toggle('is-coordinator', Boolean(s.coordinates));
  card.classList.toggle('is-worker', Boolean(s.receives && !s.coordinates));

  card.querySelector('.card-name').textContent = s.name;
  card.setAttribute('aria-label', `Phiên ${s.name} (${provLabel}), trạng thái ${STATUS_META[s.status]?.label || s.status}`);

  // Role badge
  const roleSlot = card.querySelector('.role-slot');
  roleSlot.replaceChildren();
  if (s.coordinates) {
    roleSlot.append(el('span', 'role-badge', 'Điều phối'));
  } else if (s.receives) {
    roleSlot.append(el('span', 'role-badge sub', 'Nhận việc'));
  } else if (s.kind === 'background') {
    roleSlot.append(el('span', 'role-badge sub', 'Nền'));
  }

  const meta = STATUS_META[s.status] || { label: s.status || '?', glyph: '•' };
  const statusPill = card.querySelector('.status-pill');
  statusPill.className = 'status-pill ' + (s.status || 'idle');
  statusPill.textContent = `${meta.glyph} ${meta.label}`;

  const alert = s.status === 'waiting';
  card.classList.toggle('alert', alert);
  card.classList.toggle('exited', Boolean(s.exited || s.status === 'exited'));

  // Meta row: cwd + git branch + model
  const shortCwd = shortPath(s.cwd);
  const cwdEl = card.querySelector('.cwd');
  cwdEl.textContent = shortCwd;
  cwdEl.title = s.cwd;

  const branchSlot = card.querySelector('.branch-slot');
  branchSlot.replaceChildren();
  if (s.git && s.git.branch) {
    const bTag = el('span', 'branch-tag');
    bTag.append(document.createTextNode(`⎇ ${s.git.branch}`));
    if (s.git.dirty) {
      bTag.append(el('span', 'branch-dirty', '*'));
      bTag.title = `Nhánh ${s.git.branch} (${s.git.changedCount} file thay đổi chưa commit)`;
    } else {
      bTag.title = `Nhánh ${s.git.branch} (Sạch)`;
    }
    branchSlot.append(bTag);
  }

  const modelEl = card.querySelector('.model-tag');
  modelEl.textContent = shortModel(s.model);
  modelEl.title = s.model || 'Chưa gọi model';

  // Preview
  const previewEl = card.querySelector('.preview');
  if (s.preview && s.preview.trim()) {
    previewEl.textContent = s.preview.trim();
    previewEl.classList.remove('empty-preview');
  } else {
    previewEl.textContent = 'Chưa có phản hồi văn bản gần đây.';
    previewEl.classList.add('empty-preview');
  }

  // Context bar with semantic thresholds
  const pct = Math.min(100, Math.round(s.context.percent || 0));
  card.querySelector('.ctx-text').textContent = `${short(s.context.used)}/${short(s.context.window)}`;
  const ctxBar = card.querySelector('.ctx-bar');
  ctxBar.classList.toggle('warn', pct >= 70 && pct < 90);
  ctxBar.classList.toggle('crit', pct >= 90);
  ctxBar.querySelector('i').style.width = pct + '%';
  card.querySelector('.ctx-pct').textContent = pct + '%';

  // Todo Progress Badge (CSM-003)
  const todoSlot = card.querySelector('.todo-slot');
  todoSlot.replaceChildren();
  const todos = s.todos || [];
  if (todos.length > 0) {
    const done = todos.filter((t) => t.status === 'completed').length;
    const tBadge = el('span', 'todo-badge', `☑ ${done}/${todos.length}`);
    tBadge.title = `Tiến độ TodoWrite: hoàn thành ${done}/${todos.length} mục`;
    todoSlot.append(tBadge);
  }

  // Consolidated Tool Count Badge
  const toolSlot = card.querySelector('.tool-slot');
  toolSlot.replaceChildren();
  const totalTools = (s.mcp?.length || 0) + (s.skills?.length || 0);
  if (totalTools > 0) {
    const parts = [];
    if (s.mcp?.length) parts.push(`${s.mcp.length} MCP`);
    if (s.skills?.length) parts.push(`${s.skills.length} Skill`);
    const badge = el('span', 'tool-summary-badge', parts.join(' · '));
    const names = [
      ...(s.mcp || []).map((t) => `${t.name} (${t.calls})`),
      ...(s.skills || []).map((t) => `${t.name} (${t.calls})`),
    ].join(', ');
    badge.title = `Công cụ đã gọi: ${names}`;
    toolSlot.append(badge);
  }

  // File Collision Warning Banner (CSM-002)
  const conflictSlot = card.querySelector('.conflict-slot');
  conflictSlot.replaceChildren();
  const conflicts = s.conflicts || [];
  if (conflicts.length > 0) {
    const firstFile = shortPath(conflicts[0].path, s.cwd);
    const peers = Array.from(new Set(conflicts.flatMap((c) => c.peers))).join(', ');
    const label = conflicts.length === 1
      ? `⚠ Trùng file ${firstFile} với ${peers}`
      : `⚠ Trùng ${conflicts.length} file với ${peers}`;
    const cBanner = el('div', 'conflict-banner', label);
    cBanner.title = conflicts.map((c) => `${c.path} (cùng sửa bởi: ${c.peers.join(', ')})`).join('\n');
    conflictSlot.append(cBanner);
  }

  // Waiting Action Banner with Jump CTA
  const bannerSlot = card.querySelector('.banner-slot');
  let banner = bannerSlot.querySelector('.waiting-banner');
  if (alert) {
    if (!banner) {
      banner = el('div', 'waiting-banner');
      const reason = el('span', 'blocked-reason');
      const jump = el('button', 'jump-btn');
      jump.type = 'button';
      jump.addEventListener('click', (e) => {
        e.stopPropagation();
        jumpTo(s.id, jump);
      });
      banner.append(reason, jump);
      bannerSlot.append(banner);
    }
    const reasonText = BLOCKED_TEXT[s.blockedOn] || s.blockedOn || 'Đang chờ xác nhận';
    banner.querySelector('.blocked-reason').textContent = reasonText;
    banner.querySelector('.blocked-reason').title = reasonText;
    const jump = banner.querySelector('.jump-btn');
    if (!jump.dataset.busy) {
      jump.disabled = !s.tmux;
      jump.textContent = s.tmux ? 'Nhảy tới pane ↗' : 'Ngoài tmux';
    }
  } else if (banner) {
    banner.remove();
  }
}

async function jumpTo(id, button) {
  const was = button.textContent;
  button.disabled = true;
  button.dataset.busy = '1';
  button.textContent = 'Đang chuyển…';
  try {
    const res = await fetch(`/api/sessions/${id}/jump`, { method: 'POST' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      button.textContent = body.detail || 'Không nhảy được';
      return;
    }
    button.textContent = '✓ Đã chuyển';
  } catch (err) {
    button.textContent = 'Lỗi kết nối';
  }
  setTimeout(() => {
    delete button.dataset.busy;
    button.textContent = was;
    button.disabled = false;
  }, 2200);
}

// ---- fleets ------------------------------------------------------------

function render(state) {
  latest = state;
  handleWaitingAlerts(state.sessions || []);

  const byId = new Map(state.sessions.map((s) => [s.id, s]));
  const host = document.getElementById('fleets');

  if (!state.sessions.length) {
    const empty = el('div', 'empty-state');
    empty.append(
      el('h2', null, 'Chưa có phiên Claude Code nào đang chạy'),
      el('p', null, 'Bật một phiên làm việc trong terminal (ưu tiên chạy bên trong tmux để hỗ trợ nhảy nhanh tới pane khi cần duyệt quyền).'),
      el('code', null, 'claude'),
    );
    host.replaceChildren(empty);
    cardNodes.clear();
    fleetNodes.clear();
    renderTop(state);
    if (selection) {
      selection = null;
      renderPanel(true);
    }
    return;
  }

  const order = [];
  for (const group of state.groups) {
    let fleet = fleetNodes.get(group.key);
    if (!fleet) {
      fleet = buildFleet(group.key);
      fleetNodes.set(group.key, fleet);
    }
    fillFleet(fleet, group, byId, state.edges);
    order.push(fleet);
  }
  for (const [key, node] of fleetNodes) {
    if (!state.groups.some((g) => g.key === key)) {
      node.remove();
      fleetNodes.delete(key);
    }
  }
  host.replaceChildren(...order);

  for (const [id, node] of cardNodes) {
    if (!byId.has(id)) {
      node.remove();
      cardNodes.delete(id);
    }
  }

  requestAnimationFrame(() => {
    redrawAllWires();
    paintSelection();
  });

  renderTop(state);
  if (selection) renderPanel(false);
}

function buildFleet(key) {
  const fleet = el('section', 'fleet');
  fleet.dataset.key = key;
  const head = el('div', 'fleet-head');
  head.append(
    el('span', 'disclosure-icon', '▼'),
    el('span', 'label'),
    el('span', 'path'),
    el('span', 'waiting-slot'),
    el('span', 'count'),
  );
  head.addEventListener('click', (event) => {
    if (event.target.closest('.tool-toggle')) return;
    collapsed.has(key) ? collapsed.delete(key) : collapsed.add(key);
    render(latest);
  });
  const body = el('div', 'fleet-body');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'wires');
  body.append(svg);
  fleet.append(head, body);
  return fleet;
}

function fillFleet(fleet, group, byId, edges) {
  const head = fleet.querySelector('.fleet-head');
  head.querySelector('.label').textContent = group.label;
  head.querySelector('.path').textContent = shortPath(group.path);
  head.querySelector('.count').textContent = `${group.sessions.length} phiên`;

  fleet.classList.toggle('has-waiting', group.waiting > 0);

  const waitingSlot = head.querySelector('.waiting-slot');
  waitingSlot.replaceChildren();
  if (group.waiting) {
    waitingSlot.append(el('span', 'waiting-badge', `▲ ${group.waiting} đang chờ`));
  }

  let toggle = head.querySelector('.tool-toggle');
  if (!toggle) {
    toggle = el('button', 'tool-toggle');
    toggle.type = 'button';
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      showTools.has(group.key) ? showTools.delete(group.key) : showTools.add(group.key);
      render(latest);
    });
    head.append(toggle);
  }
  const on = showTools.has(group.key);
  toggle.classList.toggle('on', on);
  toggle.textContent = `${on ? '◉' : '○'} Sơ đồ công cụ (${(group.tools || []).length})`;

  fleet.classList.toggle('collapsed', collapsed.has(group.key));

  const body = fleet.querySelector('.fleet-body');
  const rows = [];
  for (let tier = 0; tier < group.tiers; tier++) {
    const row = el('div', 'tier');
    row.dataset.tier = String(tier);
    row.dataset.zoneLabel = tier === 0
      ? (group.tiers > 1 ? 'BÀN ĐIỀU PHỐI / TRƯỞNG PHÒNG' : 'KHU VỰC TRẠM LÀM VIỆC')
      : `KHU VỰC NHÂN VIÊN / SUBAGENTS (TẦNG ${tier})`;
    for (const id of group.sessions) {
      const s = byId.get(id);
      if (!s || s.tier !== tier) continue;
      let card = cardNodes.get(id);
      if (!card) {
        card = buildCard(id);
        cardNodes.set(id, card);
      }
      fillCard(card, s);
      row.append(card);
    }
    if (row.children.length) rows.push(row);
  }

  if (showTools.has(group.key) && (group.tools || []).length) {
    const row = el('div', 'tier tool-row');
    row.dataset.zoneLabel = 'PHÒNG MÁY CHỦ MCP & SKILL RACKS';
    for (const tool of group.tools) {
      const nodeKey = group.key + '|' + tool.slug;
      let node = toolNodes.get(nodeKey);
      if (!node) {
        node = el('div', 'tool');
        node.tabIndex = 0;
        node.setAttribute('role', 'button');
        node.addEventListener('mouseenter', () => {
          hoverTarget = { kind: 'tool', groupKey: group.key, slug: tool.slug };
          paintSelection();
        });
        node.addEventListener('mouseleave', () => {
          if (hoverTarget && hoverTarget.kind === 'tool' && hoverTarget.slug === tool.slug) {
            hoverTarget = null;
            paintSelection();
          }
        });
        node.addEventListener('click', () => {
          selection = { kind: 'tool', groupKey: group.key, slug: tool.slug };
          renderPanel(true);
          paintSelection();
        });
        node.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selection = { kind: 'tool', groupKey: group.key, slug: tool.slug };
            renderPanel(true);
            paintSelection();
          }
        });
        toolNodes.set(nodeKey, node);
      }
      node.className = 'tool ' + tool.kind + ' state-' + tool.state;
      const top = el('div', 'tool-top');
      top.append(
        el('span', 'tool-kind-badge', tool.kind === 'skill' ? 'Skill' : 'MCP'),
        el('span', 'tool-name', tool.name.replace(/^skill:/, '')),
      );
      const bottom = el('div', 'tool-bottom');
      bottom.append(
        el('span', 'tool-state', TOOL_STATE[tool.state] || tool.state),
        el('span', 'tool-calls', tool.calls ? `${tool.calls} lượt` : '0 lượt'),
      );
      node.replaceChildren(top, bottom);
      node.dataset.slug = tool.slug;
      node.dataset.groupKey = group.key;
      row.append(node);
    }
    rows.push(row);
  }
  body.replaceChildren(body.querySelector('.wires'), ...rows);
}

// ---- wires (Tactical Patchbay) -----------------------------------------

function toolWires(group) {
  const links = [];
  if (!showTools.has(group.key)) return links;
  for (const tool of group.tools || []) {
    for (const user of tool.users || []) {
      links.push({ from: user.id, toolSlug: tool.slug, calls: user.calls, kind: tool.kind });
    }
  }
  return links;
}

function drawWires(fleet, group, edges, byId) {
  if (!fleet) return;
  const svg = fleet.querySelector('.wires');
  const body = fleet.querySelector('.fleet-body');
  svg.replaceChildren();
  if (collapsed.has(group.key)) return;
  const frame = body.getBoundingClientRect();
  const w = Math.max(frame.width, body.scrollWidth);
  const h = Math.max(frame.height, body.scrollHeight);
  if (!w || !h) return;
  svg.style.width = w + 'px';
  svg.style.height = h + 'px';
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const scrollX = body.scrollLeft;
  const scrollY = body.scrollTop;

  // SVG Defs for directional arrowheads
  const defs = document.createElementNS(svg.namespaceURI, 'defs');
  const makeMarker = (id, color) => {
    const marker = document.createElementNS(svg.namespaceURI, 'marker');
    marker.setAttribute('id', id);
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '7');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '6');
    marker.setAttribute('markerHeight', '6');
    marker.setAttribute('orient', 'auto-start-reverse');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', 'M 1 1.5 L 8.5 5 L 1 8.5 z');
    path.setAttribute('fill', color);
    marker.append(path);
    return marker;
  };
  const safeKey = group.key.replace(/[^a-zA-Z0-9_-]/g, '_');
  defs.append(
    makeMarker(`arrow-idle-${safeKey}`, '#475569'),
    makeMarker(`arrow-active-${safeKey}`, '#38BDF8'),
  );
  svg.append(defs);

  const members = new Set(group.sessions);
  for (const edge of edges) {
    if (!members.has(edge.from) || !members.has(edge.to)) continue;
    const a = cardNodes.get(edge.from), b = cardNodes.get(edge.to);
    if (!a || !b) continue;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const x1 = ra.left - frame.left + scrollX + ra.width / 2, y1 = ra.bottom - frame.top + scrollY;
    const x2 = rb.left - frame.left + scrollX + rb.width / 2, y2 = rb.top - frame.top + scrollY;
    const midY = (y1 + y2) / 2;
    const midX = (x1 + x2) / 2;
    const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;

    const g = document.createElementNS(svg.namespaceURI, 'g');
    g.setAttribute('class', 'wire-group');
    g.dataset.from = edge.from;
    g.dataset.to = edge.to;

    const hit = document.createElementNS(svg.namespaceURI, 'path');
    hit.setAttribute('d', d);
    hit.setAttribute('class', 'hit');

    const wire = document.createElementNS(svg.namespaceURI, 'path');
    wire.setAttribute('d', d);

    const dstSession = byId.get(edge.to);
    // Only light up the wire to the specific worker/subagent that is currently active
    // (`busy` or `waiting` for approval), leaving idle/exited subagent wires normal.
    const isBusyFlow = Boolean(
      dstSession && !dstSession.exited && (dstSession.status === 'busy' || dstSession.status === 'waiting')
    );
    wire.setAttribute('class', 'wire-line' + (isBusyFlow ? ' busy-flow' : ''));
    wire.setAttribute('marker-end', `url(#arrow-${isBusyFlow ? 'active' : 'idle'}-${safeKey})`);
    if (edge.mutual) {
      wire.setAttribute('marker-start', `url(#arrow-${isBusyFlow ? 'active' : 'idle'}-${safeKey})`);
    }

    // Message count pill badge on the midpoint of the curve
    const badgeLabel = `${edge.count} tin`;
    const badgeW = Math.max(40, badgeLabel.length * 6.5 + 12);
    const badgeH = 18;
    const rect = document.createElementNS(svg.namespaceURI, 'rect');
    rect.setAttribute('class', 'wire-badge-bg');
    rect.setAttribute('x', String(midX - badgeW / 2));
    rect.setAttribute('y', String(midY - badgeH / 2));
    rect.setAttribute('width', String(badgeW));
    rect.setAttribute('height', String(badgeH));

    const txt = document.createElementNS(svg.namespaceURI, 'text');
    txt.setAttribute('class', 'wire-badge-text');
    txt.setAttribute('x', String(midX));
    txt.setAttribute('y', String(midY));
    txt.textContent = badgeLabel;

    const selectEdge = () => {
      selection = { kind: 'edge', id: edge.from, peer: edge.to };
      renderPanel(true);
      paintSelection();
    };
    hit.addEventListener('click', selectEdge);
    rect.addEventListener('click', selectEdge);

    g.append(hit, wire, rect, txt);
    svg.append(g);
  }

  for (const link of toolWires(group)) {
    const a = cardNodes.get(link.from);
    const b = toolNodes.get(group.key + '|' + link.toolSlug);
    if (!a || !b || !b.isConnected) continue;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const x1 = ra.left - frame.left + scrollX + ra.width / 2, y1 = ra.bottom - frame.top + scrollY;
    const x2 = rb.left - frame.left + scrollX + rb.width / 2, y2 = rb.top - frame.top + scrollY;
    const mid = (y1 + y2) / 2;
    const wire = document.createElementNS(svg.namespaceURI, 'path');
    wire.setAttribute('d', `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`);
    wire.setAttribute('class', 'tool-wire');
    wire.dataset.from = link.from;
    wire.dataset.toolSlug = link.toolSlug;
    wire.dataset.groupKey = group.key;
    wire.dataset.kind = link.kind;
    svg.append(wire);
  }
}

function paintSelection() {
  if (!latest) return;
  const byId = new Map(latest.sessions.map((s) => [s.id, s]));

  const highlightedCards = new Set();
  const highlightedTools = new Set(); // groupKey|slug

  const activeFocus = hoverTarget || selection;
  if (activeFocus) {
    if (activeFocus.kind === 'session') {
      highlightedCards.add(activeFocus.id);
      for (const e of latest.edges || []) {
        if (e.from === activeFocus.id) highlightedCards.add(e.to);
        if (e.to === activeFocus.id) highlightedCards.add(e.from);
      }
      for (const g of latest.groups || []) {
        if (!g.sessions.includes(activeFocus.id)) continue;
        for (const t of g.tools || []) {
          if ((t.users || []).some((u) => u.id === activeFocus.id)) {
            highlightedTools.add(g.key + '|' + t.slug);
          }
        }
      }
    } else if (activeFocus.kind === 'edge') {
      highlightedCards.add(activeFocus.id);
      highlightedCards.add(activeFocus.peer);
    } else if (activeFocus.kind === 'tool') {
      highlightedTools.add(activeFocus.groupKey + '|' + activeFocus.slug);
      const group = (latest.groups || []).find((g) => g.key === activeFocus.groupKey);
      const tool = (group?.tools || []).find((t) => t.slug === activeFocus.slug);
      for (const u of tool?.users || []) {
        highlightedCards.add(u.id);
      }
    }
  }

  const hasFilterOrSearch = Boolean(statusFilter || providerFilter || searchQuery);

  for (const [id, node] of cardNodes) {
    const s = byId.get(id);
    const isSelected = Boolean(selection && selection.kind === 'session' && selection.id === id);
    const isPeer = !isSelected && highlightedCards.has(id);
    const matches = s ? isCardVisible(s) : true;
    const dimmedByHover = Boolean(hoverTarget && !highlightedCards.has(id));
    node.classList.toggle('selected', isSelected);
    node.classList.toggle('peer-highlight', isPeer);
    node.classList.toggle('dimmed', !matches || dimmedByHover);
  }

  for (const [key, node] of toolNodes) {
    const isSelected = Boolean(
      selection && selection.kind === 'tool' && (selection.groupKey + '|' + selection.slug) === key
    );
    const isHighlighted = highlightedTools.has(key);
    const dimmedByHover = Boolean(hoverTarget && !isHighlighted);
    node.classList.toggle('selected', isSelected);
    node.classList.toggle('highlight', isHighlighted && !isSelected);
    node.classList.toggle('dimmed', dimmedByHover);
  }

  // Update SVG wires
  document.querySelectorAll('.wires g.wire-group').forEach((g) => {
    const from = g.dataset.from;
    const to = g.dataset.to;
    const isEdgeSelected = Boolean(
      selection && selection.kind === 'edge' && selection.id === from && selection.peer === to
    );
    const touchesFocus = Boolean(
      activeFocus &&
      ((activeFocus.kind === 'session' && (activeFocus.id === from || activeFocus.id === to)) ||
       isEdgeSelected)
    );
    const sFrom = byId.get(from), sTo = byId.get(to);
    const visible = (!sFrom || isCardVisible(sFrom)) && (!sTo || isCardVisible(sTo));
    const dimmed = (hasFilterOrSearch && !visible) || (Boolean(hoverTarget) && !touchesFocus);

    g.classList.toggle('active', isEdgeSelected);
    g.classList.toggle('highlight', touchesFocus);
    g.classList.toggle('dimmed', dimmed);
  });

  document.querySelectorAll('.wires path.tool-wire').forEach((w) => {
    const from = w.dataset.from;
    const slug = w.dataset.toolSlug;
    const gKey = w.dataset.groupKey;
    const kind = w.dataset.kind;
    const matchesSession = activeFocus && activeFocus.kind === 'session' && activeFocus.id === from;
    const matchesTool = activeFocus && activeFocus.kind === 'tool' &&
                        activeFocus.groupKey === gKey && activeFocus.slug === slug;
    const highlighted = Boolean(matchesSession || matchesTool);
    const dimmed = Boolean(hoverTarget && !highlighted);

    w.classList.toggle('highlight', highlighted && kind !== 'skill');
    w.classList.toggle('highlight-skill', highlighted && kind === 'skill');
    w.classList.toggle('dimmed', dimmed);
  });

  if (office3dScene && viewMode === '3d') {
    office3dScene.syncState(latest, selection);
  }
}

// ---- top bar -----------------------------------------------------------

function renderTop(state) {
  const tally = { busy: 0, waiting: 0, shell: 0, idle: 0, exited: 0 };
  for (const s of state.sessions) {
    if (tally[s.status] !== undefined) tally[s.status]++;
  }
  const counts = document.getElementById('counts');
  counts.replaceChildren();

  // "Tất cả" reset pill
  const allPill = el('button', 'filter-pill' + (statusFilter === null ? ' active' : ''));
  allPill.type = 'button';
  allPill.append(el('b', null, String(state.sessions.length)), document.createTextNode(' Tất cả'));
  allPill.addEventListener('click', () => {
    statusFilter = null;
    renderTop(latest);
    paintSelection();
  });
  counts.append(allPill);

  const filterKeys = ['busy', 'waiting', 'shell', 'idle'];
  if (tally.exited > 0 || statusFilter === 'exited') {
    filterKeys.push('exited');
  }

  for (const key of filterKeys) {
    const meta = STATUS_META[key];
    const isAct = statusFilter === key;
    const cls = [
      'filter-pill',
      isAct ? 'active' : '',
      key === 'waiting' && tally.waiting > 0 ? 'has-waiting' : '',
    ].filter(Boolean).join(' ');

    const item = el('button', cls);
    item.type = 'button';
    item.title = `Lọc trạng thái: ${meta.label} (bấm lần nữa để bỏ lọc)`;
    const glyph = el('span', 'status-glyph', meta.glyph);
    glyph.style.color = key === 'exited' ? 'var(--ink-dim)' : `var(--${key})`;
    item.append(glyph, el('b', null, String(tally[key])), document.createTextNode(' ' + meta.label));
    item.addEventListener('click', () => {
      statusFilter = statusFilter === key ? null : key;
      renderTop(latest);
      paintSelection();
    });
    counts.append(item);
  }

  // Provider Filter Pills (CSM-010)
  const providersEl = document.getElementById('providers');
  if (providersEl) {
    providersEl.replaceChildren();
    const allProvPill = el('button', 'filter-pill' + (providerFilter === null ? ' active' : ''));
    allProvPill.type = 'button';
    allProvPill.textContent = 'Tất cả Agent';
    allProvPill.addEventListener('click', () => {
      providerFilter = null;
      renderTop(latest);
      paintSelection();
    });
    providersEl.append(allProvPill);

    const provTally = { claude: 0, antigravity: 0, opencode: 0 };
    for (const s of state.sessions) {
      const p = s.provider || 'claude';
      if (provTally[p] !== undefined) provTally[p]++;
    }
    for (const pKey of ['claude', 'antigravity', 'opencode']) {
      const pMeta = PROVIDER_META[pKey];
      const isAct = providerFilter === pKey;
      const pBtn = el('button', 'filter-pill' + (isAct ? ' active' : ''));
      pBtn.type = 'button';
      pBtn.title = `Lọc công cụ: ${pMeta.short} (bấm lần nữa để bỏ lọc)`;
      pBtn.append(
        el('span', `provider-pill-dot ${pKey}`),
        el('b', null, String(provTally[pKey])),
        document.createTextNode(' ' + pMeta.short),
      );
      pBtn.addEventListener('click', () => {
        providerFilter = providerFilter === pKey ? null : pKey;
        renderTop(latest);
        paintSelection();
      });
      providersEl.append(pBtn);
    }
  }

  const limits = document.getElementById('limits');
  limits.replaceChildren();
  const usage = state.usage || {};
  for (const w of usage.windows || []) {
    const pct = Math.round(w.percent || 0);
    const item = el('div', 'limit' + (usage.stale ? ' stale' : ''));
    const bar = el('span', 'bar' + (pct >= 90 ? ' crit' : pct >= 75 ? ' warn' : ''));
    bar.innerHTML = '<i></i>';
    bar.firstChild.style.width = Math.min(100, pct) + '%';
    item.append(
      el('span', 'limit-label', w.label),
      bar,
      el('b', null, pct + '%'),
      el('span', 'limit-reset', until(w.resets_at)),
    );
    limits.append(item);
  }
  if (!(usage.windows || []).length && usage.status) {
    limits.append(el('div', 'limit', usage.status));
  }

  const upd = document.getElementById('updated');
  upd.classList.remove('offline');
  upd.querySelector('.conn-text').textContent =
    'Cập nhật ' + new Date().toLocaleTimeString('vi-VN');
}

// ---- side inspector (Split View + Segmented Tabs) ----------------------

function closePanel() {
  selection = null;
  lastRenderedSelectionKey = '';
  document.getElementById('panel').classList.add('hidden');
  document.getElementById('splitter').classList.add('hidden');
  requestAnimationFrame(() => {
    redrawAllWires();
    paintSelection();
  });
}

async function buildTerminalSection(sessionId, titleText) {
  const card = el('div', 'section-card');
  card.append(el('h3', 'section-title', titleText));
  const res = await fetch(`/api/sessions/${sessionId}/pane`);
  const data = await res.json().catch(() => ({ ok: false, detail: 'Lỗi đọc dữ liệu pane' }));
  if (!data.ok) {
    card.append(el('div', 'inspector-sub', data.detail || 'Không thể chụp màn hình tmux pane.'));
    return card;
  }
  const pre = el('pre', 'terminal-preview', data.text || '(Màn hình trống)');
  card.append(pre);
  requestAnimationFrame(() => {
    pre.scrollTop = pre.scrollHeight;
  });
  return card;
}

async function renderPanel(forceResetScroll = false) {
  const panel = document.getElementById('panel');
  const splitter = document.getElementById('splitter');
  const header = document.getElementById('panel-header');
  const tabs = document.getElementById('panel-tabs');
  const body = document.getElementById('panel-body');

  if (!selection || !latest) {
    closePanel();
    return;
  }

  const wasHidden = panel.classList.contains('hidden');
  panel.classList.remove('hidden');
  splitter.classList.remove('hidden');
  if (wasHidden) {
    requestAnimationFrame(() => {
      redrawAllWires();
      paintSelection();
    });
  }

  const byId = new Map(latest.sessions.map((s) => [s.id, s]));

  // Case 1: Tool Node Inspector
  if (selection.kind === 'tool') {
    const group = (latest.groups || []).find((g) => g.key === selection.groupKey);
    const tool = (group?.tools || []).find((t) => t.slug === selection.slug);
    if (!tool) { closePanel(); return; }

    header.replaceChildren();
    const titleRow = el('div', 'inspector-title-row');
    titleRow.append(
      el('h2', null, `${tool.kind === 'skill' ? 'Skill' : 'MCP'}: ${tool.name.replace(/^skill:/, '')}`),
      buildCloseButton(),
    );
    header.append(
      titleRow,
      el('div', 'inspector-sub', `${TOOL_STATE[tool.state] || tool.state} · Nhóm ${group.label}`),
    );
    tabs.classList.add('hidden');

    body.replaceChildren();
    const infoCard = el('div', 'section-card');
    infoCard.append(el('h3', 'section-title', 'Thông tin công cụ'));
    const kv = el('dl', 'kv');
    kv.append(
      el('dt', null, 'Phân loại'), el('dd', null, tool.kind === 'skill' ? 'Skill' : 'Máy chủ MCP'),
      el('dt', null, 'Trạng thái'), el('dd', null, TOOL_STATE[tool.state] || tool.state),
      el('dt', null, 'Tổng số lượt gọi'), el('dd', null, `${tool.calls || 0} lượt`),
    );
    if (tool.detail) {
      kv.append(el('dt', null, 'Chi tiết kết nối'), el('dd', null, tool.detail));
    }
    infoCard.append(kv);
    body.append(infoCard);

    const usersCard = el('div', 'section-card');
    usersCard.append(el('h3', 'section-title', `Phiên đã gọi (${(tool.users || []).length})`));
    if (!(tool.users || []).length) {
      usersCard.append(el('div', 'inspector-sub', 'Chưa có phiên nào trong nhóm gọi công cụ này.'));
    } else {
      const uList = el('dl', 'kv');
      for (const u of tool.users) {
        const s = byId.get(u.id);
        uList.append(
          el('dt', null, s ? s.name : u.id),
          el('dd', null, `${u.calls} lượt`),
        );
      }
      usersCard.append(uList);
    }
    body.append(usersCard);
    return;
  }

  const subject = byId.get(selection.id);
  if (!subject) { closePanel(); return; }

  // Case 2: Wire / Edge Thread Inspector
  if (selection.kind === 'edge') {
    const peer = byId.get(selection.peer);
    header.replaceChildren();
    const titleRow = el('div', 'inspector-title-row');
    titleRow.append(
      el('h2', null, `${subject.name} ↔ ${peer ? peer.name : selection.peer}`),
      buildCloseButton(),
    );
    header.append(
      titleRow,
      el('div', 'inspector-sub', 'Toàn văn luồng trao đổi giữa hai phiên (mới nhất ở trên).'),
    );
    tabs.classList.add('hidden');

    const res = await fetch(`/api/threads/${subject.id}/${selection.peer}`);
    const data = await res.json().catch(() => ({ messages: [] }));
    const prevScroll = body.scrollTop;
    body.replaceChildren();
    if (!data.messages.length) {
      body.append(el('div', 'inspector-sub', 'Chưa có tin nhắn nào được ghi nhận.'));
      return;
    }
    for (const m of data.messages.slice().reverse()) {
      body.append(buildMessageCard(
        m.from === subject.name ? 'out' : 'in',
        `${m.from} → ${m.to}` + (m.summary ? ' · ' + m.summary : ''),
        m.text || '',
        m.at,
      ));
    }
    if (!forceResetScroll) body.scrollTop = prevScroll;
    return;
  }

  // Case 3: Session Inspector with Segmented Tabs
  const selKey = `session:${subject.id}:${activeTab}`;
  const isNewSelection = selKey !== lastRenderedSelectionKey;
  lastRenderedSelectionKey = selKey;

  header.replaceChildren();
  const titleRow = el('div', 'inspector-title-row');
  const actions = el('div', 'inspector-actions');

  if (subject.tmux && !subject.exited) {
    const jumpBtn = el('button', 'btn-jump-header' + (subject.status === 'waiting' ? ' urgent' : ''));
    jumpBtn.type = 'button';
    jumpBtn.textContent = 'Nhảy tới pane ↗';
    jumpBtn.title = `Chuyển tới tmux pane ${subject.tmux}`;
    jumpBtn.addEventListener('click', () => jumpTo(subject.id, jumpBtn));
    actions.append(jumpBtn);
  } else {
    const copyBtn = el('button', 'btn-jump-header');
    copyBtn.type = 'button';
    copyBtn.textContent = '📋 Copy ID';
    copyBtn.title = `Sao chép ID phiên: ${subject.id}`;
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(subject.id);
        copyBtn.textContent = '✓ Đã chép ID';
        setTimeout(() => { copyBtn.textContent = '📋 Copy ID'; }, 1800);
      } catch (err) {
        copyBtn.textContent = subject.id.slice(0, 8);
      }
    });
    actions.append(copyBtn);
  }

  actions.append(buildCloseButton());
  titleRow.append(el('h2', null, subject.name), actions);

  const meta = STATUS_META[subject.status] || { label: subject.status, glyph: '•' };
  const provName = PROVIDER_META[subject.provider || 'claude']?.short || 'Claude';
  const pidPart = subject.pid ? ` · pid ${subject.pid}` : '';
  header.append(
    titleRow,
    el('div', 'inspector-sub', `[${provName}] ${meta.glyph} ${meta.label}${pidPart} · ${subject.cwd}`),
  );

  // Segmented Control
  tabs.classList.remove('hidden');
  tabs.replaceChildren();
  const termTabLabel = subject.tmux ? 'Terminal' : ((subject.artifacts || []).length ? 'Artifacts' : 'Terminal');
  const termTabCount = !subject.tmux && (subject.artifacts || []).length ? subject.artifacts.length : null;
  const tabDefs = [
    { id: 'overview', label: 'Tổng quan', count: null },
    { id: 'terminal', label: termTabLabel, count: termTabCount },
    { id: 'messages', label: 'Tin nhắn',  count: subject.messageCount || 0 },
    { id: 'bash',     label: 'Lệnh Bash', count: (subject.bash || []).length },
  ];
  for (const t of tabDefs) {
    const btn = el('button', 'seg-btn' + (activeTab === t.id ? ' active' : ''));
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(activeTab === t.id));
    btn.append(el('span', null, t.label));
    if (t.count !== null) btn.append(el('span', 'seg-count', String(t.count)));
    btn.addEventListener('click', () => {
      activeTab = t.id;
      renderPanel(true);
    });
    tabs.append(btn);
  }

  const prevScroll = body.scrollTop;

  if (activeTab === 'overview') {
    const fragments = [];

    // Live Terminal Snapshot right at the top when session is waiting (CSM-006)
    if (subject.status === 'waiting' && subject.tmux) {
      fragments.push(await buildTerminalSection(subject.id, 'Màn hình Terminal hiện tại (Đang chờ duyệt)'));
    }

    // Todos Checklist (CSM-003)
    const todos = subject.todos || [];
    if (todos.length > 0) {
      const done = todos.filter((t) => t.status === 'completed').length;
      const todoCard = el('div', 'section-card');
      todoCard.append(el('h3', 'section-title', `Tiến độ công việc (${done}/${todos.length})`));
      const ul = el('ul', 'todo-list');
      const markOf = { completed: '✓', in_progress: '●', pending: '○' };
      for (const t of todos) {
        const st = t.status || 'pending';
        const li = el('li', 'todo-item ' + st);
        li.append(
          el('span', 'todo-mark', markOf[st] || '○'),
          el('span', null, t.content),
        );
        ul.append(li);
      }
      todoCard.append(ul);
      fragments.push(todoCard);
    }

    // Context & Token Card (including Git Branch CSM-004)
    const ctxCard = el('div', 'section-card');
    ctxCard.append(el('h3', 'section-title', 'Context & Token'));
    const ctx = el('dl', 'kv');
    const gitBranchText = subject.git && subject.git.branch
      ? `${subject.git.branch}${subject.git.dirty ? ` (${subject.git.changedCount} thay đổi)` : ' (Sạch)'}`
      : '—';
    const cacheRead = Number(subject.tokens?.cache_read ?? 0);
    const cacheWrite = Number(subject.tokens?.cache_write ?? 0);
    const tokIn = Number(subject.tokens?.input ?? 0);
    const tokOut = Number(subject.tokens?.output ?? 0);
    const rows = [
      ['Công cụ Agent', PROVIDER_META[subject.provider || 'claude']?.short || 'Claude'],
      ['Nhánh Git', gitBranchText],
      ['Model', subject.model || 'Chưa gọi model'],
      ['Context đang dùng', `${short(subject.context.used)} / ${short(subject.context.window)} (${subject.context.percent}%)`],
      ['Cache Read', cacheRead.toLocaleString('vi-VN')],
      ['Cache Write', cacheWrite.toLocaleString('vi-VN')],
      ['Input mới', tokIn.toLocaleString('vi-VN')],
      ['Output', tokOut.toLocaleString('vi-VN')],
      ['Số lượt gọi / bước', String(subject.calls || 0)],
      ['Khởi chạy', ago(subject.startedAt)],
      ['Cập nhật trạng thái', ago(subject.updatedAt)],
      ['Tmux Pane', subject.tmux || '—'],
    ];
    if (typeof subject.cost === 'number' && subject.cost > 0) {
      rows.splice(8, 0, ['Chi phí (Cost)', `$${subject.cost.toFixed(4)}`]);
    }
    for (const [k, v] of rows) {
      ctx.append(el('dt', null, k), el('dd', null, v));
    }
    ctxCard.append(ctx);
    fragments.push(ctxCard);

    // Edited Files & Collisions Card (CSM-002)
    const filesEdited = subject.filesEdited || [];
    if (filesEdited.length > 0) {
      const fCard = el('div', 'section-card');
      fCard.append(el('h3', 'section-title', `File đã chỉnh sửa (${filesEdited.length})`));
      const conflictMap = new Map((subject.conflicts || []).map((c) => [c.path, c.peers]));
      for (const f of filesEdited) {
        const peers = conflictMap.get(f.path);
        const row = el('div', 'file-row' + (peers ? ' conflict' : ''));
        const top = el('div', 'file-row-top');
        top.append(
          el('span', 'file-path', shortPath(f.path, subject.cwd)),
          el('span', 'file-edits', `${f.edits} lần`),
        );
        row.append(top);
        if (peers) {
          row.append(el('div', 'file-conflict-note', `⚠ Đụng độ với: ${peers.join(', ')}`));
        }
        fCard.append(row);
      }
      fragments.push(fCard);
    }

    // Subagents Card (CSM-003)
    const subagents = subject.subagents || [];
    if (subagents.length > 0) {
      const subCard = el('div', 'section-card');
      subCard.append(el('h3', 'section-title', `Subagents đã gọi (${subagents.length})`));
      const sList = el('dl', 'kv');
      for (const sa of subagents.slice().reverse()) {
        sList.append(
          el('dt', null, `${sa.type || 'subagent'} · ${sa.description || '—'}`),
          el('dd', null, sa.at ? new Date(sa.at).toLocaleTimeString('vi-VN') : ''),
        );
      }
      subCard.append(sList);
      fragments.push(subCard);
    }

    // MCP & Skills Card
    const toolCard = el('div', 'section-card');
    toolCard.append(el('h3', 'section-title', 'Công cụ MCP & Skill đã gọi'));
    if (!subject.mcp.length && !subject.skills.length) {
      toolCard.append(el('div', 'inspector-sub', 'Phiên này chưa gọi máy chủ MCP hay Skill nào.'));
    } else {
      const list = el('dl', 'kv');
      for (const t of subject.mcp) {
        list.append(el('dt', null, 'MCP · ' + t.name), el('dd', null, t.calls + ' lượt'));
      }
      for (const t of subject.skills) {
        list.append(el('dt', null, 'Skill · ' + t.name), el('dd', null, t.calls + ' lượt'));
      }
      toolCard.append(list);
    }
    fragments.push(toolCard);

    body.replaceChildren(...fragments);
  } else if (activeTab === 'terminal') {
    if (subject.tmux) {
      const termCard = await buildTerminalSection(subject.id, `Màn hình Tmux (${subject.tmux})`);
      body.replaceChildren(termCard);
    } else {
      const fragments = [];
      const artifacts = subject.artifacts || [];
      if (artifacts.length > 0) {
        const artCard = el('div', 'section-card');
        artCard.append(el('h3', 'section-title', `Artifacts (${artifacts.length})`));
        for (const a of artifacts) {
          const row = el('div', 'file-row');
          const top = el('div', 'file-row-top');
          top.append(el('span', 'file-path', a.name), el('span', 'file-edits', shortPath(a.path)));
          row.append(top);
          artCard.append(row);
        }
        fragments.push(artCard);
      }
      const cmdCard = el('div', 'section-card');
      cmdCard.append(el('h3', 'section-title', 'Lệnh đã chạy gần đây (Ngoài tmux)'));
      if (!(subject.bash || []).length) {
        cmdCard.append(el('div', 'inspector-sub', 'Phiên này chạy trên IDE/Background ngoài tmux và chưa ghi nhận lệnh shell nào.'));
      } else {
        appendBashItems(cmdCard, subject.bash);
      }
      fragments.push(cmdCard);
      body.replaceChildren(...fragments);
    }
  } else if (activeTab === 'bash') {
    body.replaceChildren();
    if (!subject.bash.length) {
      body.append(el('div', 'inspector-sub', 'Chưa có lệnh Bash nào được ghi nhận gần đây.'));
    } else {
      appendBashItems(body, subject.bash);
    }
  } else if (activeTab === 'messages') {
    const res = await fetch(`/api/sessions/${subject.id}/messages`);
    const data = await res.json().catch(() => ({ messages: [] }));
    body.replaceChildren();
    if (!data.messages.length) {
      body.append(el('div', 'inspector-sub', 'Phiên này chưa gửi hoặc nhận tin nhắn từ phiên khác.'));
    } else {
      for (const m of data.messages.slice(-16).reverse()) {
        const headerLabel = (m.direction === 'out' ? '→ Gửi tới ' : '← Nhận từ ') +
                            m.peer + (m.summary ? ' · ' + m.summary : '');
        body.append(buildMessageCard(m.direction, headerLabel, m.text || '', m.at));
      }
    }
  }

  if (!forceResetScroll && !isNewSelection) {
    body.scrollTop = prevScroll;
  } else {
    body.scrollTop = 0;
  }
}

function appendBashItems(container, bashList) {
  for (const b of (bashList || []).slice().reverse()) {
    const item = el('div', 'cmd-item');
    const descParts = [];
    if (b.description) descParts.push(b.description);
    if (b.exitCode !== undefined && b.exitCode !== null) descParts.push(`exit ${b.exitCode}`);
    if (descParts.length) item.append(el('div', 'cmd-desc', descParts.join(' · ')));
    item.append(el('pre', 'cmd-code', b.command));
    container.append(item);
  }
}

function buildCloseButton() {
  const btn = el('button', 'panel-close', '×');
  btn.type = 'button';
  btn.title = 'Đóng bảng chi tiết (Esc)';
  btn.setAttribute('aria-label', 'Đóng bảng chi tiết');
  btn.addEventListener('click', closePanel);
  return btn;
}

function buildMessageCard(direction, whoText, rawText, isoAt) {
  const box = el('div', 'msg ' + direction);
  const head = el('div', 'msg-head');
  head.append(el('span', 'who', whoText));
  if (isoAt) {
    const d = new Date(isoAt);
    if (!isNaN(d)) {
      head.append(el('span', 'msg-time', d.toLocaleTimeString('vi-VN')));
    }
  }
  const text = (rawText || '').slice(0, 6000);
  const pre = el('pre', null, text);
  const isLong = text.length > 420 || text.split('\n').length > 7;
  box.append(head, pre);

  if (isLong) {
    pre.classList.add('collapsed-text');
    const toggle = el('button', 'btn-expand-msg', 'Xem toàn bộ nội dung');
    toggle.type = 'button';
    toggle.addEventListener('click', () => {
      const collapsedNow = pre.classList.toggle('collapsed-text');
      toggle.textContent = collapsedNow ? 'Xem toàn bộ nội dung' : 'Thu gọn';
    });
    box.append(toggle);
  }
  return box;
}

// ---- splitter drag resize ----------------------------------------------

(function initSplitter() {
  const splitter = document.getElementById('splitter');
  let dragging = false;

  splitter.addEventListener('mousedown', (e) => {
    e.preventDefault();
    dragging = true;
    splitter.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const width = Math.max(340, Math.min(760, window.innerWidth - e.clientX));
    document.documentElement.style.setProperty('--inspector-width', width + 'px');
    redrawAllWires();
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
})();

// ---- top bar controls & keyboard shortcuts -----------------------------

syncAlertButtonUI();
syncViewModeUI();

document.getElementById('view-2d')?.addEventListener('click', () => {
  viewMode = '2d';
  localStorage.setItem('csm_view_mode', '2d');
  syncViewModeUI();
});

document.getElementById('view-3d')?.addEventListener('click', () => {
  viewMode = '3d';
  localStorage.setItem('csm_view_mode', '3d');
  syncViewModeUI();
});
document.getElementById('alert-toggle')?.addEventListener('click', async () => {
  alertsEnabled = !alertsEnabled;
  localStorage.setItem('csm_alerts_enabled', alertsEnabled ? '1' : '0');
  syncAlertButtonUI();
  if (alertsEnabled && 'Notification' in window && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch (err) { /* ignore */ }
  }
});

document.getElementById('health-refresh').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const label = button.querySelector('span');
  button.disabled = true;
  button.classList.add('loading');
  label.textContent = 'Đang kiểm tra…';
  try {
    await fetch('/api/health/refresh', { method: 'POST' });
  } catch (err) { /* shown by the states */ }
  setTimeout(() => {
    button.disabled = false;
    button.classList.remove('loading');
    label.textContent = 'Kiểm tra MCP';
  }, 15000);
});

document.getElementById('expand-all').addEventListener('click', () => {
  collapsed.clear();
  if (latest) render(latest);
});

document.getElementById('collapse-all').addEventListener('click', () => {
  if (!latest) return;
  for (const g of latest.groups) collapsed.add(g.key);
  render(latest);
});

const searchInput = document.getElementById('search-input');
const searchClear = document.getElementById('search-clear');

searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value.trim().toLowerCase();
  searchClear.classList.toggle('hidden', !searchQuery);
  paintSelection();
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchQuery = '';
  searchClear.classList.add('hidden');
  paintSelection();
  searchInput.focus();
});

window.addEventListener('keydown', (event) => {
  if (event.key === '/' && document.activeElement !== searchInput &&
      !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
  } else if ((event.key === 'v' || event.key === 'V') &&
             document.activeElement !== searchInput &&
             !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) &&
             !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    viewMode = viewMode === '3d' ? '2d' : '3d';
    localStorage.setItem('csm_view_mode', viewMode);
    syncViewModeUI();
  } else if (event.key === 'Escape') {
    if (document.activeElement === searchInput && searchQuery) {
      searchInput.value = '';
      searchQuery = '';
      searchClear.classList.add('hidden');
      paintSelection();
      searchInput.blur();
    } else if (selection) {
      closePanel();
    } else if (statusFilter || providerFilter) {
      statusFilter = null;
      providerFilter = null;
      if (latest) renderTop(latest);
      paintSelection();
    }
  }
});

// ---- stream ------------------------------------------------------------

async function paintOnce() {
  try {
    const res = await fetch('/api/state');
    if (res.ok && !latest) render(await res.json());
  } catch (err) { /* the stream will paint instead */ }
}

function connect() {
  const source = new EventSource('/api/stream');
  source.onmessage = (event) => {
    try { render(JSON.parse(event.data)); } catch (err) { /* keep the last frame */ }
  };
  source.onerror = () => {
    const upd = document.getElementById('updated');
    upd.classList.add('offline');
    upd.querySelector('.conn-text').textContent = 'Mất kết nối — đang thử lại…';
    source.close();
    setTimeout(connect, 3000);
  };
}

window.addEventListener('resize', () => {
  redrawAllWires();
});

paintOnce();
connect();
