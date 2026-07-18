export class LowerThirdOverlay {
  constructor(templates = {}) {
    this.templates = templates;
    this.visibleUntil = 0;
    this.key = 'participant';
  }

  show(key = 'participant', durationSeconds = null) {
    const tpl = this.templates[key] || {};
    const duration = Number(durationSeconds || tpl.durationSeconds || 5);
    this.key = key;
    this.visibleUntil = performance.now() + duration * 1000;
  }

  visible() {
    return performance.now() < this.visibleUntil;
  }

  draw(ctx, width, height, context) {
    if (!this.visible()) return;
    const tpl = this.templates[this.key] || {};
    let line1 = String(tpl.line1 || '');
    let line2 = String(tpl.line2 || '');
    for (const [key, value] of Object.entries(context || {})) {
      const token = `{${key}}`;
      line1 = line1.replaceAll(token, String(value || ''));
      line2 = line2.replaceAll(token, String(value || ''));
    }
    const x = 14;
    const boxH = 62;
    const y = height - boxH - 12;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(x, y, Math.min(width - 28, 400), boxH);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 18px "Courier New", monospace';
    ctx.fillText(line1, x + 12, y + 24);
    ctx.fillStyle = '#b8d9c1';
    ctx.font = '400 14px "Courier New", monospace';
    ctx.fillText(line2, x + 12, y + 46);
  }
}
