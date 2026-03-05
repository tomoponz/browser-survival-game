/* 爽快サバイバー：縦切り（移動 + 自動照準 + 敵スポーン + 破壊演出 + レベルアップ + 時間停止） */

(() => {
  const W = Math.max(960, window.innerWidth);
  const H = Math.max(540, window.innerHeight);

  const cfg = {
    type: Phaser.AUTO,
    parent: "game",
    width: W,
    height: H,
    backgroundColor: "#0b0f14",
    physics: {
      default: "arcade",
      arcade: { debug: false }
    },
    scene: { create, update }
  };

  new Phaser.Game(cfg);

  // ---- 状態（調整の中心） ----
  const S = {
    hpMax: 100, hp: 100,
    level: 1,
    xp: 0, xpNeed: 12,
    score: 0,

    // 爽快感の核パラメータ
    moveSpeed: 320,
    fireIntervalMs: 120,
    bulletsPerShot: 1,
    damage: 14,
    bulletSpeed: 760,
    knock: 220,

    // “時間停止”ゲージ（敵だけ遅くする）
    freezeMax: 1.0,
    freeze: 1.0,
    freezeDrain: 0.55,    // 秒あたり
    freezeRegen: 0.25,    // 秒あたり
    freezeFactor: 0.18,   // 発動中の敵速度倍率（小さいほど止まる）

    magnet: 140,

    paused: false,
    gameOver: false,
    choices: null
  };

  // ---- 参照 ----
  let scene, cam;
  let player, cursors, keys;
  let bullets, enemies, gems;
  let fireTimer, spawnTimer;
  let uiText, uiBars;
  let pSpark, pDust;
  let tStart = 0;

  function create() {
    scene = this;
    cam = this.cameras.main;
    tStart = this.time.now;

    // --- テクスチャをコードで生成（素材0で見た目を作る） ---
    makeTexture("player", 16, g => {
      g.fillStyle(0x1fe4ff, 1).fillCircle(16, 16, 12);
      g.lineStyle(2, 0xffffff, 0.7).strokeCircle(16, 16, 12);
    });
    makeTexture("bullet", 12, g => {
      g.fillStyle(0xffd200, 1).fillCircle(12, 12, 5);
      g.fillStyle(0xffffff, 0.4).fillCircle(10, 10, 2);
    });
    makeTexture("enemy", 18, g => {
      g.fillStyle(0xff4d6d, 1).fillCircle(18, 18, 13);
      g.lineStyle(2, 0x13060a, 0.9).strokeCircle(18, 18, 13);
      g.fillStyle(0x13060a, 0.8).fillCircle(13, 14, 2).fillCircle(23, 14, 2);
    });
    makeTexture("gem", 16, g => {
      g.fillStyle(0x5cff6a, 1)
        .fillTriangle(16, 4, 28, 16, 16, 28)
        .fillTriangle(16, 4, 4, 16, 16, 28);
      g.lineStyle(2, 0xffffff, 0.35).strokeTriangle(16, 4, 28, 16, 16, 28);
      g.lineStyle(2, 0xffffff, 0.35).strokeTriangle(16, 4, 4, 16, 16, 28);
    });
    makeTexture("spark", 6, g => g.fillStyle(0xffffff, 1).fillCircle(6, 6, 3));
    makeTexture("dust", 8, g => g.fillStyle(0xffd200, 1).fillCircle(8, 8, 4));

    // --- プレイヤー ---
    player = this.physics.add.image(W / 2, H / 2, "player");
    player.setDamping(true);
    player.setDrag(0.0015);
    player.setMaxVelocity(520);
    player.setCollideWorldBounds(true);
    player.invuln = 0;

    // --- 入力 ---
    cursors = this.input.keyboard.createCursorKeys();
    keys = this.input.keyboard.addKeys({
      W: Phaser.Input.Keyboard.KeyCodes.W,
      A: Phaser.Input.Keyboard.KeyCodes.A,
      S: Phaser.Input.Keyboard.KeyCodes.S,
      D: Phaser.Input.Keyboard.KeyCodes.D,
      SHIFT: Phaser.Input.Keyboard.KeyCodes.SHIFT,
      ONE: Phaser.Input.Keyboard.KeyCodes.ONE,
      TWO: Phaser.Input.Keyboard.KeyCodes.TWO,
      THREE: Phaser.Input.Keyboard.KeyCodes.THREE,
      R: Phaser.Input.Keyboard.KeyCodes.R
    });

    // --- グループ（簡易プール） ---
    bullets = this.physics.add.group({ defaultKey: "bullet", maxSize: 600 });
    enemies = this.physics.add.group({ defaultKey: "enemy", maxSize: 260 });
    gems = this.physics.add.group({ defaultKey: "gem", maxSize: 600 });

    // --- パーティクル（爽快感の主成分） ---
    pSpark = this.add.particles(0, 0, "spark", {
      lifespan: { min: 120, max: 260 },
      speed: { min: 70, max: 360 },
      scale: { start: 1.0, end: 0 },
      quantity: 0,
      emitting: false
    });
    pDust = this.add.particles(0, 0, "dust", {
      lifespan: { min: 120, max: 240 },
      speed: { min: 40, max: 260 },
      scale: { start: 0.9, end: 0 },
      quantity: 0,
      emitting: false
    });

    // --- 当たり判定 ---
    this.physics.add.overlap(bullets, enemies, onBulletHit, null, this);
    this.physics.add.overlap(player, enemies, onPlayerHit, null, this);
    this.physics.add.overlap(player, gems, onGem, null, this);

    // --- 自動攻撃 / 敵スポーン ---
    fireTimer = this.time.addEvent({ delay: S.fireIntervalMs, loop: true, callback: fire });
    spawnTimer = this.time.addEvent({ delay: 260, loop: true, callback: spawnEnemy });

    // --- UI ---
    uiText = this.add.text(12, 10, "", {
      fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
      fontSize: "14px",
      color: "#cfe8ff"
    }).setDepth(9999);

    uiBars = this.add.graphics().setDepth(9999);

    // クリックでフォーカス確保（キー入力の取りこぼし対策）
    this.input.on("pointerdown", () => this.game.canvas.focus());

    drawUI();
  }

  function update(_, dtMs) {
    const dt = dtMs / 1000;

    if (S.gameOver) {
      if (Phaser.Input.Keyboard.JustDown(keys.R)) restart();
      return;
    }

    // レベルアップ選択中は「戦闘停止」してUIだけ動かす
    if (S.paused) {
      handleChoiceInput();
      return;
    }

    // --- 移動（滑らかさ＝クオリティの土台） ---
    let ix = 0, iy = 0;
    if (cursors.left.isDown || keys.A.isDown) ix -= 1;
    if (cursors.right.isDown || keys.D.isDown) ix += 1;
    if (cursors.up.isDown || keys.W.isDown) iy -= 1;
    if (cursors.down.isDown || keys.S.isDown) iy += 1;

    const len = Math.hypot(ix, iy) || 1;
    ix /= len; iy /= len;

    const spd = S.moveSpeed;
    player.setAcceleration(ix * spd * 3.2, iy * spd * 3.2);

    // --- 時間停止（敵だけ遅くする） ---
    const freezeWant = keys.SHIFT.isDown && S.freeze > 0.02;
    if (freezeWant) {
      S.freeze = Math.max(0, S.freeze - S.freezeDrain * dt);
    } else {
      S.freeze = Math.min(S.freezeMax, S.freeze + S.freezeRegen * dt);
    }
    const enemySpeedMul = freezeWant ? S.freezeFactor : 1.0;

    // --- プレイヤー無敵点滅 ---
    if (player.invuln > 0) {
      player.invuln -= dt;
      player.setAlpha((Math.floor(player.invuln * 20) % 2) ? 0.35 : 1.0);
    } else {
      player.setAlpha(1.0);
    }

    // --- 弾の寿命 / 画面外処理 ---
    bullets.children.iterate(b => {
      if (!b || !b.active) return;
      b.life -= dtMs;
      if (b.life <= 0) killObj(b);
    });

    // --- 敵AI：プレイヤー追尾 + ノックバック ---
    const t = (scene.time.now - tStart) / 1000;
    enemies.children.iterate(e => {
      if (!e || !e.active) return;

      // ノックバック減衰
      e.kbx *= 0.86;
      e.kby *= 0.86;

      const dx = player.x - e.x;
      const dy = player.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d, uy = dy / d;

      const base = e.speed * enemySpeedMul;
      e.setVelocity(ux * base + e.kbx, uy * base + e.kby);

      // 低HP点滅（視認性）
      if (e.hp < e.hpMax * 0.35) e.setAlpha(0.7 + 0.3 * Math.sin(scene.time.now * 0.02));
      else e.setAlpha(1.0);
    });

    // --- gem吸引 ---
    gems.children.iterate(g => {
      if (!g || !g.active) return;
      const dx = player.x - g.x;
      const dy = player.y - g.y;
      const d = Math.hypot(dx, dy);

      if (d < S.magnet) {
        const ux = dx / (d || 1), uy = dy / (d || 1);
        g.vx = (g.vx || 0) * 0.86 + ux * 620 * dt;
        g.vy = (g.vy || 0) * 0.86 + uy * 620 * dt;
        g.x += g.vx; g.y += g.vy;
      } else {
        g.y += 10 * dt; // ほんの少し漂う
      }

      if (g.x < -40 || g.x > W + 40 || g.y < -40 || g.y > H + 40) killObj(g);
    });

    // --- UI ---
    if (scene.time.now % 120 < dtMs) drawUI();
  }

  // ------------------ システム ------------------

  function fire() {
    if (S.paused || S.gameOver) return;

    const targets = enemies.getChildren().filter(e => e.active);
    if (targets.length === 0) return;

    // 最寄りの敵へ自動照準（爽快感＝迷わせない）
    let best = null, bestD = Infinity;
    for (const e of targets) {
      const d = (e.x - player.x) ** 2 + (e.y - player.y) ** 2;
      if (d < bestD) { bestD = d; best = e; }
    }
    if (!best) return;

    const ang0 = Phaser.Math.Angle.Between(player.x, player.y, best.x, best.y);

    for (let i = 0; i < S.bulletsPerShot; i++) {
      const spread = (S.bulletsPerShot === 1) ? 0 : (i - (S.bulletsPerShot - 1) / 2) * 0.12;
      const ang = ang0 + spread;

      const b = bullets.get(player.x, player.y, "bullet");
      if (!b) return;
      b.setActive(true).setVisible(true);
      b.body.enable = true;
      b.life = 1100;

      const vx = Math.cos(ang) * S.bulletSpeed;
      const vy = Math.sin(ang) * S.bulletSpeed;
      b.setVelocity(vx, vy);

      // 弾のトレイル（軽くても“それっぽく”なる）
      pDust.emitParticleAt(b.x, b.y, 1);
    }
  }

  function spawnEnemy() {
    if (S.paused || S.gameOver) return;
    if (enemies.countActive(true) >= 240) return; // 重くなりすぎ防止

    const t = (scene.time.now - tStart) / 1000;
    const hp = Math.floor(20 + t * 1.7);
    const spd = Math.min(240, 90 + t * 3.0);

    // 画面外周からスポーン
    const side = Phaser.Math.Between(0, 3);
    let x, y;
    const pad = 30;
    if (side === 0) { x = -pad; y = Phaser.Math.Between(0, H); }
    if (side === 1) { x = W + pad; y = Phaser.Math.Between(0, H); }
    if (side === 2) { x = Phaser.Math.Between(0, W); y = -pad; }
    if (side === 3) { x = Phaser.Math.Between(0, W); y = H + pad; }

    const e = enemies.get(x, y, "enemy");
    if (!e) return;
    e.setActive(true).setVisible(true);
    e.body.enable = true;

    e.hpMax = hp;
    e.hp = hp;
    e.speed = spd;
    e.kbx = 0; e.kby = 0;
  }

  function onBulletHit(b, e) {
    if (!b.active || !e.active) return;
    killObj(b);

    // ダメージ
    e.hp -= S.damage;

    // ノックバック（爽快感の物理）
    const ang = Phaser.Math.Angle.Between(player.x, player.y, e.x, e.y);
    e.kbx += Math.cos(ang) * S.knock;
    e.kby += Math.sin(ang) * S.knock;

    // 演出：火花 + 微シェイク + 超短ヒットストップ
    pSpark.emitParticleAt(e.x, e.y, 6);
    cam.shake(40, 0.004);

    // ヒットストップ（短く。やりすぎると逆に重い）
    scene.physics.world.timeScale = 0.0001;
    scene.time.delayedCall(28, () => (scene.physics.world.timeScale = 1));

    if (e.hp <= 0) {
      killEnemy(e);
    }
  }

  function killEnemy(e) {
    S.score += 1;
    pSpark.emitParticleAt(e.x, e.y, 14);
    cam.shake(70, 0.008);

    // gemドロップ（成長ループ）
    const n = 1 + (Math.random() < 0.2 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const g = gems.get(e.x + Phaser.Math.Between(-6, 6), e.y + Phaser.Math.Between(-6, 6), "gem");
      if (!g) continue;
      g.setActive(true).setVisible(true);
      g.body.enable = false; // gemは物理不要（軽くする）
      g.vx = Phaser.Math.Between(-40, 40);
      g.vy = Phaser.Math.Between(-40, 40);
    }

    killObj(e);
    maybeLevelUp();
  }

  function onPlayerHit(p, e) {
    if (S.gameOver || S.paused) return;
    if (player.invuln > 0) return;

    // 被弾（爽快ゲームでも“被弾は痛い”のが締まる）
    S.hp -= 14;
    player.invuln = 0.65;
    cam.shake(120, 0.013);
    pSpark.emitParticleAt(player.x, player.y, 10);

    if (S.hp <= 0) {
      S.hp = 0;
      gameOver();
    }
    drawUI();
  }

  function onGem(p, g) {
    if (!g.active) return;
    killObj(g);
    S.xp += 1;

    if (S.xp >= S.xpNeed) {
      S.xp -= S.xpNeed;
      S.level += 1;
      S.xpNeed = Math.floor(S.xpNeed * 1.35 + 6);
      openChoice();
    }
    drawUI();
  }

  function maybeLevelUp() {
    // 倒した数で微XPを足す（“倒してる感”増）
    if (Math.random() < 0.06) {
      S.xp += 1;
      if (S.xp >= S.xpNeed) {
        S.xp -= S.xpNeed;
        S.level += 1;
        S.xpNeed = Math.floor(S.xpNeed * 1.35 + 6);
        openChoice();
      }
      drawUI();
    }
  }

  function openChoice() {
    S.paused = true;

    const pool = [
      { name: "連射 +20%", apply: () => { S.fireIntervalMs = Math.max(50, Math.floor(S.fireIntervalMs * 0.82)); resetFireTimer(); } },
      { name: "威力 +25%", apply: () => { S.damage = Math.floor(S.damage * 1.25); } },
      { name: "弾速 +25%", apply: () => { S.bulletSpeed = Math.floor(S.bulletSpeed * 1.25); } },
      { name: "弾数 +1", apply: () => { S.bulletsPerShot = Math.min(7, S.bulletsPerShot + 1); } },
      { name: "移動 +15%", apply: () => { S.moveSpeed = Math.floor(S.moveSpeed * 1.15); } },
      { name: "磁力 +25%", apply: () => { S.magnet = Math.floor(S.magnet * 1.25); } },
      { name: "時間停止容量 +0.2", apply: () => { S.freezeMax = Math.min(2.0, +(S.freezeMax + 0.2).toFixed(2)); } }
    ];

    // 3択（被りなし）
    const choices = [];
    while (choices.length < 3) {
      const c = pool[Phaser.Math.Between(0, pool.length - 1)];
      if (!choices.includes(c)) choices.push(c);
    }
    S.choices = choices;

    drawUI(true);
  }

  function handleChoiceInput() {
    if (!S.choices) return;

    let pick = null;
    if (Phaser.Input.Keyboard.JustDown(keys.ONE)) pick = 0;
    if (Phaser.Input.Keyboard.JustDown(keys.TWO)) pick = 1;
    if (Phaser.Input.Keyboard.JustDown(keys.THREE)) pick = 2;

    if (pick !== null) {
      S.choices[pick].apply();
      S.choices = null;
      S.paused = false;
      drawUI();
    }
  }

  function resetFireTimer() {
    if (fireTimer) fireTimer.remove(false);
    fireTimer = scene.time.addEvent({ delay: S.fireIntervalMs, loop: true, callback: fire });
  }

  function gameOver() {
    S.gameOver = true;
    S.paused = false;
    if (fireTimer) fireTimer.paused = true;
    if (spawnTimer) spawnTimer.paused = true;
    drawUI(true);
  }

  function restart() {
    // 状態初期化（ざっくり）
    Object.assign(S, {
      hpMax: 100, hp: 100,
      level: 1, xp: 0, xpNeed: 12, score: 0,
      moveSpeed: 320, fireIntervalMs: 120, bulletsPerShot: 1, damage: 14, bulletSpeed: 760, knock: 220,
      freezeMax: 1.0, freeze: 1.0, magnet: 140,
      paused: false, gameOver: false, choices: null
    });

    // 全消し
    bullets.clear(true, true);
    enemies.clear(true, true);
    gems.clear(true, true);

    player.setPosition(W / 2, H / 2);
    player.invuln = 0;

    tStart = scene.time.now;
    if (fireTimer) fireTimer.remove(false);
    if (spawnTimer) spawnTimer.remove(false);
    fireTimer = scene.time.addEvent({ delay: S.fireIntervalMs, loop: true, callback: fire });
    spawnTimer = scene.time.addEvent({ delay: 260, loop: true, callback: spawnEnemy });

    drawUI();
  }

  function drawUI(overlay = false) {
    const t = ((scene.time.now - tStart) / 1000).toFixed(1);
    const freezeWant = keys?.SHIFT?.isDown && S.freeze > 0.02;

    uiText.setText(
      `LV ${S.level}  SCORE ${S.score}  TIME ${t}s\n` +
      `HP ${S.hp}/${S.hpMax}   XP ${S.xp}/${S.xpNeed}   FREEZE ${(S.freeze*100)|0}% ${freezeWant ? "[ON]" : ""}` +
      (S.gameOver ? `\n\nGAME OVER  (Rでリスタート)` : "") +
      (S.paused && S.choices ? `\n\nUPGRADE: 1) ${S.choices[0].name} / 2) ${S.choices[1].name} / 3) ${S.choices[2].name}` : "")
    );

    // バー描画
    uiBars.clear();

    // HP bar
    bar(uiBars, 12, 54, 220, 10, S.hp / S.hpMax, 0xff4d6d);
    // XP bar
    bar(uiBars, 12, 70, 220, 8, S.xp / S.xpNeed, 0x5cff6a);
    // Freeze bar
    bar(uiBars, 12, 84, 220, 8, S.freeze / S.freezeMax, 0x1fe4ff);

    if (overlay && S.paused && S.choices) {
      // 画面中央にうっすらパネル
      const panelW = 560, panelH = 120;
      const px = W / 2 - panelW / 2, py = H / 2 - panelH / 2;
      uiBars.fillStyle(0x000000, 0.55).fillRoundedRect(px, py, panelW, panelH, 16);
      uiBars.lineStyle(2, 0xffffff, 0.15).strokeRoundedRect(px, py, panelW, panelH, 16);
    }
  }

  function bar(g, x, y, w, h, ratio, color) {
    ratio = Phaser.Math.Clamp(ratio, 0, 1);
    g.fillStyle(0xffffff, 0.08).fillRoundedRect(x, y, w, h, 6);
    g.fillStyle(color, 0.9).fillRoundedRect(x, y, w * ratio, h, 6);
    g.lineStyle(1, 0xffffff, 0.12).strokeRoundedRect(x, y, w, h, 6);
  }

  function killObj(o) {
    if (!o) return;
    o.setActive(false).setVisible(false);
    if (o.body) o.body.enable = false;
  }

  function makeTexture(key, size, drawFn) {
    const g = scene?.make?.graphics({ x: 0, y: 0, add: false }) || new Phaser.GameObjects.Graphics(new Phaser.Scene("tmp"));
    g.clear();
    drawFn(g);
    g.generateTexture(key, size * 2, size * 2);
    g.destroy();
  }
})();
