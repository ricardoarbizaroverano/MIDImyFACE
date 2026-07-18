export class ParticipantOverlay {
  draw(ctx, width, height, participant) {
    if (!participant || !Array.isArray(participant.landmarks)) return;
    ctx.fillStyle = participant.color || '#67ff9e';
    for (const landmark of participant.landmarks) {
      if (!Number.isFinite(landmark?.x) || !Number.isFinite(landmark?.y)) continue;
      const x = (1 - landmark.x) * width;
      const y = landmark.y * height;
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    const nickname = String(participant.nickname || 'Guest').slice(0, 20);
    const country = String(participant.countryCode || '').toUpperCase();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 18px "Courier New", monospace';
    ctx.fillText(`${nickname} ${country}`.trim(), 14, 46);
  }
}
