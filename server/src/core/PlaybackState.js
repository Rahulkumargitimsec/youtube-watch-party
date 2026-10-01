import { DEFAULT_VIDEO_ID } from '../utils/youtube.js';

/**
 * The single source of truth for "what is playing and where".
 *
 * Instead of storing a constantly-changing currentTime, we store the position at the
 * moment of the last change plus a timestamp. While playing, the live position is
 * `position + (now - updatedAt)`. This means the server never needs a timer to "tick"
 * the video forward, and any late joiner gets an exact position.
 */
export class PlaybackState {
  constructor({ videoId = DEFAULT_VIDEO_ID, isPlaying = false, position = 0, updatedAt = Date.now() } = {}) {
    this.videoId = videoId;
    this.isPlaying = isPlaying;
    this.position = position;
    this.updatedAt = updatedAt;
  }

  currentTime(now = Date.now()) {
    if (!this.isPlaying) return this.position;
    return this.position + Math.max(0, now - this.updatedAt) / 1000;
  }

  play(now = Date.now()) {
    this.position = this.currentTime(now);
    this.isPlaying = true;
    this.updatedAt = now;
  }

  pause(now = Date.now()) {
    this.position = this.currentTime(now);
    this.isPlaying = false;
    this.updatedAt = now;
  }

  seek(time, now = Date.now()) {
    this.position = time;
    this.updatedAt = now;
  }

  changeVideo(videoId, now = Date.now()) {
    this.videoId = videoId;
    this.position = 0;
    this.isPlaying = true;
    this.updatedAt = now;
  }

  /** Payload of the `sync_state` event. `serverTime` lets clients correct for latency. */
  snapshot(now = Date.now()) {
    return {
      videoId: this.videoId,
      playState: this.isPlaying ? 'playing' : 'paused',
      isPlaying: this.isPlaying,
      currentTime: this.currentTime(now),
      serverTime: now,
    };
  }

  toJSON() {
    return {
      videoId: this.videoId,
      isPlaying: this.isPlaying,
      position: this.position,
      updatedAt: this.updatedAt,
    };
  }
}
