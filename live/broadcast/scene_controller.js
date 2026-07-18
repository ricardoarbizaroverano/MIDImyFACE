export class SceneController {
  constructor(scenes) {
    this.scenes = scenes || {};
    this.activeScene = this.scenes.waiting ? 'waiting' : Object.keys(this.scenes)[0] || 'waiting';
  }

  setScene(sceneName) {
    if (!this.scenes[sceneName]) return false;
    this.activeScene = sceneName;
    return true;
  }

  definition() {
    return this.scenes[this.activeScene] || {};
  }
}
