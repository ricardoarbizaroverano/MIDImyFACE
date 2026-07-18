import { loadBroadcastConfig } from './asset_config_loader.js';
import { SceneController } from './scene_controller.js';
import { ProgramRenderer } from './program_renderer.js';
import { NullEncoderAdapter, FFmpegEncoderAdapter } from './encoder_interface.js';

export class BroadcastController {
  static async create() {
    const config = await loadBroadcastConfig();
    return new BroadcastController(config);
  }

  constructor(config) {
    this.config = config;
    this.state = {
      broadcastState: 'disabled',
      operatingMode: 'installation_only',
      destination: 'none',
      activeScene: 'waiting',
      participantConnected: false,
      audioMuted: false,
      lowerThirdVisible: false,
      previewVisible: true,
      sessionNumber: 1,
      sessionTitle: 'MIDImyFACE Session #1',
      place: '',
      participant: null,
    };
    this.sceneController = new SceneController(config.scenes);
    this.renderer = new ProgramRenderer({ theme: config.theme, lowerThirds: config.lowerThirds });
    this.nullEncoder = new NullEncoderAdapter();
    this.ffmpegEncoder = new FFmpegEncoderAdapter();
    this.encoder = this.nullEncoder;
  }

  applyStatus(statusPayload, sessionInfo = null) {
    const participants = Array.isArray(sessionInfo?.participants) ? sessionInfo.participants : [];
    const primary = participants.find((entry) => entry?.fresh) || participants[0] || null;
    this.state.participant = primary;
    this.state.participantConnected = Boolean(primary?.fresh);
    if (this.state.participantConnected) this.renderer.lowerThirdOverlay.show('participant');
    this.state.activeScene = this.state.participantConnected ? 'performance' : (this.sceneController.activeScene || 'waiting');
    this.sceneController.setScene(this.state.activeScene);
    this.state.broadcastState = this.state.broadcastState === 'disabled' ? 'configured' : this.state.broadcastState;
  }

  setPlace(place) {
    this.state.place = String(place || '').trim();
    this.state.sessionTitle = `MIDImyFACE Session #${this.state.sessionNumber}${this.state.place ? ` - ${this.state.place}` : ''}`;
  }

  prepare() {
    this.state.broadcastState = 'prepared';
    this.state.sessionNumber += 1;
    this.setPlace(this.state.place);
    this.encoder = this.state.destination === 'youtube' ? this.ffmpegEncoder : this.nullEncoder;
    this.encoder.prepare({ destination: this.state.destination, title: this.state.sessionTitle });
  }

  drawPreview(canvas) {
    return this.renderer.draw(canvas, this.sceneController.definition(), this.state);
  }
}
