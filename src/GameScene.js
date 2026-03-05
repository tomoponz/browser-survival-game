export class GameScene extends Phaser.Scene {
  constructor() {
    super("GameScene");
  }

  // -------- TUNING（ここだけ触ればゲーム感が変わる）--------
  T = {
    // player
    hpMax: 100,
    moveSpeed: 320,
    invulnSec: 0.65,

    // gun
    fireIntervalMs: 120,
    bulletsPerShot: 1,
    bulletSpeed: 760,
    bulletLifeMs: 1100,
    damage: 14,
    knock: 220,
    critChance: 0.12,
    critMul: 1.8,

    // aura (Gemini案: 回転オーラ)
    auraEnabled: true,
    auraCount: 2,
    auraRadius: 52,
    auraAngularSpeed: 2.9, // rad/sec
    auraDamage: 8,
    auraTickMs: 140, // 連続ヒットしすぎ防止

    // enemies
    enemyMax: 240,
    spawnIntervalMs: 260,

    // difficulty scaling
    enemyHpBase: 20,
    enemyHpGrowth: 1.7,
    enemySpdBase: 90,
    enemySpdGrowth: 3.0,

    // xp
    xpNeedBase: 12,
    xpNeedMul: 1.35,
    xpNeedAdd: 6,

    // gem magnet
    magnet: 140,

    // freeze (時間停止)
    freezeMax: 1.0,
    freezeDrain: 0.55,   // per sec
    freezeRegen: 0.25,   // per sec
    freezeFactor: 0.18,  // enemy speed multiplier when freezing

    // hitstop
    hitStopMs: 28,
    hitStopScale: 0.0001,

    // boss (Gemini案: ボス)
    bossFirstSec: 60,        // 1分後
    bossEverySec: 90,        // 以降の間隔
    bossHpMul: 18,
    bossSizeMul: 2.6,
    bossSpdMul: 0.55,
    bossShotIntervalMs: 1200,
    bossShotCount: 12,
    bossShotSpeed: 360,
    bossContactDamage: 22
  };

  // ----------------- Lifecycle -----------------
  preload() {}

  create() {
    // state
    this.S = {
      tStart: this.time.now,
      hp: this.T.hpMax,
      level: 1,
      xp: 0,
      xpNeed: this.T.xpNeedBase,
      score: 0,

      freeze: this.T.freezeMax,
      freezing: false,

      paused: false,
      gameOver: false,

      choices: null,
      bossAlive: false,
      bossNextAt: null
    };

    // input
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keys = this.input.keyboard.addKeys({
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

    // textures (procedural; 素材ゼロ)
    this.makeTextures();

    // groups (pool)
    this.bullets = this.physics.add.group({ defaultKey: "bullet", maxSize: 700 });
    this.enemies = this.physics.add.group({ defaultKey: "enemy", maxSize: this.T.enemyMax });
    this.gems = this.add.group({ defaultKey: "gem", maxSize: 800 }); // gemは物理不要
    this.enemyShots = this.physics.add.group({ defaultKey: "shot", maxSize: 260 }); // boss弾

    // damage number pool
    this.floatTexts = this.add.group({ maxSize: 120 });

    // player
    const { width: W, height: H } = this.scale;
    this.player = this.physics.add.image(W / 2, H / 2, "player");
    this.player.setDamping(true);
    this.player.setDrag(0.0015);
    this.player.setMaxVelocity(520);
    this.player.setCollideWorldBounds(true);
    this.player.invuln = 0;

    // aura weapon (Gemini案)
    this.auraParts = [];
    this.auraHitCD = new Map(); // enemyId -> lastHitTime
    this.initAura();

    // particles
    this.pSpark = this.add.particles(0, 0, "spark", {
      lifespan: { min: 110, max: 260 },
      speed: { min: 80, max: 360 },
      scale: { start: 1.0, end: 0 },
      quantity: 0,
      emitting: false
    });
    this.pDust = this.add.particles(0, 0, "dust", {
      lifespan: { min: 100, max: 220 },
      speed: { min: 40, max: 260 },
      scale: { start: 0.9, end: 0 },
      quantity: 0,
      emitting: false
    });

    // overlaps
    this.physics.add.overlap(this.bullets, this.enemies, (b, e) => this.onBulletHit(b, e));
    this.physics.add.overlap(this.player, this.enemies, (p, e) => this.onPlayerHit(e, false));
    this.physics.add.overlap(this.player, this.enemyShots, (p, s) => this.onPlayerHit(s, true));

    // timers
    this.fireTimer = this.time.addEvent({
      delay: this.T.fireIntervalMs,
      loop: true,
      callback: () => this.fire()
    });
    this.spawnTimer = this.time.addEvent({
      delay: this.T.spawnIntervalMs,
      loop: true,
      callback: () => this.spawnEnemy()
    });

    // boss scheduler
    this.S.bossNextAt = this.S.tStart + this.T.bossFirstSec * 1000;

    // UI
    this.uiText = this.add.text(12, 10, "", {
      fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
      fontSize: "14px",
      color: "#cfe8ff"
    }).setDepth(9999);

    this.uiGfx = this.add.graphics().setDepth(9999);

    // freeze overlay (Gemini案：時間停止中の画面エフェクト)
    this.freezeOverlay = this.add.rectangle(0, 0, W, H, 0x0b1220, 0.0).setOrigin(0).setDepth(5000);
    this.vignette = this.add.graphics().setDepth(5001);
    this.redrawVignette();

    // resize handler
    this.scale.on("resize", (gameSize) => {
      this.physics.world.setBounds(0, 0, gameSize.width, gameSize.height);
      this.freezeOverlay.setSize(gameSize.width, gameSize.height);
      this.redrawVignette();
    });
    this.physics.world.setBounds(0, 0, W, H);

    // click to focus (iOS/ブラウザでキー取りこぼし防止)
    this.input.on("pointerdown", () => this.game.canvas?.focus?.());

    this.drawUI();
  }

  update(_, dtMs) {
    const dt = dtMs / 1000;

    if (this.S.gameOver) {
      if (Phaser.Input.Keyboard.JustDown(this.keys.R)) this.scene.restart();
      return;
    }

    // レベルアップ選択中は戦闘停止
    if (this.S.paused) {
      this.handleChoiceInput();
      return;
    }

    // ---- move ----
    let ix = 0, iy = 0;
    if (this.cursors.left.isDown || this.keys.A.isDown) ix -= 1;
    if (this.cursors.right.isDown || this.keys.D.isDown) ix += 1;
    if (this.cursors.up.isDown || this.keys.W.isDown) iy -= 1;
    if (this.cursors.down.isDown || this.keys.S.isDown) iy += 1;
    const len = Math.hypot(ix, iy) || 1;
    ix /= len; iy /= len;
    this.player.setAcceleration(ix * this.T.moveSpeed * 3.2, iy * this.T.moveSpeed * 3.2);

    // ---- freeze (敵だけ遅く) ----
    const wantFreeze = this.keys.SHIFT.isDown && this.S.freeze > 0.02;
    this.S.freezing = wantFreeze;

    if (wantFreeze) this.S.freeze = Math.max(0, this.S.freeze - this.T.freezeDrain * dt);
    else this.S.freeze = Math.min(this.T.freezeMax, this.S.freeze + this.T.freezeRegen * dt);

    // overlay intensity
    const k = wantFreeze ? 0.22 + 0.28 * (this.S.freeze / this.T.freezeMax) : 0.0;
    this.freezeOverlay.setAlpha(k);

    // ---- invuln blink ----
    if (this.player.invuln > 0) {
      this.player.invuln -= dt;
      this.player.setAlpha((Math.floor(this.player.invuln * 20) % 2) ? 0.35 : 1.0);
    } else {
      this.player.setAlpha(1.0);
    }

    // ---- bullet life ----
    this.bullets.children.iterate(b => {
      if (!b || !b.active) return;
      b.life -= dtMs;
      if (b.life <= 0) this.killObj(b);
      else this.pDust.emitParticleAt(b.x, b.y, 1);
    });

    // ---- enemy AI ----
    const enemyMul = wantFreeze ? this.T.freezeFactor : 1.0;
    this.enemies.children.iterate(e => {
      if (!e || !e.active) return;

      // knock decay
      e.kbx *= 0.86; e.kby *= 0.86;

      const dx = this.player.x - e.x;
      const dy = this.player.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d, uy = dy / d;

      const base = e.speed * enemyMul;
      e.setVelocity(ux * base + e.kbx, uy * base + e.kby);

      if (e.hp < e.hpMax * 0.35) e.setAlpha(0.75 + 0.25 * Math.sin(this.time.now * 0.02));
      else e.setAlpha(1.0);
    });

    // ---- boss shots slowed by freeze (baseV*mul) ----
    this.enemyShots.children.iterate(s => {
      if (!s || !s.active) return;
      const mul = wantFreeze ? this.T.freezeFactor : 1.0;
      s.setVelocity(s.baseVx * mul, s.baseVy * mul);
      s.life -= dtMs;
      if (s.life <= 0) this.killObj(s);
    });

    // ---- gems magnet ----
    const { width: W, height: H } = this.scale;
    this.gems.children.iterate(g => {
      if (!g || !g.active) return;

      const dx = this.player.x - g.x;
      const dy = this.player.y - g.y;
      const d = Math.hypot(dx, dy);

      if (d < this.T.magnet) {
        const ux = dx / (d || 1), uy = dy / (d || 1);
        g.vx = (g.vx || 0) * 0.86 + ux * 620 * dt;
        g.vy = (g.vy || 0) * 0.86 + uy * 620 * dt;
        g.x += g.vx; g.y += g.vy;
      } else {
        g.y += 10 * dt;
      }

      if (g.x < -40 || g.x > W + 40 || g.y < -40 || g.y > H + 40) this.killObj(g);
    });

    // ---- aura update (Gemini案) ----
    this.updateAura(dt);

    // ---- boss spawn ----
    if (!this.S.bossAlive && this.time.now >= this.S.bossNextAt) {
      this.spawnBoss();
      this.S.bossNextAt = this.time.now + this.T.bossEverySec * 1000;
    }

    // ---- UI refresh ----
    if (this.time.now % 120 < dtMs) this.drawUI();
  }

  // ----------------- Core Systems -----------------
  fire() {
    if (this.S.paused || this.S.gameOver) return;

    const targets = this.enemies.getChildren().filter(e => e.active);
    if (targets.length === 0) return;

    // nearest target
    let best = null, bestD = Infinity;
    for (const e of targets) {
      const d = (e.x - this.player.x) ** 2 + (e.y - this.player.y) ** 2;
      if (d < bestD) { bestD = d; best = e; }
    }
    if (!best) return;

    const ang0 = Phaser.Math.Angle.Between(this.player.x, this.player.y, best.x, best.y);

    for (let i = 0; i < this.T.bulletsPerShot; i++) {
      const spread = (this.T.bulletsPerShot === 1) ? 0 : (i - (this.T.bulletsPerShot - 1) / 2) * 0.12;
      const ang = ang0 + spread;

      const b = this.bullets.get(this.player.x, this.player.y, "bullet");
      if (!b) return;

      b.setActive(true).setVisible(true);
      b.body.enable = true;
      b.life = this.T.bulletLifeMs;

      const vx = Math.cos(ang) * this.T.bulletSpeed;
      const vy = Math.sin(ang) * this.T.bulletSpeed;
      b.setVelocity(vx, vy);
    }
  }

  spawnEnemy() {
    if (this.S.paused || this.S.gameOver) return;
    if (this.enemies.countActive(true) >= this.T.enemyMax) return;

    const { width: W, height: H } = this.scale;
    const t = (this.time.now - this.S.tStart) / 1000;

    const hp = Math.floor(this.T.enemyHpBase + t * this.T.enemyHpGrowth);
    const spd = Math.min(240, this.T.enemySpdBase + t * this.T.enemySpdGrowth);

    const pad = 30;
    const side = Phaser.Math.Between(0, 3);
    let x, y;
    if (side === 0) { x = -pad; y = Phaser.Math.Between(0, H); }
    if (side === 1) { x = W + pad; y = Phaser.Math.Between(0, H); }
    if (side === 2) { x = Phaser.Math.Between(0, W); y = -pad; }
    if (side === 3) { x = Phaser.Math.Between(0, W); y = H + pad; }

    const e = this.enemies.get(x, y, "enemy");
    if (!e) return;

    e.setActive(true).setVisible(true);
    e.body.enable = true;

    e.hpMax = hp;
    e.hp = hp;
    e.speed = spd;
    e.kbx = 0; e.kby = 0;
    e.isBoss = false;

    // id for aura hit cooldown
    if (!e.eid) e.eid = Phaser.Math.RND.uuid();
  }

  onBulletHit(b, e) {
    if (!b.active || !e.active) return;
    this.killObj(b);

    const isCrit = Math.random() < this.T.critChance;
    const dmg = Math.floor(this.T.damage * (isCrit ? this.T.critMul : 1));

    e.hp -= dmg;

    // knockback
    const ang = Phaser.Math.Angle.Between(this.player.x, this.player.y, e.x, e.y);
    e.kbx += Math.cos(ang) * this.T.knock;
    e.kby += Math.sin(ang) * this.T.knock;

    // FX: sparks + shake + tiny hitstop
    this.pSpark.emitParticleAt(e.x, e.y, isCrit ? 12 : 6);
    this.cameras.main.shake(isCrit ? 70 : 40, isCrit ? 0.009 : 0.004);
    this.hitStop();

    // (Gemini案) ダメージ数字
    this.spawnDamageText(e.x, e.y - 18, dmg, isCrit);

    if (e.hp <= 0) this.killEnemy(e);
  }

  onPlayerHit(src, isShot) {
    if (this.S.gameOver || this.S.paused) return;
    if (this.player.invuln > 0) return;

    const dmg = isShot ? 16 : (src.isBoss ? this.T.bossContactDamage : 14);
    this.S.hp -= dmg;
    this.player.invuln = this.T.invulnSec;

    this.cameras.main.shake(120, 0.013);
    this.pSpark.emitParticleAt(this.player.x, this.player.y, 10);

    // hit feedback
    this.spawnDamageText(this.player.x, this.player.y - 22, dmg, false, true);

    if (this.S.hp <= 0) {
      this.S.hp = 0;
      this.gameOver();
    }
    this.drawUI();
  }

  killEnemy(e) {
    this.S.score += e.isBoss ? 50 : 1;

    this.pSpark.emitParticleAt(e.x, e.y, e.isBoss ? 40 : 14);
    this.cameras.main.shake(e.isBoss ? 160 : 70, e.isBoss ? 0.02 : 0.008);

    // gem drop
    const n = e.isBoss ? 18 : (1 + (Math.random() < 0.2 ? 1 : 0));
    for (let i = 0; i < n; i++) {
      const g = this.gems.get(e.x + Phaser.Math.Between(-10, 10), e.y + Phaser.Math.Between(-10, 10), "gem");
      if (!g) continue;
      g.setActive(true).setVisible(true);
      g.vx = Phaser.Math.Between(-60, 60);
      g.vy = Phaser.Math.Between(-60, 60);
      g.setDepth(10);
    }

    if (e.isBoss) {
      this.S.bossAlive = false;
      if (this.bossAttackTimer) this.bossAttackTimer.remove(false);
      this.boss = null;
    }

    this.killObj(e);

    // xp by kills (少しだけ)
    if (Math.random() < (e.isBoss ? 1.0 : 0.06)) {
      this.addXP(1);
    }
  }

  addXP(n) {
    this.S.xp += n;
    while (this.S.xp >= this.S.xpNeed) {
      this.S.xp -= this.S.xpNeed;
      this.S.level += 1;
      this.S.xpNeed = Math.floor(this.S.xpNeed * this.T.xpNeedMul + this.T.xpNeedAdd);
      this.openChoice();
    }
    this.drawUI();
  }

  openChoice() {
    this.S.paused = true;

    const pool = [
      { name: "連射 +20%", apply: () => this.setFireInterval(Math.max(50, Math.floor(this.T.fireIntervalMs * 0.82))) },
      { name: "威力 +25%", apply: () => (this.T.damage = Math.floor(this.T.damage * 1.25)) },
      { name: "弾速 +25%", apply: () => (this.T.bulletSpeed = Math.floor(this.T.bulletSpeed * 1.25)) },
      { name: "弾数 +1", apply: () => (this.T.bulletsPerShot = Math.min(7, this.T.bulletsPerShot + 1)) },
      { name: "移動 +15%", apply: () => (this.T.moveSpeed = Math.floor(this.T.moveSpeed * 1.15)) },
      { name: "磁力 +25%", apply: () => (this.T.magnet = Math.floor(this.T.magnet * 1.25)) },
      { name: "時間停止容量 +0.2", apply: () => (this.T.freezeMax = Math.min(2.0, +(this.T.freezeMax + 0.2).toFixed(2))) },

      // aura upgrades
      { name: "オーラ強化：枚数 +1", apply: () => { this.T.auraEnabled = true; this.T.auraCount = Math.min(6, this.T.auraCount + 1); this.initAura(true); } },
      { name: "オーラ強化：威力 +30%", apply: () => (this.T.auraDamage = Math.floor(this.T.auraDamage * 1.3)) },
      { name: "オーラ強化：半径 +15%", apply: () => (this.T.auraRadius = Math.floor(this.T.auraRadius * 1.15)) }
    ];

    // 3 choices, unique
    const choices = [];
    while (choices.length < 3) {
      const c = pool[Phaser.Math.Between(0, pool.length - 1)];
      if (!choices.includes(c)) choices.push(c);
    }
    this.S.choices = choices;

    this.drawUI(true);
  }

  handleChoiceInput() {
    if (!this.S.choices) return;
    let pick = null;
    if (Phaser.Input.Keyboard.JustDown(this.keys.ONE)) pick = 0;
    if (Phaser.Input.Keyboard.JustDown(this.keys.TWO)) pick = 1;
    if (Phaser.Input.Keyboard.JustDown(this.keys.THREE)) pick = 2;

    if (pick !== null) {
      this.S.choices[pick].apply();
      this.S.choices = null;
      this.S.paused = false;
      this.drawUI();
    }
  }

  setFireInterval(ms) {
    this.T.fireIntervalMs = ms;
    if (this.fireTimer) this.fireTimer.remove(false);
    this.fireTimer = this.time.addEvent({
      delay: this.T.fireIntervalMs,
      loop: true,
      callback: () => this.fire()
    });
  }

  hitStop() {
    this.physics.world.timeScale = this.T.hitStopScale;
    this.time.delayedCall(this.T.hitStopMs, () => (this.physics.world.timeScale = 1));
  }

  gameOver() {
    this.S.gameOver = true;
    this.S.paused = false;
    this.fireTimer?.paused = true;
    this.spawnTimer?.paused = true;
    this.bossAttackTimer?.paused = true;
    this.drawUI(true);
  }

  // ----------------- Boss (Gemini案) -----------------
  spawnBoss() {
    if (this.S.gameOver) return;
    if (this.S.bossAlive) return;

    const { width: W, height: H } = this.scale;
    const pad = 60;
    const side = Phaser.Math.Between(0, 3);
    let x, y;
    if (side === 0) { x = -pad; y = Phaser.Math.Between(0, H); }
    if (side === 1) { x = W + pad; y = Phaser.Math.Between(0, H); }
    if (side === 2) { x = Phaser.Math.Between(0, W); y = -pad; }
    if (side === 3) { x = Phaser.Math.Between(0, W); y = H + pad; }

    const t = (this.time.now - this.S.tStart) / 1000;
    const hp = Math.floor((this.T.enemyHpBase + t * this.T.enemyHpGrowth) * this.T.bossHpMul);
    const spd = Math.min(240, (this.T.enemySpdBase + t * this.T.enemySpdGrowth) * this.T.bossSpdMul);

    const b = this.enemies.get(x, y, "enemy");
    if (!b) return;

    b.setActive(true).setVisible(true);
    b.body.enable = true;
    b.setScale(this.T.bossSizeMul);

    b.hpMax = hp;
    b.hp = hp;
    b.speed = spd;
    b.kbx = 0; b.kby = 0;
    b.isBoss = true;
    b.eid = "BOSS";

    this.boss = b;
    this.S.bossAlive = true;

    // boss attack timer
    this.bossAttackTimer?.remove(false);
    this.bossAttackTimer = this.time.addEvent({
      delay: this.T.bossShotIntervalMs,
      loop: true,
      callback: () => this.bossShoot()
    });

    // small announcement
    this.spawnDamageText(W / 2, 120, "BOSS INCOMING", true, false, true);
    this.drawUI();
  }

  bossShoot() {
    if (!this.boss || !this.boss.active) return;
    if (this.S.paused || this.S.gameOver) return;

    // radial shots
    const n = this.T.bossShotCount;
    const base = Phaser.Math.FloatBetween(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const ang = base + (i / n) * Math.PI * 2;
      const s = this.enemyShots.get(this.boss.x, this.boss.y, "shot");
      if (!s) continue;
      s.setActive(true).setVisible(true);
      s.body.enable = true;

      const vx = Math.cos(ang) * this.T.bossShotSpeed;
      const vy = Math.sin(ang) * this.T.bossShotSpeed;
      s.baseVx = vx;
      s.baseVy = vy;
      s.life = 1600;

      // freeze状態でもupdateでvelocityを再設定するのでここはbaseのみ
      s.setVelocity(vx, vy);
    }

    this.pDust.emitParticleAt(this.boss.x, this.boss.y, 8);
    this.cameras.main.shake(60, 0.006);
  }

  // ----------------- Aura Weapon (Gemini案) -----------------
  initAura(rebuild = false) {
    // 既存破棄
    if (rebuild) {
      for (const p of this.auraParts) p.destroy();
      this.auraParts = [];
      this.auraHitCD.clear();
    }

    if (!this.T.auraEnabled) return;

    // create parts as images (no physics)
    const cnt = this.T.auraCount;
    for (let i = 0; i < cnt; i++) {
      const img = this.add.image(this.player.x, this.player.y, "aura");
      img.setDepth(20);
      img._i = i;
      img._angle = (i / cnt) * Math.PI * 2;
      this.auraParts.push(img);
    }
  }

  updateAura(dt) {
    if (!this.T.auraEnabled) return;
    if (this.S.paused || this.S.gameOver) return;
    if (this.auraParts.length !== this.T.auraCount) this.initAura(true);

    // rotate
    for (const p of this.auraParts) {
      p._angle += this.T.auraAngularSpeed * dt;
      p.x = this.player.x + Math.cos(p._angle) * this.T.auraRadius;
      p.y = this.player.y + Math.sin(p._angle) * this.T.auraRadius;
    }

    // hit enemies in range (manual overlap for speed control)
    const now = this.time.now;
    const tick = this.T.auraTickMs;

    this.enemies.children.iterate(e => {
      if (!e || !e.active) return;

      // boss too
      const eid = e.eid || (e.eid = Phaser.Math.RND.uuid());
      const last = this.auraHitCD.get(eid) || 0;
      if (now - last < tick) return;

      // check any aura part close enough
      for (const p of this.auraParts) {
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const d2 = dx * dx + dy * dy;
        const r = e.isBoss ? 52 : 26;
        if (d2 <= r * r) {
          this.auraHitCD.set(eid, now);

          // damage
          e.hp -= this.T.auraDamage;
          this.pSpark.emitParticleAt(p.x, p.y, 5);

          // small knock
          const ang = Phaser.Math.Angle.Between(this.player.x, this.player.y, e.x, e.y);
          e.kbx += Math.cos(ang) * (this.T.knock * 0.55);
          e.kby += Math.sin(ang) * (this.T.knock * 0.55);

          // tiny hitstop for “削ってる感”
          this.physics.world.timeScale = 0.18;
          this.time.delayedCall(16, () => (this.physics.world.timeScale = 1));

          this.spawnDamageText(e.x, e.y - 18, this.T.auraDamage, false);

          if (e.hp <= 0) this.killEnemy(e);
          break;
        }
      }
    });
  }

  // ----------------- UI / FX -----------------
  drawUI(overlay = false) {
    const t = ((this.time.now - this.S.tStart) / 1000).toFixed(1);
    const freezePct = Math.floor((this.S.freeze / this.T.freezeMax) * 100);

    let bossLine = "";
    if (this.S.bossAlive && this.boss && this.boss.active) {
      bossLine = `\nBOSS HP ${Math.max(0, this.boss.hp)}/${this.boss.hpMax}`;
    }

    this.uiText.setText(
      `LV ${this.S.level}  SCORE ${this.S.score}  TIME ${t}s\n` +
      `HP ${Math.max(0, this.S.hp)}/${this.T.hpMax}   XP ${this.S.xp}/${this.S.xpNeed}   FREEZE ${freezePct}% ${this.S.freezing ? "[ON]" : ""}` +
      bossLine +
      (this.S.gameOver ? `\n\nGAME OVER  (Rでリスタート)` : "") +
      (this.S.paused && this.S.choices ? `\n\nUPGRADE: 1) ${this.S.choices[0].name} / 2) ${this.S.choices[1].name} / 3) ${this.S.choices[2].name}` : "")
    );

    // bars
    this.uiGfx.clear();
    this.bar(12, 54, 220, 10, this.S.hp / this.T.hpMax, 0xff4d6d);
    this.bar(12, 70, 220, 8, this.S.xp / this.S.xpNeed, 0x5cff6a);
    this.bar(12, 84, 220, 8, this.S.freeze / this.T.freezeMax, 0x1fe4ff);

    // boss bar top
    if (this.S.bossAlive && this.boss && this.boss.active) {
      const { width: W } = this.scale;
      const ratio = Phaser.Math.Clamp(this.boss.hp / this.boss.hpMax, 0, 1);
      this.uiGfx.fillStyle(0xffffff, 0.06).fillRect(W * 0.2, 18, W * 0.6, 8);
      this.uiGfx.fillStyle(0xff4d6d, 0.9).fillRect(W * 0.2, 18, W * 0.6 * ratio, 8);
      this.uiGfx.lineStyle(1, 0xffffff, 0.12).strokeRect(W * 0.2, 18, W * 0.6, 8);
    }

    if (overlay && this.S.paused && this.S.choices) {
      const { width: W, height: H } = this.scale;
      const panelW = Math.min(640, W * 0.92), panelH = 120;
      const px = W / 2 - panelW / 2, py = H / 2 - panelH / 2;
      this.uiGfx.fillStyle(0x000000, 0.55).fillRoundedRect(px, py, panelW, panelH, 16);
      this.uiGfx.lineStyle(2, 0xffffff, 0.15).strokeRoundedRect(px, py, panelW, panelH, 16);
    }
  }

  bar(x, y, w, h, ratio, color) {
    ratio = Phaser.Math.Clamp(ratio, 0, 1);
    this.uiGfx.fillStyle(0xffffff, 0.08).fillRoundedRect(x, y, w, h, 6);
    this.uiGfx.fillStyle(color, 0.9).fillRoundedRect(x, y, w * ratio, h, 6);
    this.uiGfx.lineStyle(1, 0xffffff, 0.12).strokeRoundedRect(x, y, w, h, 6);
  }

  spawnDamageText(x, y, value, isCrit = false, isPlayer = false, isBanner = false) {
    // pool text objects
    let t = this.floatTexts.getFirstDead(false);
    if (!t) {
      t = this.add.text(0, 0, "", {
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        fontSize: "16px",
        color: "#ffffff",
        stroke: "#000000",
        strokeThickness: 3
      }).setDepth(9000);
      this.floatTexts.add(t);
    }

    t.setActive(true).setVisible(true);
    t.setPosition(x, y);

    if (isBanner) {
      t.setText(String(value));
      t.setFontSize(26);
      t.setColor("#ffffff");
      t.setAlpha(1);
      t.setOrigin(0.5);
    } else {
      t.setOrigin(0.5);
      t.setFontSize(isCrit ? 20 : 16);
      t.setText(String(value));
      t.setColor(isPlayer ? "#ff9bb0" : (isCrit ? "#ffe26a" : "#ffffff"));
      t.setAlpha(1);
    }

    // tween up + fade
    this.tweens.add({
      targets: t,
      y: y - (isBanner ? 0 : 22),
      alpha: 0,
      duration: isBanner ? 900 : 520,
      ease: "Cubic.Out",
      onComplete: () => {
        t.setActive(false).setVisible(false);
      }
    });
  }

  redrawVignette() {
    const { width: W, height: H } = this.scale;
    this.vignette.clear();

    // simple vignette: edges darker
    const edge = 80;
    this.vignette.fillStyle(0x000000, 0.28);
    this.vignette.fillRect(0, 0, W, edge);
    this.vignette.fillRect(0, H - edge, W, edge);
    this.vignette.fillRect(0, 0, edge, H);
    this.vignette.fillRect(W - edge, 0, edge, H);
  }

  // ----------------- Utils -----------------
  killObj(o) {
    if (!o) return;
    o.setActive(false).setVisible(false);
    if (o.body) o.body.enable = false;
  }

  makeTextures() {
    // player
    this.makeCircleTex("player", 16, 0x1fe4ff, 0xffffff, 0.7);

    // bullet
    this.makeCircleTex("bullet", 6, 0xffd200, 0xffffff, 0.35);

    // enemy
    this.makeCircleTex("enemy", 14, 0xff4d6d, 0x13060a, 0.85);

    // boss shot
    this.makeCircleTex("shot", 5, 0xff7b9a, 0xffffff, 0.25);

    // gem
    this.makeDiamondTex("gem", 14, 0x5cff6a, 0xffffff, 0.35);

    // aura part
    this.makeCircleTex("aura", 10, 0x7cf6ff, 0xffffff, 0.25);

    // particles
    this.makeCircleTex("spark", 3, 0xffffff, 0xffffff, 0.0);
    this.makeCircleTex("dust", 4, 0xffd200, 0xffffff, 0.0);
  }

  makeCircleTex(key, radius, fillColor, strokeColor, strokeAlpha = 0.4) {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    g.clear();
    g.fillStyle(fillColor, 1).fillCircle(radius + 2, radius + 2, radius);
    if (strokeAlpha > 0) {
      g.lineStyle(2, strokeColor, strokeAlpha).strokeCircle(radius + 2, radius + 2, radius);
    }
    g.generateTexture(key, (radius + 2) * 2, (radius + 2) * 2);
    g.destroy();
  }

  makeDiamondTex(key, radius, fillColor, strokeColor, strokeAlpha = 0.35) {
    const g = this.make.graphics({ x: 0, y: 0, add: false });
    const cx = radius + 2;
    const cy = radius + 2;
    g.fillStyle(fillColor, 1);
    g.fillTriangle(cx, cy - radius, cx + radius, cy, cx, cy + radius);
    g.fillTriangle(cx, cy - radius, cx - radius, cy, cx, cy + radius);
    g.lineStyle(2, strokeColor, strokeAlpha);
    g.strokeTriangle(cx, cy - radius, cx + radius, cy, cx, cy + radius);
    g.strokeTriangle(cx, cy - radius, cx - radius, cy, cx, cy + radius);
    g.generateTexture(key, (radius + 2) * 2, (radius + 2) * 2);
    g.destroy();
  }
}
