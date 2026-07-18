export class CameraSource {
  drawFallback(ctx, width, height) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#0e1512');
    gradient.addColorStop(1, '#121d17');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#67ff9e';
    ctx.font = '700 14px "Courier New", monospace';
    ctx.fillText('CAMERA FEED', 12, 20);
  }
}
