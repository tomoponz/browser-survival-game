import { GameScene } from "./GameScene.js";

const config = {
  type: Phaser.AUTO,
  parent: "game",
  backgroundColor: "#070b11",
  physics: {
    default: "arcade",
    arcade: { debug: false }
  },
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 960,
    height: 540
  },
  scene: [GameScene]
};

new Phaser.Game(config);
