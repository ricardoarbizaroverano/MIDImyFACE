export class QROverlay {
  drawPlaceholder(ctx, width, height, theme) {
    const size = Math.max(48, Number(theme?.size || 96));
    const margin = Math.max(8, Number(theme?.margin || 12));
    const x = width - size - margin;
    const y = height - size - margin;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 4, y + 4, size - 8, size - 8);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 11px "Courier New", monospace';
    ctx.fillText('QR', x + size / 2 - 8, y + size / 2 + 4);
  }
}
