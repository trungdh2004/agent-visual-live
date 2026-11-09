'use strict';

// ============================================================================
// Three.js Full 3D Cyber-Office World ("3D Phòng ban" — Chibi Smooth & Banter Edition)
// - Smooth, rounded Capsule/Sphere Chibi 3D Developers (Fall Guys / Pixar-style silhouette)
// - Dynamic Canvas Face Textures with live expressions:
//     * busy: intense focused eyes, sweat drop, rapid typing + keyboard sparks
//     * waiting: pleading/panicked face, jumping & waving both arms, question popup bubble
//     * arguing/conflict: angry eyebrows, vein mark, turning head & pointing at peer
//     * idle: cool sunglasses, spinning gently in chair, sipping boba/coffee
// - Contextual Vietnamese Dev Banter ("Chửi nhau / Tấu hài") with 2-step call & response
// - Floating Question / Waiting Popup Toast Dock in top-right corner of 3D stage
// ============================================================================

(function () {
  if (typeof THREE === 'undefined') return;

  const PROVIDER_COLORS = {
    claude: {
      hoodie: 0xEA580C,
      hoodieLight: 0xFB923C,
      visor: 0xFDBA74,
      accent: 0xF97316,
      hex: '#FB923C',
      badge: 'CLAUDE',
    },
    antigravity: {
      hoodie: 0x0284C7,
      hoodieLight: 0x38BDF8,
      visor: 0x7DD3FC,
      accent: 0x38BDF8,
      hex: '#38BDF8',
      badge: 'ANTIGRAVITY',
    },
    opencode: {
      hoodie: 0x059669,
      hoodieLight: 0x34D399,
      visor: 0x6EE7B7,
      accent: 0x10B981,
      hex: '#34D399',
      badge: 'OPENCODE',
    },
  };

  // Contextual Vietnamese Dev Banter Library
  const BANTER_CONFLICT = [
    [
      'Ơ kìa đừng sửa chung file `{file}` nữa, lát git conflict nổ tung bây giờ!! 💢',
      'Ai bảo code chỗ đó rối quá, tao phải nhảy vào refactor hộ đấy! 😤',
    ],
    [
      'Ê `{peer}`! Buông cái file `{file}` ra, tao đang viết dở hàm ở trỏng! 🤬',
      'Mày gõ chậm như rùa ấy, để tao chốt luôn cho lẹ! 🔥',
    ],
    [
      'Lại đụng hàng file `{file}` rồi kìa ông tướng `{peer}` ơi! 💢',
      'Thôi mạnh ai nấy commit, thằng nào push sau tự đi mà merge nhá! 😎',
    ],
  ];

  const BANTER_BOSS_TO_WORKER = [
    [
      'Fix lẹ cái ticket đi `{peer}` ơi, sếp đang đứng sau lưng nhìn kìa! 👑',
      'Biết rồi khổ lắm nói mãi, đang gõ cháy cả bàn phím cơ đây sếp!! 💦',
    ],
    [
      'Sao rồi đệ `{peer}`, unit test đã xanh hết chưa mà im re vậy? 🧐',
      'Xanh 99% rồi đại ca, còn đúng 1 cái bug tâm linh đang khấn! 🙏',
    ],
    [
      'Giao việc từ nãy giờ xong chưa `{peer}`? Đừng để anh phải tự tay code! 🔥',
      'Bình tĩnh sếp ơi, em đang chạy 3 cái subagent cày phụ rồi đây! ⚡',
    ],
  ];

  const BANTER_BUSY_VS_IDLE = [
    [
      'Tao thì cày bục mặt tràn cả context, còn `{peer}` ngồi uống trà sữa xoay ghế thế à?! 💢',
      'Server chưa bắn prompt thì nghỉ dưỡng sức tí làm gì căng vậy bạn trẻ 😎☕',
    ],
    [
      'Ê `{peer}`, rảnh háng quá thì nhảy qua viết hộ tao mấy cái unit test đi! 💦',
      'Thôi bạn ơi, việc ai người nấy làm, mình đang bận... thở rồi 😌',
    ],
    [
      'Nhìn `{peer}` ngồi chơi mà tức cái lồng ngực á, phím tao sắp bốc khói rồi! 🔥',
      'Do ăn ở cả thôi bạn êi, code 1 dòng chuẩn luôn nên được nghỉ sớm! 💅',
    ],
  ];

  const BANTER_CROSS_PROVIDER = [
    [
      'Mấy ông khác chạy vừa thôi kẻo ngốn hết RAM máy chủ bây giờ! 😤',
      'Máy 64GB RAM cơ mà, cứ bật hết công suất lên sợ gì bố con thằng nào! 🚀',
    ],
    [
      'Ê `{peer}`, mày dùng model gì mà trả lời lẹ thế, có bịa code không đấy? 🤔',
      'Chuẩn từng dòng nhá, TDD đàng hoàng chứ ai chơi đoán mò! 😎',
    ],
  ];

  const BANTER_IDLE_CHITCHAT = [
    [
      'Ê `{peer}`, nay deploy thứ 6 đấy, mày đã chuẩn bị tinh thần trực đêm chưa? 👀',
      'Đừng gở mồm nha mày, tao vừa thắp hương cho con server xong! 🙏',
    ],
    [
      'Phòng mình nay yên ắng thế nhỉ, hay sếp đi họp quên giao việc rồi? ☕',
      'Suỵt! Nói khẽ thôi không ông chủ lại gõ `/implement` bắt cày cả lũ giờ! 🤫',
    ],
    [
      'Ê `{peer}`, nãy tao vừa thấy bóng ma của con subagent bị kill hôm qua... 👻',
      'Bớt hù đi ba, nó chỉ là Ghost Node lưu lại trong 2 tiếng thôi! 😂',
    ],
  ];

  const WAITING_SCREAMS = [
    'Sếp ơi cứu em!! Duyệt hộ em cái quyền này với, đứng hình nãy giờ rồi! 😭🙏',
    'Alo sếp ơi!! Có câu hỏi cần chốt gấp, bấm duyệt cho em chạy tiếp với!! 🚨',
    'Đợi sếp bấm Confirm mà chân tay tê cứng hết cả rồi sếp ơi!! 🥺',
  ];

  function formatTokenCount(n) {
    const val = Number(n) || 0;
    if (val >= 1000000) return (val / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (val >= 1000) return (val / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(val);
  }

  // Helper to draw 3D Radial Token Progress Ring under each Agent workstation
  function createTokenRingCanvasTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return { canvas, ctx: canvas.getContext('2d'), tex, lastKey: '' };
  }

  function paintTokenRing(ringObj, session, isSelected, pulseStep) {
    const used = Number(session.context?.used || 0);
    const win = Number(session.context?.window || 1000000) || 1000000;
    const rawPct = Math.min(100, Math.max(0, Number(session.context?.percent || (win > 0 ? (used / win) * 100 : 0))));
    const outTok = Number(session.tokens?.output || 0);
    const inTok = Number(session.tokens?.input || 0) + Number(session.tokens?.cache_write || 0);
    const status = session.status || 'idle';
    const isBusy = status === 'busy';
    const isWaiting = status === 'waiting';

    const key = `${Math.round(rawPct * 10)}:${used}:${outTok}:${status}:${isSelected ? 1 : 0}:${isBusy || isWaiting ? pulseStep : 0}`;
    if (ringObj.lastKey === key) return;
    ringObj.lastKey = key;

    const { ctx, canvas, tex } = ringObj;
    const cx = 256;
    const cy = 256;
    const R = 216;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Pick semantic token temperature color
    let arcColor = '#34D399'; // Emerald < 50%
    let glowColor = 'rgba(52, 211, 153, 0.55)';
    if (isWaiting || rawPct >= 85) {
      arcColor = '#EF4444'; // Critical Red
      glowColor = 'rgba(239, 68, 68, 0.65)';
    } else if (rawPct >= 55) {
      arcColor = '#F59E0B'; // Warning Amber
      glowColor = 'rgba(245, 158, 11, 0.6)';
    } else if (isSelected) {
      arcColor = '#38BDF8'; // Selected Cyan
      glowColor = 'rgba(56, 189, 248, 0.65)';
    }

    // 1. Dark Outer & Inner HUD Ring Track
    ctx.strokeStyle = isSelected ? 'rgba(56, 189, 248, 0.55)' : 'rgba(30, 41, 59, 0.9)';
    ctx.lineWidth = 28;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();

    // 2. 40 Sci-Fi Degree Tick Marks around the 360° Track
    const totalTicks = 40;
    const startAngle = -Math.PI / 2; // 12 o'clock (back of desk)
    // Visual ratio: accurate percentage, with a subtle minimum arc when tokens > 0 so low % is still clearly visible
    const totalTokens = used || (inTok + outTok);
    const effectiveRatio = totalTokens > 0
      ? Math.max(0.05, Math.min(1.0, rawPct / 100))
      : 0;
    const filledTicks = Math.round(effectiveRatio * totalTicks);

    for (let i = 0; i < totalTicks; i++) {
      const a = startAngle + (i / totalTicks) * Math.PI * 2;
      const isMajor = i % 10 === 0;
      const rIn = isMajor ? R - 13 : R - 9;
      const rOut = isMajor ? R + 13 : R + 9;
      ctx.strokeStyle = i < filledTicks
        ? arcColor
        : (isMajor ? 'rgba(148, 163, 184, 0.48)' : 'rgba(100, 116, 139, 0.25)');
      ctx.lineWidth = isMajor ? 4 : 2.5;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * rIn, cy + Math.sin(a) * rIn);
      ctx.lineTo(cx + Math.cos(a) * rOut, cy + Math.sin(a) * rOut);
      ctx.stroke();
    }

    // 3. Glowing Token Progress Arc (0% -> current token %)
    if (effectiveRatio > 0) {
      const endAngle = startAngle + effectiveRatio * Math.PI * 2;

      // Outer soft glow
      ctx.save();
      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 20;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, R, startAngle, endAngle);
      ctx.stroke();

      // Core bright progress bar
      ctx.strokeStyle = arcColor;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(cx, cy, R, startAngle, endAngle);
      ctx.stroke();
      ctx.restore();

      // Animated data-stream pulse traveling along the filled token arc when busy!
      if (isBusy) {
        const pulseRatio = ((pulseStep % 16) / 16) * effectiveRatio;
        const pAngle = startAngle + pulseRatio * Math.PI * 2;
        const px = cx + Math.cos(pAngle) * R;
        const py = cy + Math.sin(pAngle) * R;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(px, py, 8, 0, Math.PI * 2);
        ctx.fill();
      }

      // Glowing Tip Node at the end of the progress arc
      const tipX = cx + Math.cos(endAngle) * R;
      const tipY = cy + Math.sin(endAngle) * R;
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = arcColor;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(tipX, tipY, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 4. Secondary Inner Thin Arc for Output Tokens (Cyan/Purple accent)
    if (outTok > 0) {
      const outRatio = Math.min(1.0, Math.max(0.04, outTok / 100000));
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, R - 18, startAngle, startAngle + outRatio * Math.PI * 2);
      ctx.stroke();
    }

    // 5. Front Floor Badge showing exact Token Progress ("TOK 24.4% · 244.4k / 1M")
    const pctText = rawPct >= 10 ? `${Math.round(rawPct)}%` : `${rawPct.toFixed(1)}%`;
    const badgeText = totalTokens > 0
      ? `⚡ TOKEN ${pctText} · ${formatTokenCount(totalTokens)}/${formatTokenCount(win)}`
      : `⚡ TOKEN 0%`;

    ctx.save();
    ctx.font = 'bold 20px "JetBrains Mono", monospace';
    const textW = ctx.measureText(badgeText).width;
    const pillW = Math.min(440, textW + 34);
    const pillH = 36;
    const pillX = cx - pillW / 2;
    const pillY = cy + R - pillH / 2 + 4;

    ctx.fillStyle = 'rgba(9, 13, 22, 0.94)';
    ctx.strokeStyle = arcColor;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, pillW, pillH, 18);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#F8FAFC';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText, cx, pillY + pillH / 2 + 1);
    ctx.restore();

    tex.needsUpdate = true;
  }

  // Helper to draw dynamic anime/chibi face expressions onto a 2D CanvasTexture
  function createFaceCanvasTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return { canvas, ctx: canvas.getContext('2d'), tex, lastKey: '' };
  }

  function paintFace(faceObj, mode, blink, tick) {
    const key = `${mode}:${blink ? 1 : 0}:${Math.floor(tick * 4) % 2}`;
    if (faceObj.lastKey === key) return;
    faceObj.lastKey = key;

    const { ctx, canvas, tex } = faceObj;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Warm smooth chibi skin background
    ctx.fillStyle = '#FDE68A';
    ctx.fillRect(0, 0, 256, 256);

    // Rosy cheeks
    ctx.fillStyle = mode === 'angry' ? 'rgba(239, 68, 68, 0.45)' : 'rgba(251, 113, 133, 0.35)';
    ctx.beginPath();
    ctx.ellipse(58, 152, 22, 13, 0, 0, Math.PI * 2);
    ctx.ellipse(198, 152, 22, 13, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#1E293B';
    ctx.fillStyle = '#0F172A';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (mode === 'idle') {
      // Cool Sunglasses 😎 + Relaxed Smirk
      ctx.fillStyle = '#090D16';
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 5;
      // Left lens
      ctx.beginPath();
      ctx.roundRect(42, 92, 74, 44, 10);
      ctx.fill();
      ctx.stroke();
      // Right lens
      ctx.beginPath();
      ctx.roundRect(140, 92, 74, 44, 10);
      ctx.fill();
      ctx.stroke();
      // Bridge
      ctx.beginPath();
      ctx.moveTo(116, 106);
      ctx.lineTo(140, 106);
      ctx.stroke();
      // White lens shine
      ctx.strokeStyle = 'rgba(255,255,255,0.65)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(56, 102);
      ctx.lineTo(72, 124);
      ctx.moveTo(154, 102);
      ctx.lineTo(170, 124);
      ctx.stroke();

      // Confident smirk
      ctx.strokeStyle = '#1E293B';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(132, 168, 22, 0.15 * Math.PI, 0.8 * Math.PI);
      ctx.stroke();
    } else if (mode === 'angry') {
      // Angry arguing face 💢
      ctx.lineWidth = 8;
      // V-shaped angry eyebrows
      ctx.beginPath();
      ctx.moveTo(52, 82);
      ctx.lineTo(106, 104);
      ctx.moveTo(204, 82);
      ctx.lineTo(150, 104);
      ctx.stroke();

      // Fierce eyes
      ctx.fillStyle = '#0F172A';
      ctx.beginPath();
      ctx.arc(80, 122, 16, 0, Math.PI * 2);
      ctx.arc(176, 122, 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#EF4444';
      ctx.beginPath();
      ctx.arc(80, 122, 6, 0, Math.PI * 2);
      ctx.arc(176, 122, 6, 0, Math.PI * 2);
      ctx.fill();

      // Shouting open mouth
      ctx.fillStyle = '#991B1B';
      ctx.beginPath();
      ctx.roundRect(102, 158, 52, 34, 12);
      ctx.fill();
      ctx.stroke();

      // Anime anger vein mark 💢 on forehead
      ctx.strokeStyle = '#EF4444';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(190, 48); ctx.lineTo(205, 62);
      ctx.moveTo(220, 48); ctx.lineTo(205, 62);
      ctx.moveTo(190, 74); ctx.lineTo(205, 62);
      ctx.moveTo(220, 74); ctx.lineTo(205, 62);
      ctx.stroke();
    } else if (mode === 'waiting') {
      // Pleading / Panicked Puppy Eyes 🥺 / 😱
      ctx.lineWidth = 6;
      // Worried eyebrows
      ctx.beginPath();
      ctx.moveTo(52, 96);
      ctx.lineTo(100, 82);
      ctx.moveTo(204, 96);
      ctx.lineTo(156, 82);
      ctx.stroke();

      // Big sparkling pleading eyes
      ctx.fillStyle = '#0F172A';
      ctx.beginPath();
      ctx.arc(80, 124, 21, 0, Math.PI * 2);
      ctx.arc(176, 124, 21, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(73, 117, 8, 0, Math.PI * 2);
      ctx.arc(169, 117, 8, 0, Math.PI * 2);
      ctx.arc(87, 131, 4, 0, Math.PI * 2);
      ctx.arc(183, 131, 4, 0, Math.PI * 2);
      ctx.fill();

      // Wavy crying/calling mouth
      ctx.fillStyle = '#F87171';
      ctx.beginPath();
      ctx.ellipse(128, 174, 22, 16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      // Busy / Focused coding face 🔥_🔥 + Sweat drop
      ctx.lineWidth = 7;
      // Determined eyebrows
      ctx.beginPath();
      ctx.moveTo(54, 92);
      ctx.lineTo(104, 102);
      ctx.moveTo(202, 92);
      ctx.lineTo(152, 102);
      ctx.stroke();

      if (blink) {
        ctx.beginPath();
        ctx.moveTo(60, 124); ctx.lineTo(100, 124);
        ctx.moveTo(156, 124); ctx.lineTo(196, 124);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#0F172A';
        ctx.beginPath();
        ctx.arc(80, 124, 17, 0, Math.PI * 2);
        ctx.arc(176, 124, 17, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#34D399';
        ctx.beginPath();
        ctx.arc(75, 119, 6, 0, Math.PI * 2);
        ctx.arc(171, 119, 6, 0, Math.PI * 2);
        ctx.fill();
      }

      // Focused cat-like mouth
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(116, 168, 12, 0, Math.PI);
      ctx.arc(140, 168, 12, 0, Math.PI);
      ctx.stroke();

      // Blue anime sweat drop on temple 💦
      ctx.fillStyle = '#38BDF8';
      ctx.beginPath();
      ctx.moveTo(216, 72);
      ctx.quadraticCurveTo(230, 96, 216, 106);
      ctx.quadraticCurveTo(202, 96, 216, 72);
      ctx.fill();
    }

    tex.needsUpdate = true;
  }

  class Office3DScene {
    constructor(hostEl) {
      this.host = hostEl;
      this.active = false;
      this.state = null;
      this.selection = null;
      this.onSelectSession = null;
      this.onSelectEdge = null;
      this.onJumpSession = null;

      // Scene & Renderer
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x080B11);
      this.scene.fog = new THREE.FogExp2(0x080B11, 0.0038);

      this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 450);
      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.domElement.className = 'office3d-canvas';

      // HTML Overlay Layer for Floating Nameplates, Comic Speech Bubbles & Room Banners
      this.labelLayer = document.createElement('div');
      this.labelLayer.className = 'office3d-labels';

      // Top-Right Urgent Question / Waiting Popup Toast Dock
      this.popupDock = document.createElement('div');
      this.popupDock.className = 'office3d-popup-dock';

      // Bottom HUD Controls Overlay (Camera Hint + Trigger Drama + Reset Camera)
      this.hudBar = document.createElement('div');
      this.hudBar.className = 'office3d-hud';
      this.hudBar.innerHTML = `
        <div class="office3d-hint">
          <span>🖱 Kéo trái: <b>Xoay 360°</b></span>
          <span>· Kéo phải: <b>Trượt sàn</b></span>
          <span>· Cuộn: <b>Zoom</b></span>
        </div>
        <button type="button" class="office3d-drama-btn" title="Kích hoạt ngay một màn cà khịa / đấu khẩu giữa các Bot!">🔥 Kích hoạt Drama</button>
        <button type="button" class="office3d-reset-btn" title="Đưa góc nhìn Camera về vị trí trung tâm">🎥 Đặt lại góc nhìn</button>
      `;
      this.hudBar.querySelector('.office3d-reset-btn').addEventListener('click', () => this.resetCamera());
      this.hudBar.querySelector('.office3d-drama-btn').addEventListener('click', () => this.triggerBanter(true));

      this.host.append(this.renderer.domElement, this.labelLayer, this.popupDock, this.hudBar);

      // Camera Orbit & Pan State
      this.target = new THREE.Vector3(0, 0, 2);
      this.spherical = { radius: 40, theta: 0.34, phi: 0.90 };
      this.isDragging = false;
      this.dragMode = 'orbit';
      this.downPos = { x: 0, y: 0 };
      this.lastPos = { x: 0, y: 0 };

      this.raycaster = new THREE.Raycaster();
      this.mouse = new THREE.Vector2();

      this.worldRoot = new THREE.Group();
      this.scene.add(this.worldRoot);

      this.workstations = new Map();
      this.conduits = new Map();
      this.roomGroups = new Map();
      this.pickables = [];

      // Banter / Drama Engine State
      this.activeBanter = null; // { speakerA, speakerB, lookTargetA, lookTargetB, until }
      this.nextBanterAt = performance.now() + 3500;

      this._setupLights();
      this._setupGround();
      this._bindEvents();
      this.updateCameraPosition();

      this.clock = new THREE.Clock();
      this._animate = this._animate.bind(this);
      requestAnimationFrame(this._animate);
    }

    _setupLights() {
      const hemi = new THREE.HemisphereLight(0xBAE6FD, 0x0F172A, 1.25);
      hemi.position.set(0, 55, 0);
      this.scene.add(hemi);

      const dir = new THREE.DirectionalLight(0xFFFBEB, 1.4);
      dir.position.set(26, 46, 34);
      dir.castShadow = true;
      dir.shadow.mapSize.width = 2048;
      dir.shadow.mapSize.height = 2048;
      dir.shadow.camera.near = 5;
      dir.shadow.camera.far = 160;
      const d = 55;
      dir.shadow.camera.left = -d;
      dir.shadow.camera.right = d;
      dir.shadow.camera.top = d;
      dir.shadow.camera.bottom = -d;
      dir.shadow.bias = -0.0005;
      this.scene.add(dir);

      const rim = new THREE.DirectionalLight(0x38BDF8, 0.65);
      rim.position.set(-30, 24, -26);
      this.scene.add(rim);
    }

    _setupGround() {
      const grid = new THREE.GridHelper(260, 130, 0x1E293B, 0x111827);
      grid.position.y = -0.05;
      this.scene.add(grid);
    }

    _bindEvents() {
      const dom = this.renderer.domElement;

      dom.addEventListener('contextmenu', (e) => e.preventDefault());

      dom.addEventListener('mousedown', (e) => {
        this.isDragging = true;
        this.downPos = { x: e.clientX, y: e.clientY };
        this.lastPos = { x: e.clientX, y: e.clientY };
        this.dragMode = (e.button === 2 || e.button === 1 || e.shiftKey) ? 'pan' : 'orbit';
        dom.style.cursor = 'grabbing';
      });

      window.addEventListener('mousemove', (e) => {
        if (!this.active) return;
        if (!this.isDragging) {
          this._handleHover(e);
          return;
        }
        const dx = e.clientX - this.lastPos.x;
        const dy = e.clientY - this.lastPos.y;
        this.lastPos = { x: e.clientX, y: e.clientY };

        if (this.dragMode === 'orbit') {
          this.spherical.theta -= dx * 0.0065;
          this.spherical.phi = Math.max(0.28, Math.min(1.38, this.spherical.phi - dy * 0.006));
          this.updateCameraPosition();
        } else {
          const panSpeed = this.spherical.radius * 0.0016;
          const forward = new THREE.Vector3();
          this.camera.getWorldDirection(forward);
          forward.y = 0;
          forward.normalize();
          const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
          this.target.addScaledVector(right, -dx * panSpeed);
          this.target.addScaledVector(forward, dy * panSpeed);
          this.updateCameraPosition();
        }
      });

      window.addEventListener('mouseup', (e) => {
        if (!this.isDragging) return;
        this.isDragging = false;
        this.renderer.domElement.style.cursor = 'grab';
        const dist = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
        if (dist < 5 && e.button === 0 && e.target === this.renderer.domElement) {
          this._handleClick(e);
        }
      });

      dom.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1.09 : 0.91;
        this.spherical.radius = Math.max(12, Math.min(135, this.spherical.radius * factor));
        this.updateCameraPosition();
      }, { passive: false });

      window.addEventListener('resize', () => {
        if (this.active) this.resize();
      });
    }

    resetCamera() {
      this.target.set(0, 0, 4);
      this.spherical = { radius: 40, theta: 0.34, phi: 0.90 };
      this.updateCameraPosition();
    }

    focusOnSession(sessionId) {
      const ws = this.workstations.get(sessionId);
      if (!ws) return;
      this.target.copy(ws.root.position).add(new THREE.Vector3(0, 1.2, 0));
      this.spherical.radius = 22;
      this.updateCameraPosition();
    }

    updateCameraPosition() {
      const { radius, theta, phi } = this.spherical;
      const x = this.target.x + radius * Math.sin(phi) * Math.sin(theta);
      const y = this.target.y + radius * Math.cos(phi);
      const z = this.target.z + radius * Math.sin(phi) * Math.cos(theta);
      this.camera.position.set(x, y, z);
      this.camera.lookAt(this.target);
    }

    resize() {
      const rect = this.host.getBoundingClientRect();
      const w = Math.max(300, rect.width);
      const h = Math.max(400, window.innerHeight - 48);
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }

    setActive(on) {
      this.active = on;
      this.host.classList.toggle('hidden', !on);
      if (on) {
        this.resize();
        if (this.state) this.syncState(this.state, this.selection);
      }
    }

    _handleHover(e) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        return;
      }
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const hits = this.raycaster.intersectObjects(this.pickables, true);
      this.renderer.domElement.style.cursor = hits.length > 0 ? 'pointer' : 'grab';
    }

    _handleClick(e) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.mouse, this.camera);
      const hits = this.raycaster.intersectObjects(this.pickables, true);
      if (hits.length > 0) {
        let obj = hits[0].object;
        while (obj && !obj.userData?.sessionId && !obj.userData?.edge) {
          obj = obj.parent;
        }
        if (obj?.userData?.sessionId && this.onSelectSession) {
          this.onSelectSession(obj.userData.sessionId);
        } else if (obj?.userData?.edge && this.onSelectEdge) {
          this.onSelectEdge(obj.userData.edge.from, obj.userData.edge.to);
        }
      }
    }

    // ---- Build Smooth Rounded Chibi 3D Character + Workstation ------------

    _createWorkstationMesh(session) {
      const root = new THREE.Group();
      root.userData.sessionId = session.id;

      const prov = PROVIDER_COLORS[session.provider || 'claude'] || PROVIDER_COLORS.claude;

      // 1. Plush Circular Rug under Workstation
      const matGeo = new THREE.CylinderGeometry(2.45, 2.55, 0.08, 48);
      const matMat = new THREE.MeshStandardMaterial({
        color: session.coordinates ? 0x1E3A5F : 0x151D2E,
        roughness: 0.75,
        metalness: 0.15,
      });
      const floorMat = new THREE.Mesh(matGeo, matMat);
      floorMat.position.y = 0.04;
      floorMat.receiveShadow = true;
      root.add(floorMat);

      const tokenRingCanvas = createTokenRingCanvasTexture();
      paintTokenRing(tokenRingCanvas, session, false, 0);
      const ringGeo = new THREE.PlaneGeometry(5.85, 5.85);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        map: tokenRingCanvas.tex,
        transparent: true,
        opacity: 0.96,
        depthWrite: false,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.y = 0.095;
      root.add(ringMesh);

      // 2. Curved Modern Desk
      const deskGroup = new THREE.Group();
      deskGroup.position.set(0, 0, -0.58);
      root.add(deskGroup);

      const topWidth = session.coordinates ? 3.3 : 2.75;
      const topDepth = 1.4;
      const deskTop = new THREE.Mesh(
        new THREE.BoxGeometry(topWidth, 0.14, topDepth),
        new THREE.MeshStandardMaterial({
          color: session.coordinates ? 0x334155 : 0x263142,
          roughness: 0.4,
          metalness: 0.25,
        })
      );
      deskTop.position.y = 1.45;
      deskTop.castShadow = true;
      deskTop.receiveShadow = true;
      deskGroup.add(deskTop);

      // Glowing Neon Front Strip on Desk
      const trim = new THREE.Mesh(
        new THREE.BoxGeometry(topWidth + 0.04, 0.055, 0.06),
        new THREE.MeshBasicMaterial({ color: prov.accent })
      );
      trim.position.set(0, 1.45, -topDepth / 2 - 0.01);
      deskGroup.add(trim);

      // Cylindrical Smooth Desk Legs
      const legMat = new THREE.MeshStandardMaterial({ color: 0x0F172A, roughness: 0.45, metalness: 0.6 });
      const legGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.42, 16);
      const lLeg1 = new THREE.Mesh(legGeo, legMat);
      lLeg1.position.set(-topWidth / 2 + 0.22, 0.71, -0.45);
      const lLeg2 = new THREE.Mesh(legGeo, legMat);
      lLeg2.position.set(-topWidth / 2 + 0.22, 0.71, 0.45);
      const rLeg1 = new THREE.Mesh(legGeo, legMat);
      rLeg1.position.set(topWidth / 2 - 0.22, 0.71, -0.45);
      const rLeg2 = new THREE.Mesh(legGeo, legMat);
      rLeg2.position.set(topWidth / 2 - 0.22, 0.71, 0.45);
      deskGroup.add(lLeg1, lLeg2, rLeg1, rLeg2);

      // 3. Dual Curved Monitors + Boba/Coffee Cup + Keyboard
      const monitorMat = new THREE.MeshStandardMaterial({ color: 0x090D16, roughness: 0.25, metalness: 0.65 });
      const screenMat = new THREE.MeshBasicMaterial({ color: 0x34D399 });

      const mainMon = new THREE.Group();
      mainMon.position.set(-0.32, 2.0, -0.22);
      mainMon.rotation.y = 0.14;
      const mFrame = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.74, 0.07), monitorMat);
      mFrame.castShadow = true;
      const mScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.06, 0.62), screenMat);
      mScreen.position.z = 0.04;
      const mStand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.36, 16), monitorMat);
      mStand.position.set(0, -0.42, -0.04);
      mainMon.add(mFrame, mScreen, mStand);
      deskGroup.add(mainMon);

      const sideMon = new THREE.Group();
      sideMon.position.set(0.72, 1.95, -0.1);
      sideMon.rotation.y = -0.35;
      const sFrame = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.66, 0.06), monitorMat);
      sFrame.castShadow = true;
      const sScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.56), screenMat.clone());
      sScreen.position.z = 0.036;
      const sStand = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, 0.32, 16), monitorMat);
      sStand.position.set(0, -0.38, -0.03);
      sideMon.add(sFrame, sScreen, sStand);
      deskGroup.add(sideMon);

      // RGB Keyboard
      const kbMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.045, 0.28),
        new THREE.MeshStandardMaterial({ color: 0x1E293B, emissive: prov.accent, emissiveIntensity: 0.35 })
      );
      kbMesh.position.set(-0.1, 1.54, 0.3);
      deskGroup.add(kbMesh);

      // Boba / Coffee Cup with Straw on Desk
      const mugGroup = new THREE.Group();
      mugGroup.position.set(-0.96, 1.64, 0.26);
      const cupBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.095, 0.28, 20),
        new THREE.MeshStandardMaterial({ color: 0xFDE68A, roughness: 0.3 })
      );
      const cupDome = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0xF8FAFC, transparent: true, opacity: 0.75 })
      );
      cupDome.position.y = 0.14;
      const straw = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 0.22, 10),
        new THREE.MeshStandardMaterial({ color: prov.hoodieLight })
      );
      straw.position.set(0.02, 0.2, 0);
      straw.rotation.z = -0.2;
      mugGroup.add(cupBody, cupDome, straw);
      deskGroup.add(mugGroup);

      // Spinning Red Siren Beacon on Desk Corner
      const sirenGroup = new THREE.Group();
      sirenGroup.position.set(topWidth / 2 - 0.28, 1.65, -0.35);
      const sirenBase = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.18, 0.08, 20),
        new THREE.MeshStandardMaterial({ color: 0x1E293B })
      );
      const sirenBulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 20, 16),
        new THREE.MeshBasicMaterial({ color: 0xEF4444 })
      );
      sirenBulb.position.y = 0.14;
      const sirenLight = new THREE.PointLight(0xEF4444, 0, 7);
      sirenLight.position.y = 0.32;
      sirenGroup.add(sirenBase, sirenBulb, sirenLight);
      sirenGroup.visible = false;
      deskGroup.add(sirenGroup);

      // 4. Swivel Gaming Chair (Grouped with Character so Chair + Character can swivel together!)
      const swivelUnit = new THREE.Group();
      swivelUnit.position.set(0, 0, 0.58);
      root.add(swivelUnit);

      // Fixed Chair Pedestal Base on Floor
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.85, 16), legMat);
      pedestal.position.set(0, 0.42, 0.58);
      const wheelBase = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.54, 0.06, 5), legMat);
      wheelBase.position.set(0, 0.05, 0.58);
      root.add(pedestal, wheelBase);

      // Rotating Chair Seat & Rounded Bucket Backrest
      const chairSeat = new THREE.Mesh(
        new THREE.CylinderGeometry(0.52, 0.48, 0.14, 24),
        new THREE.MeshStandardMaterial({ color: 0x1E293B, roughness: 0.5 })
      );
      chairSeat.position.y = 0.88;
      chairSeat.castShadow = true;

      const chairBack = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.42, 0.55, 12, 24),
        new THREE.MeshStandardMaterial({ color: 0x0F172A, roughness: 0.45 })
      );
      chairBack.scale.set(1, 1, 0.32);
      chairBack.position.set(0, 1.52, 0.38);
      chairBack.castShadow = true;

      const chairAccent = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.28, 0.48, 8, 16),
        new THREE.MeshStandardMaterial({ color: prov.hoodie, roughness: 0.4 })
      );
      chairAccent.scale.set(1, 1, 0.35);
      chairAccent.position.set(0, 1.52, 0.37);
      swivelUnit.add(chairSeat, chairBack, chairAccent);

      // 5. Smooth Rounded Chibi Developer Character (Fall Guys / Pixar-style smooth capsules & spheres)
      const charGroup = new THREE.Group();
      charGroup.position.set(0, 0.96, -0.04);
      charGroup.rotation.y = Math.PI; // Face toward -Z (desk)
      swivelUnit.add(charGroup);

      const torsoGroup = new THREE.Group();
      charGroup.add(torsoGroup);

      const hoodieMat = new THREE.MeshStandardMaterial({
        color: prov.hoodie,
        roughness: 0.42,
        metalness: 0.08,
      });
      const skinMat = new THREE.MeshStandardMaterial({
        color: 0xFDE68A,
        roughness: 0.48,
      });
      const pantsMat = new THREE.MeshStandardMaterial({
        color: 0x1E293B,
        roughness: 0.6,
      });

      // Smooth Rounded Chibi Torso (Bean/Capsule shape)
      const torsoMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.34, 16, 28), hoodieMat);
      torsoMesh.position.y = 0.44;
      torsoMesh.castShadow = true;
      torsoGroup.add(torsoMesh);

      // Cute Belly Pocket / Badge on Hoodie Front
      const pocketMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.24, 20, 16),
        new THREE.MeshStandardMaterial({ color: prov.hoodieLight, roughness: 0.5 })
      );
      pocketMesh.scale.set(1.1, 0.7, 0.35);
      pocketMesh.position.set(0, 0.32, 0.33);
      torsoGroup.add(pocketMesh);

      // Smooth Rounded Head Group with Dynamic Expression Canvas Texture
      const headGroup = new THREE.Group();
      headGroup.position.set(0, 0.92, 0);
      torsoGroup.add(headGroup);

      const headSphere = new THREE.Mesh(new THREE.SphereGeometry(0.46, 32, 28), skinMat);
      headSphere.scale.set(1.06, 0.96, 0.98);
      headSphere.position.y = 0.38;
      headSphere.castShadow = true;
      headGroup.add(headSphere);

      // Curved Face Expression Plane mapped onto the front of the head sphere
      const faceCanvas = createFaceCanvasTexture();
      paintFace(faceCanvas, session.status === 'busy' ? 'busy' : 'idle', false, 0);
      const facePlane = new THREE.Mesh(
        new THREE.PlaneGeometry(0.56, 0.52),
        new THREE.MeshBasicMaterial({ map: faceCanvas.tex, transparent: true })
      );
      facePlane.position.set(0, 0.36, 0.455);
      headGroup.add(facePlane);

      // Smooth Rounded Hair / Hood Cap on Back & Top of Head
      const hairMat = new THREE.MeshStandardMaterial({
        color: session.provider === 'antigravity' ? 0x0F172A : 0x27272A,
        roughness: 0.5,
      });
      const hairCap = new THREE.Mesh(
        new THREE.SphereGeometry(0.48, 28, 24, 0, Math.PI * 2, 0, Math.PI * 0.62),
        hairMat
      );
      hairCap.scale.set(1.06, 0.98, 1.02);
      hairCap.position.set(0, 0.41, -0.04);
      hairCap.rotation.x = -0.32;
      headGroup.add(hairCap);

      // Stylish Rounded RGB Headphones with Cat/Cyber Ears!
      const earMat = new THREE.MeshStandardMaterial({
        color: prov.hoodieLight,
        emissive: prov.accent,
        emissiveIntensity: 0.45,
        roughness: 0.3,
      });
      const leftCup = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 24), earMat);
      leftCup.rotation.z = Math.PI / 2;
      leftCup.position.set(-0.49, 0.38, 0.02);
      const rightCup = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.12, 24), earMat);
      rightCup.rotation.z = Math.PI / 2;
      rightCup.position.set(0.49, 0.38, 0.02);

      const bandArc = new THREE.Mesh(
        new THREE.TorusGeometry(0.48, 0.045, 14, 32, Math.PI),
        earMat
      );
      bandArc.position.set(0, 0.38, 0.02);
      headGroup.add(leftCup, rightCup, bandArc);

      // Cute Cat / Cyber Ears on top of the Headband (or Golden Crown for Coordinator!)
      if (session.coordinates) {
        const crownMat = new THREE.MeshStandardMaterial({
          color: 0xFBBF24,
          emissive: 0xD97706,
          emissiveIntensity: 0.35,
          metalness: 0.6,
          roughness: 0.25,
        });
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.18, 6), crownMat);
        crown.position.set(0, 0.92, 0.05);
        headGroup.add(crown);
      } else {
        const coneGeo = new THREE.ConeGeometry(0.11, 0.22, 16);
        const leftCatEar = new THREE.Mesh(coneGeo, earMat);
        leftCatEar.position.set(-0.28, 0.86, 0.02);
        leftCatEar.rotation.z = 0.35;
        const rightCatEar = new THREE.Mesh(coneGeo, earMat);
        rightCatEar.position.set(0.28, 0.86, 0.02);
        rightCatEar.rotation.z = -0.35;
        headGroup.add(leftCatEar, rightCatEar);
      }

      // Smooth Capsule Arms + Chubby Spherical Hands
      const leftArmPivot = new THREE.Group();
      leftArmPivot.position.set(-0.44, 0.66, 0);
      const leftArmMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.36, 12, 18), hoodieMat);
      leftArmMesh.position.set(0, -0.2, 0.18);
      leftArmMesh.rotation.x = -Math.PI / 3;
      leftArmMesh.castShadow = true;
      const leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), skinMat);
      leftHand.position.set(0, -0.38, 0.36);
      leftArmPivot.add(leftArmMesh, leftHand);
      torsoGroup.add(leftArmPivot);

      const rightArmPivot = new THREE.Group();
      rightArmPivot.position.set(0.44, 0.66, 0);
      const rightArmMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.36, 12, 18), hoodieMat);
      rightArmMesh.position.set(0, -0.2, 0.18);
      rightArmMesh.rotation.x = -Math.PI / 3;
      rightArmMesh.castShadow = true;
      const rightHand = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 16), skinMat);
      rightHand.position.set(0, -0.38, 0.36);
      rightArmPivot.add(rightArmMesh, rightHand);
      torsoGroup.add(rightArmPivot);

      // Smooth Capsule Legs + Sneakers
      const legCapsuleGeo = new THREE.CapsuleGeometry(0.12, 0.32, 12, 18);
      const leftLegMesh = new THREE.Mesh(legCapsuleGeo, pantsMat);
      leftLegMesh.rotation.x = Math.PI / 2;
      leftLegMesh.position.set(-0.18, 0.1, 0.22);
      const rightLegMesh = new THREE.Mesh(legCapsuleGeo, pantsMat);
      rightLegMesh.rotation.x = Math.PI / 2;
      rightLegMesh.position.set(0.18, 0.1, 0.22);
      charGroup.add(leftLegMesh, rightLegMesh);

      // Mark meshes pickable
      root.traverse((child) => {
        if (child.isMesh) {
          child.userData.sessionId = session.id;
        }
      });

      // Floating HTML Nameplate + Comic Speech Bubble Container
      const labelEl = document.createElement('div');
      labelEl.className = 'office3d-tag';
      labelEl.addEventListener('click', (e) => {
        if (e.target.closest('.tag-jump-btn')) return;
        e.stopPropagation();
        if (this.onSelectSession) this.onSelectSession(session.id);
      });

      const bubbleEl = document.createElement('div');
      bubbleEl.className = 'office3d-speech hidden';

      this.labelLayer.append(labelEl, bubbleEl);

      return {
        id: session.id,
        session,
        root,
        swivelUnit,
        charGroup,
        floorMat,
        ringMat,
        tokenRingCanvas,
        isSelected: false,
        mScreen,
        sScreen,
        sirenGroup,
        sirenLight,
        torsoGroup,
        headGroup,
        leftArmPivot,
        rightArmPivot,
        faceCanvas,
        labelEl,
        bubbleEl,
        speechText: '',
        speechMood: 'normal', // 'normal' | 'angry' | 'question'
        speechUntil: 0,
        lookAtWorld: null,
        phaseOffset: Math.random() * Math.PI * 2,
      };
    }

    // ---- Banter / Drama Engine ("Chửi nhau / Tấu hài") ---------------------

    say(sessionId, text, mood = 'normal', durationMs = 5200, lookAtPos = null) {
      const ws = this.workstations.get(sessionId);
      if (!ws || !ws.root.visible) return;
      ws.speechText = text;
      ws.speechMood = mood;
      ws.speechUntil = performance.now() + durationMs;
      ws.lookAtWorld = lookAtPos;

      ws.bubbleEl.className = `office3d-speech mood-${mood}`;
      ws.bubbleEl.textContent = text;
    }

    triggerBanter(forced = false) {
      if (!this.state) return;
      const now = performance.now();
      const liveList = [];
      for (const [, ws] of this.workstations) {
        if (ws.root.visible && !ws.session.exited) {
          liveList.push(ws);
        }
      }
      if (!liveList.length) return;

      // Priority 0: If a bot is waiting and hasn't screamed recently, make it shout for help!
      const waitingBots = liveList.filter((w) => w.session.status === 'waiting');
      if (waitingBots.length > 0 && (!forced || Math.random() < 0.35)) {
        const wBot = waitingBots[Math.floor(Math.random() * waitingBots.length)];
        const scream = WAITING_SCREAMS[Math.floor(Math.random() * WAITING_SCREAMS.length)];
        this.say(wBot.id, scream, 'question', 5500, null);
        this.nextBanterAt = now + 8500;
        return;
      }

      if (liveList.length < 2) {
        const solo = liveList[0];
        this.say(
          solo.id,
          solo.session.status === 'busy'
            ? 'Một mình gánh cả công ty, gõ cháy bàn phím không ai phụ!! 🔥💦'
            : 'Cả văn phòng vắng tanh, làm ngụm trà sữa đợi sếp giao việc 😎☕',
          solo.session.status === 'busy' ? 'angry' : 'normal',
          4800
        );
        this.nextBanterAt = now + 9000;
        return;
      }

      let pair = null;
      let pool = BANTER_IDLE_CHITCHAT;
      let moodA = 'normal';
      let moodB = 'normal';
      let fileName = 'fleet.py';

      // Priority 1: Two bots with an active File Collision!
      for (const wA of liveList) {
        if ((wA.session.conflicts || []).length > 0) {
          const c = wA.session.conflicts[0];
          fileName = (c.path || '').split('/').pop() || 'code.py';
          const wB = liveList.find((w) => w.id !== wA.id && (c.peers || []).some((p) => p.includes(w.session.name)));
          if (wB) {
            pair = [wA, wB];
            pool = BANTER_CONFLICT;
            moodA = 'angry';
            moodB = 'angry';
            break;
          }
        }
      }

      // Priority 2: Coordinator (Boss) -> Subagent (Worker) edge
      if (!pair && (this.state.edges || []).length > 0) {
        const validEdges = (this.state.edges || []).filter(
          (e) => this.workstations.get(e.from)?.root.visible && this.workstations.get(e.to)?.root.visible
        );
        if (validEdges.length > 0 && Math.random() < 0.65) {
          const edge = validEdges[Math.floor(Math.random() * validEdges.length)];
          pair = [this.workstations.get(edge.from), this.workstations.get(edge.to)];
          pool = BANTER_BOSS_TO_WORKER;
          moodA = 'angry';
          moodB = 'normal';
        }
      }

      // Priority 3: One Busy bot vs One Idle bot
      if (!pair) {
        const busyBot = liveList.find((w) => w.session.status === 'busy');
        const idleBot = liveList.find((w) => w.id !== busyBot?.id && w.session.status === 'idle');
        if (busyBot && idleBot) {
          pair = [busyBot, idleBot];
          pool = BANTER_BUSY_VS_IDLE;
          moodA = 'angry';
          moodB = 'normal';
        }
      }

      // Priority 4: Cross-provider or random pair
      if (!pair) {
        const idxA = Math.floor(Math.random() * liveList.length);
        let idxB = Math.floor(Math.random() * (liveList.length - 1));
        if (idxB >= idxA) idxB++;
        pair = [liveList[idxA], liveList[idxB]];
        pool = pair[0].session.provider !== pair[1].session.provider
          ? BANTER_CROSS_PROVIDER
          : BANTER_IDLE_CHITCHAT;
        moodA = 'angry';
        moodB = 'normal';
      }

      const [wsA, wsB] = pair;
      const script = pool[Math.floor(Math.random() * pool.length)];
      const formatLine = (tpl) =>
        tpl
          .replace(/\{peer\}/g, wsB.session.name.slice(0, 18))
          .replace(/\{file\}/g, fileName);

      const line1 = formatLine(script[0]);
      const line2 = script[1]
        .replace(/\{peer\}/g, wsA.session.name.slice(0, 18))
        .replace(/\{file\}/g, fileName);

      // Step 1: Bot A turns toward Bot B and fires line 1
      this.say(wsA.id, line1, moodA, 4800, wsB.root.position);

      // Step 2: 1.8s later, Bot B turns toward Bot A and claps back with line 2!
      setTimeout(() => {
        if (!this.active) return;
        this.say(wsB.id, line2, moodB, 5200, wsA.root.position);
      }, 1800);

      this.nextBanterAt = now + 9500 + Math.random() * 4500;
    }

    // ---- Render Urgent Question / Waiting Popup Toast Dock ----------------

    _renderPopupDock(sessions) {
      const urgent = (sessions || []).filter(
        (s) => !s.exited && (s.status === 'waiting' || (s.conflicts || []).length > 0)
      );
      if (!urgent.length) {
        this.popupDock.replaceChildren();
        return;
      }

      const cards = [];
      for (const s of urgent.slice(0, 4)) {
        const prov = PROVIDER_COLORS[s.provider || 'claude'] || PROVIDER_COLORS.claude;
        const isWaiting = s.status === 'waiting';
        const toast = document.createElement('div');
        toast.className = 'office3d-toast ' + (isWaiting ? 'toast-waiting' : 'toast-conflict');

        const title = isWaiting
          ? `🚨 ${this._escape(s.name)} đang có câu hỏi / chờ duyệt!`
          : `⚠ ${this._escape(s.name)} đang đụng độ sửa file!`;

        const detail = isWaiting
          ? (s.blockedOn ? `Lý do: ${this._escape(s.blockedOn)}` : 'Đang chờ bạn xác nhận để chạy tiếp')
          : `Trùng ${(s.conflicts || []).length} file với ${(s.conflicts[0]?.peers || []).join(', ')}`;

        toast.innerHTML = `
          <div class="toast-head">
            <span class="provider-badge ${s.provider || 'claude'}">${prov.badge}</span>
            <span class="toast-title">${title}</span>
          </div>
          <div class="toast-body">${detail}</div>
          <div class="toast-actions">
            <button type="button" class="toast-btn focus-btn">🎥 Zoom tới bàn</button>
            <button type="button" class="toast-btn inspect-btn">🔍 Xem câu hỏi</button>
            ${s.tmux ? `<button type="button" class="toast-btn jump-btn">Nhảy tới pane ↗</button>` : ''}
          </div>
        `;

        toast.querySelector('.focus-btn').addEventListener('click', () => {
          this.focusOnSession(s.id);
          this.say(s.id, 'Sếp đây rồi!! Duyệt giúp em phát sếp ơi!! 😭🙏', 'question', 5000);
        });
        toast.querySelector('.inspect-btn').addEventListener('click', () => {
          this.focusOnSession(s.id);
          if (this.onSelectSession) this.onSelectSession(s.id);
        });
        const jBtn = toast.querySelector('.jump-btn');
        if (jBtn && this.onJumpSession) {
          jBtn.addEventListener('click', () => this.onJumpSession(s.id, jBtn));
        }
        cards.push(toast);
      }
      this.popupDock.replaceChildren(...cards);
    }

    _updateWorkstationVisuals(entry, session, isSelected) {
      entry.session = session;
      entry.isSelected = isSelected;
      const prov = PROVIDER_COLORS[session.provider || 'claude'] || PROVIDER_COLORS.claude;
      const status = session.status || 'idle';
      const isExited = Boolean(session.exited || status === 'exited');

      if (status === 'busy') {
        entry.mScreen.material.color.setHex(0x34D399);
        entry.sScreen.material.color.setHex(0x38BDF8);
        entry.ringMat.opacity = 1.0;
        entry.sirenGroup.visible = false;
        entry.sirenLight.intensity = 0;
      } else if (status === 'waiting') {
        entry.mScreen.material.color.setHex(0xEF4444);
        entry.sScreen.material.color.setHex(0xF87171);
        entry.ringMat.opacity = 1.0;
        entry.sirenGroup.visible = true;
      } else {
        entry.mScreen.material.color.setHex(0x1E293B);
        entry.sScreen.material.color.setHex(0x1E293B);
        entry.ringMat.opacity = isExited ? 0.35 : 0.92;
        entry.sirenGroup.visible = false;
        entry.sirenLight.intensity = 0;
      }

      paintTokenRing(entry.tokenRingCanvas, session, isSelected, 0);

      const statusLabelMap = {
        busy: '● Đang cày',
        waiting: '▲ Chờ duyệt!',
        shell: '◆ Shell',
        idle: '○ Đang chill',
        exited: '◌ Đã đóng',
      };
      const usedTok = Number(session.context?.used || 0);
      const winTok = Number(session.context?.window || 1000000) || 1000000;
      const outTok = Number(session.tokens?.output || 0);
      const rawPct = Math.min(100, Math.max(0, Number(session.context?.percent || (winTok > 0 ? (usedTok / winTok) * 100 : 0))));
      const pctDisplay = rawPct >= 10 ? Math.round(rawPct) : Number(rawPct.toFixed(1));
      const ringCirc = 44; // 2 * PI * r (r=7)
      const visualPct = usedTok > 0 ? Math.max(6, rawPct) : 0;
      const dashOffset = (ringCirc * (1 - visualPct / 100)).toFixed(1);
      const ringTone = rawPct >= 85 ? 'crit' : (rawPct >= 55 ? 'warn' : 'ok');

      const conflictCount = (session.conflicts || []).length;
      const branch = session.git?.branch ? `⎇ ${session.git.branch}${session.git.dirty ? '*' : ''}` : '';

      const el = entry.labelEl;
      el.className = [
        'office3d-tag',
        `status-${status}`,
        isSelected ? 'selected' : '',
        isExited ? 'exited' : '',
      ].filter(Boolean).join(' ');

      el.innerHTML = `
        <div class="tag-top">
          <span class="provider-badge ${session.provider || 'claude'}">${prov.badge}</span>
          <span class="tag-name">${this._escape(session.name)}</span>
          <span class="tag-status ${status}">${statusLabelMap[status] || status}</span>
        </div>
        <div class="tag-meta">
          <span class="tag-token-pill ${ringTone}" title="Context Token: ${usedTok.toLocaleString()} / ${winTok.toLocaleString()} (${pctDisplay}%) · Output: ${outTok.toLocaleString()} tok">
            <svg class="tag-ring-svg" viewBox="0 0 18 18" aria-hidden="true">
              <circle class="ring-track" cx="9" cy="9" r="7"></circle>
              <circle class="ring-fill" cx="9" cy="9" r="7" stroke-dasharray="${ringCirc}" stroke-dashoffset="${dashOffset}"></circle>
            </svg>
            <b>${pctDisplay}%</b>
            <span class="tag-tok-nums">${formatTokenCount(usedTok)}/${formatTokenCount(winTok)}</span>
          </span>
          ${outTok > 0 ? `<span class="tag-out-tok" title="Tổng Token Output đã sinh ra">Out ${formatTokenCount(outTok)}</span>` : ''}
          ${branch ? `<span class="tag-branch">${this._escape(branch)}</span>` : ''}
          ${session.coordinates ? `<span class="tag-role">👑 Sếp</span>` : ''}
        </div>
        ${conflictCount > 0 ? `<div class="tag-conflict">⚠ Trùng ${conflictCount} file</div>` : ''}
        ${status === 'waiting' && session.tmux ? `<button type="button" class="tag-jump-btn">Nhảy tới pane ↗</button>` : ''}
      `;

      const jumpBtn = el.querySelector('.tag-jump-btn');
      if (jumpBtn && this.onJumpSession) {
        jumpBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.onJumpSession(session.id, jumpBtn);
        });
      }
    }

    _escape(str) {
      return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    syncState(state, selection) {
      this.state = state;
      this.selection = selection;
      if (!this.active || !state) return;

      this._renderPopupDock(state.sessions || []);

      const byId = new Map((state.sessions || []).map((s) => [s.id, s]));
      const visibleIds = new Set();
      for (const s of state.sessions || []) {
        if (typeof isCardVisible === 'function' ? isCardVisible(s) : true) {
          visibleIds.add(s.id);
        }
      }

      for (const [, r] of this.roomGroups) {
        this.worldRoot.remove(r.group);
        r.bannerEl.remove();
      }
      this.roomGroups.clear();

      for (const [, c] of this.conduits) {
        this.worldRoot.remove(c.group);
        c.badgeEl.remove();
      }
      this.conduits.clear();

      const seenSessions = new Set();
      const DESK_SPACING_X = 7.6;
      const TIER_SPACING_Z = 8.4;
      const ROOM_GAP_Z = 7.2;

      let currentRoomZ = 0;
      const groups = state.groups || [];

      for (const group of groups) {
        const tierMap = new Map();
        let maxCols = 1;
        for (const sid of group.sessions) {
          const s = byId.get(sid);
          if (!s) continue;
          const t = s.tier || 0;
          if (!tierMap.has(t)) tierMap.set(t, []);
          tierMap.get(t).push(s);
          maxCols = Math.max(maxCols, tierMap.get(t).length);
        }

        const numTiers = Math.max(1, group.tiers || 1);
        const roomWidth = Math.max(15, maxCols * DESK_SPACING_X + 6.5);
        const roomDepth = Math.max(11.5, numTiers * TIER_SPACING_Z + 5.5);

        const roomCenterZ = currentRoomZ + roomDepth / 2;
        const roomGroup = new THREE.Group();
        roomGroup.position.set(0, 0, roomCenterZ);
        this.worldRoot.add(roomGroup);

        const floorMesh = new THREE.Mesh(
          new THREE.BoxGeometry(roomWidth, 0.24, roomDepth),
          new THREE.MeshStandardMaterial({ color: 0x111726, roughness: 0.78, metalness: 0.15 })
        );
        floorMesh.position.y = -0.12;
        floorMesh.receiveShadow = true;
        roomGroup.add(floorMesh);

        const borderColor = group.waiting > 0 ? 0xEF4444 : 0x38BDF8;
        const wallMat = new THREE.MeshStandardMaterial({
          color: 0x1E293B,
          roughness: 0.3,
          metalness: 0.5,
          transparent: true,
          opacity: 0.55,
        });
        const backWall = new THREE.Mesh(new THREE.BoxGeometry(roomWidth, 1.8, 0.18), wallMat);
        backWall.position.set(0, 0.9, -roomDepth / 2 + 0.09);
        const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.3, roomDepth), wallMat);
        leftWall.position.set(-roomWidth / 2 + 0.09, 0.65, 0);
        const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.3, roomDepth), wallMat);
        rightWall.position.set(roomWidth / 2 - 0.09, 0.65, 0);
        roomGroup.add(backWall, leftWall, rightWall);

        const railMesh = new THREE.Mesh(
          new THREE.BoxGeometry(roomWidth, 0.08, 0.22),
          new THREE.MeshBasicMaterial({ color: borderColor })
        );
        railMesh.position.set(0, 1.82, -roomDepth / 2 + 0.09);
        roomGroup.add(railMesh);

        this._addRoomProps(roomGroup, roomWidth, roomDepth);

        const bannerEl = document.createElement('div');
        bannerEl.className = 'office3d-room-banner';
        bannerEl.innerHTML = `
          <span class="room-icon">🏢</span>
          <b>PHÒNG BAN: ${this._escape(group.label.toUpperCase())}</b>
          <span class="room-count">${group.sessions.length} nhân sự</span>
          ${group.waiting > 0 ? `<span class="room-wait">▲ ${group.waiting} chờ duyệt</span>` : ''}
        `;
        this.labelLayer.append(bannerEl);

        this.roomGroups.set(group.key, {
          group: roomGroup,
          bannerEl,
          bannerPos: new THREE.Vector3(0, 2.5, currentRoomZ + 0.3),
        });

        const sortedTiers = Array.from(tierMap.keys()).sort((a, b) => a - b);
        sortedTiers.forEach((tierIdx, rowIdx) => {
          const rowSessions = tierMap.get(tierIdx);
          const zWorld = currentRoomZ + 3.9 + rowIdx * TIER_SPACING_Z;
          const count = rowSessions.length;
          rowSessions.forEach((s, colIdx) => {
            const xWorld = (colIdx - (count - 1) / 2) * DESK_SPACING_X;
            seenSessions.add(s.id);

            let ws = this.workstations.get(s.id);
            if (!ws) {
              ws = this._createWorkstationMesh(s);
              this.workstations.set(s.id, ws);
              this.worldRoot.add(ws.root);
            }
            ws.root.position.set(xWorld, 0, zWorld);
            ws.root.visible = visibleIds.has(s.id);
            ws.labelEl.style.display = visibleIds.has(s.id) ? '' : 'none';
            if (!visibleIds.has(s.id)) ws.bubbleEl.classList.add('hidden');

            const isSelected = Boolean(selection && selection.kind === 'session' && selection.id === s.id);
            this._updateWorkstationVisuals(ws, s, isSelected);
          });
        });

        currentRoomZ += roomDepth + ROOM_GAP_Z;
      }

      for (const [sid, ws] of this.workstations) {
        if (!seenSessions.has(sid)) {
          this.worldRoot.remove(ws.root);
          ws.labelEl.remove();
          ws.bubbleEl.remove();
          this.workstations.delete(sid);
        }
      }

      // Build 3D Floor Conduits for Edges (Glow ONLY when target is busy/waiting)
      for (const edge of state.edges || []) {
        const wsFrom = this.workstations.get(edge.from);
        const wsTo = this.workstations.get(edge.to);
        if (!wsFrom || !wsTo || !wsFrom.root.visible || !wsTo.root.visible) continue;

        const dstSession = byId.get(edge.to);
        const isActiveDelegation = Boolean(
          dstSession && !dstSession.exited && (dstSession.status === 'busy' || dstSession.status === 'waiting')
        );
        const isEdgeSelected = Boolean(
          selection && selection.kind === 'edge' && selection.id === edge.from && selection.peer === edge.to
        );

        const p1 = wsFrom.root.position.clone().add(new THREE.Vector3(0, 0.12, 1.2));
        const p2 = wsTo.root.position.clone().add(new THREE.Vector3(0, 0.12, -1.35));
        const mid = p1.clone().lerp(p2, 0.5);
        const ctrl1 = new THREE.Vector3(p1.x, 0.12, mid.z);
        const ctrl2 = new THREE.Vector3(p2.x, 0.12, mid.z);
        const curve = new THREE.CubicBezierCurve3(p1, ctrl1, ctrl2, p2);

        const tubeRadius = isActiveDelegation || isEdgeSelected ? 0.09 : 0.045;
        const tubeGeo = new THREE.TubeGeometry(curve, 32, tubeRadius, 10, false);
        const tubeColor = isEdgeSelected
          ? 0x38BDF8
          : (isActiveDelegation ? (dstSession.status === 'waiting' ? 0xEF4444 : 0x34D399) : 0x334155);
        const tubeMat = new THREE.MeshBasicMaterial({
          color: tubeColor,
          transparent: true,
          opacity: isActiveDelegation || isEdgeSelected ? 0.92 : 0.45,
        });
        const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
        tubeMesh.userData.edge = { from: edge.from, to: edge.to };

        const conduitGroup = new THREE.Group();
        conduitGroup.add(tubeMesh);

        const orbs = [];
        if (isActiveDelegation) {
          const orbGeo = new THREE.SphereGeometry(0.18, 16, 16);
          const orbMat = new THREE.MeshBasicMaterial({
            color: dstSession.status === 'waiting' ? 0xFCA5A5 : 0x6EE7B7,
          });
          for (let i = 0; i < 3; i++) {
            const orb = new THREE.Mesh(orbGeo, orbMat);
            orb.userData.edge = { from: edge.from, to: edge.to };
            conduitGroup.add(orb);
            orbs.push({ mesh: orb, offset: i / 3 });
          }
        }

        this.worldRoot.add(conduitGroup);

        const badgeEl = document.createElement('button');
        badgeEl.type = 'button';
        badgeEl.className = [
          'office3d-wire-badge',
          isActiveDelegation ? 'active-flow' : '',
          isEdgeSelected ? 'selected' : '',
        ].filter(Boolean).join(' ');
        badgeEl.textContent = `${edge.count} tin`;
        badgeEl.title = 'Bấm để xem lịch sử trao đổi giữa hai phiên';
        badgeEl.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (this.onSelectEdge) this.onSelectEdge(edge.from, edge.to);
        });
        this.labelLayer.append(badgeEl);

        this.conduits.set(`${edge.from}->${edge.to}`, {
          group: conduitGroup,
          curve,
          orbs,
          midPos: curve.getPoint(0.5).add(new THREE.Vector3(0, 0.35, 0)),
          badgeEl,
        });
      }

      this.pickables = [];
      for (const [, ws] of this.workstations) {
        if (ws.root.visible) this.pickables.push(ws.root);
      }
      for (const [, c] of this.conduits) {
        this.pickables.push(c.group);
      }
    }

    _addRoomProps(roomGroup, roomWidth, roomDepth) {
      const rack = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 2.3, 0.9),
        new THREE.MeshStandardMaterial({ color: 0x0F172A, roughness: 0.4, metalness: 0.6 })
      );
      rack.position.set(-roomWidth / 2 + 1.1, 1.15, -roomDepth / 2 + 0.85);
      rack.castShadow = true;
      const led1 = new THREE.Mesh(
        new THREE.BoxGeometry(0.75, 0.08, 0.05),
        new THREE.MeshBasicMaterial({ color: 0x38BDF8 })
      );
      led1.position.set(0, 0.6, 0.46);
      const led2 = new THREE.Mesh(
        new THREE.BoxGeometry(0.75, 0.08, 0.05),
        new THREE.MeshBasicMaterial({ color: 0x34D399 })
      );
      led2.position.set(0, 0.25, 0.46);
      rack.add(led1, led2);
      roomGroup.add(rack);

      const pot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.38, 0.28, 0.55, 16),
        new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 })
      );
      pot.position.set(roomWidth / 2 - 1.1, 0.28, -roomDepth / 2 + 0.85);
      const foliage = new THREE.Mesh(
        new THREE.SphereGeometry(0.62, 18, 16),
        new THREE.MeshStandardMaterial({ color: 0x10B981, roughness: 0.7 })
      );
      foliage.position.y = 0.68;
      foliage.castShadow = true;
      pot.add(foliage);
      roomGroup.add(pot);
    }

    // ---- Real-Time 60fps Animation, Facial Expressions & Banter Loop -------

    _animate() {
      requestAnimationFrame(this._animate);
      if (!this.active) return;

      const t = this.clock.getElapsedTime();
      const now = performance.now();

      if (now >= this.nextBanterAt) {
        this.triggerBanter(false);
      }

      for (const [, ws] of this.workstations) {
        if (!ws.root.visible) continue;
        const status = ws.session.status || 'idle';
        const phase = t + ws.phaseOffset;
        const isSpeaking = now < ws.speechUntil;
        const hasConflicts = (ws.session.conflicts || []).length > 0;
        const blink = Math.sin(phase * 1.9) > 0.96;

        if (!isSpeaking && !ws.bubbleEl.classList.contains('hidden')) {
          ws.bubbleEl.classList.add('hidden');
          ws.lookAtWorld = null;
        }

        // Determine Facial Expression Mode
        let faceMode = 'idle';
        if (status === 'waiting' || (isSpeaking && ws.speechMood === 'question')) {
          faceMode = 'waiting';
        } else if (hasConflicts || (isSpeaking && ws.speechMood === 'angry')) {
          faceMode = 'angry';
        } else if (status === 'busy') {
          faceMode = 'busy';
        }
        paintFace(ws.faceCanvas, faceMode, blink, phase);
        paintTokenRing(ws.tokenRingCanvas, ws.session, Boolean(ws.isSelected), Math.floor(t * 10));

        // Pose & Limb Animation
        if (isSpeaking && ws.lookAtWorld) {
          // Turn swivel chair & head toward the peer they are arguing/talking with!
          const dx = ws.lookAtWorld.x - ws.root.position.x;
          const dz = ws.lookAtWorld.z - ws.root.position.z;
          const targetYaw = Math.atan2(dx, dz) + Math.PI;
          ws.swivelUnit.rotation.y = Math.sin(phase * 3) * 0.15;
          ws.headGroup.rotation.y = Math.max(-0.85, Math.min(0.85, targetYaw * 0.35));
          ws.headGroup.rotation.x = -0.08 + Math.sin(phase * 12) * 0.08;
          ws.torsoGroup.rotation.x = 0.08;
          // Point / wave right arm dramatically while trash-talking!
          ws.rightArmPivot.rotation.x = -1.35 + Math.sin(phase * 14) * 0.35;
          ws.leftArmPivot.rotation.x = -0.4 + Math.cos(phase * 10) * 0.2;
          ws.charGroup.position.y = 0.96 + Math.abs(Math.sin(phase * 9)) * 0.08;
        } else if (status === 'busy') {
          // Focused rapid coding
          ws.swivelUnit.rotation.y = 0;
          ws.charGroup.position.y = 0.96;
          ws.torsoGroup.rotation.x = 0.16 + Math.sin(phase * 9) * 0.035;
          ws.headGroup.rotation.y = Math.sin(phase * 4) * 0.18;
          ws.headGroup.rotation.x = 0.08 + Math.sin(phase * 8) * 0.04;
          ws.leftArmPivot.rotation.x = Math.sin(phase * 20) * 0.32;
          ws.rightArmPivot.rotation.x = -Math.sin(phase * 20) * 0.32;
          ws.leftArmPivot.rotation.z = 0;
          ws.rightArmPivot.rotation.z = 0;
        } else if (status === 'waiting') {
          // Jumping up & waving BOTH arms for help!
          ws.swivelUnit.rotation.y = Math.sin(phase * 4) * 0.25;
          ws.charGroup.position.y = 0.96 + Math.abs(Math.sin(phase * 8)) * 0.18;
          ws.torsoGroup.rotation.x = -0.06;
          ws.headGroup.rotation.y = Math.sin(phase * 6) * 0.3;
          ws.headGroup.rotation.x = -0.18;
          ws.leftArmPivot.rotation.x = -2.3 + Math.sin(phase * 12) * 0.35;
          ws.rightArmPivot.rotation.x = -2.3 - Math.sin(phase * 12) * 0.35;
          ws.leftArmPivot.rotation.z = 0.25;
          ws.rightArmPivot.rotation.z = -0.25;
          ws.sirenLight.intensity = 1.8 + Math.sin(phase * 15) * 1.4;
        } else {
          // Chill Idle: Swiveling gently in gaming chair with sunglasses 😎
          ws.swivelUnit.rotation.y = Math.sin(phase * 1.1) * 0.38;
          ws.charGroup.position.y = 0.96;
          ws.torsoGroup.rotation.x = -0.14 + Math.sin(phase * 1.8) * 0.025;
          ws.headGroup.rotation.y = Math.sin(phase * 0.9) * 0.18;
          ws.headGroup.rotation.x = Math.sin(phase * 1.8) * 0.04;
          ws.leftArmPivot.rotation.x = 0.18;
          ws.rightArmPivot.rotation.x = 0.18;
          ws.leftArmPivot.rotation.z = 0;
          ws.rightArmPivot.rotation.z = 0;
        }

        const headWorld = ws.root.position.clone().add(new THREE.Vector3(0, 2.9, 0));
        this._projectToLabel(headWorld, ws.labelEl);

        if (isSpeaking) {
          const bubbleWorld = ws.root.position.clone().add(new THREE.Vector3(0, 3.85, 0));
          this._projectToLabel(bubbleWorld, ws.bubbleEl);
        }
      }

      for (const [, c] of this.conduits) {
        for (const orb of c.orbs) {
          const u = (t * 0.58 + orb.offset) % 1.0;
          const pos = c.curve.getPoint(u);
          orb.mesh.position.copy(pos);
        }
        this._projectToLabel(c.midPos, c.badgeEl);
      }

      for (const [, r] of this.roomGroups) {
        this._projectToLabel(r.bannerPos, r.bannerEl);
      }

      this.renderer.render(this.scene, this.camera);
    }

    _projectToLabel(worldVec, domEl) {
      const v = worldVec.clone().project(this.camera);
      if (v.z > 1) {
        domEl.style.opacity = '0';
        domEl.style.pointerEvents = 'none';
        return;
      }
      const rect = this.renderer.domElement.getBoundingClientRect();
      const x = (v.x * 0.5 + 0.5) * rect.width;
      const y = (-v.y * 0.5 + 0.5) * rect.height;
      domEl.style.opacity = '';
      domEl.style.pointerEvents = '';
      domEl.style.transform = `translate(-50%, -100%) translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }
  }

  window.Office3DScene = Office3DScene;
})();
