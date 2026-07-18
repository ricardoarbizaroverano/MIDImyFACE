import { CameraSource } from './camera_source.js';
import { ParticipantOverlay } from './participant_overlay.js';
import { QROverlay } from './qr_overlay.js';
import { LowerThirdOverlay } from './lower_third_overlay.js';

export class ProgramRenderer {
  constructor({ theme = {}, lowerThirds = {} } = {}) {
    this.theme = theme;
    this.cameraSource = new CameraSource();
    this.participantOverlay = new ParticipantOverlay();
    this.qrOverlay = new QROverlay();
    this.lowerThirdOverlay = new LowerThirdOverlay(lowerThirds);
    this.lastTimings = { finalCompositionMs: 0 };
  }

  draw(canvas, scene, state) {
    if (!canvas) return null;
    const started = performance.now();
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) return null;
    const width = canvas.width;
    const height = canvas.height;

    if (scene.type === 'video') {
      ctx.fillStyle = '#111418';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 22px "Courier New", monospace';
      ctx.fillText(`${String(state.activeScene || 'scene').toUpperCase()} PLACEHOLDER`, 30, 40);
    } else {
      this.cameraSource.drawFallback(ctx, width, height);
    }

    const participant = state.participantConnected ? state.participant : null;
    if (scene.showParticipant && participant) {
      this.participantOverlay.draw(ctx, width, height, participant);
    }

    if (scene.showGrid && participant) {
      const cols = Number(this.theme?.grid?.cols || 4);
      const rows = Number(this.theme?.grid?.rows || 2);
      ctx.strokeStyle = 'rgba(140,208,142,0.75)';
      for (let col = 1; col < cols; col += 1) {
        const x = Math.round((width * col) / cols);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let row = 1; row < rows; row += 1) {
        const y = Math.round((height * row) / rows);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }
    }

    if (scene.showLogo) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(10, 54, 170, 24);
      ctx.fillStyle = '#67ff9e';
      ctx.font = '700 14px "Courier New", monospace';
      ctx.fillText('MIDImyFACE', 16, 70);
    }

    if (scene.showQR) {
      this.qrOverlay.drawPlaceholder(ctx, width, height, this.theme?.qr || {});
    }

    this.lowerThirdOverlay.draw(ctx, width, height, {
      nickname: participant?.nickname || 'Guest',
      country: participant?.countryCode || '',
      place: state.place || '',
      sessionTitle: state.sessionTitle || '',
      sessionNumber: state.sessionNumber || '',
    });

    this.lastTimings.finalCompositionMs = performance.now() - started;
    return {
      timestamp: Date.now(),
      size: { width, height },
      scene: state.activeScene,
      participantConnected: Boolean(participant),
    };
  }
}
