export class BroadcastControls {
  constructor(keymap = {}) {
    this.keymap = keymap;
  }

  match(event) {
    const key = String(event?.key || '').toLowerCase();
    for (const [action, mapped] of Object.entries(this.keymap)) {
      if (String(mapped).toLowerCase() === key) return action;
    }
    return null;
  }
}
