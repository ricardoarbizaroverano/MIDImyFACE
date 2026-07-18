export class EncoderInterface {
  prepare() { return true; }
  start() { return true; }
  stop() { return true; }
  submitFrame() {}
}

export class NullEncoderAdapter extends EncoderInterface {}

export class FFmpegEncoderAdapter extends EncoderInterface {
  constructor() {
    super();
    this.settings = {};
  }

  prepare(settings = {}) {
    this.settings = { ...settings };
    return true;
  }
}
