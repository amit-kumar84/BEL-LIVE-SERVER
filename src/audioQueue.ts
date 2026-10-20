// BEL Cyber Network Operations Status — queued visual/audio incident alerts.
type Alert = { monitorId: string; filename: string; kind: string; eventId: string };
export type AlertPlayback = Alert & { phase: 'started' | 'ended' };

export class AlertAudioQueue {
  private queue: Alert[] = [];
  private active = false;
  private announced = new Set<string>();
  private unlocked = false;
  private playbackPreparation: (() => Promise<unknown> | unknown) | null = null;
  private listeners = new Set<(playback: AlertPlayback) => void>();

  setPlaybackPreparation(preparation: () => Promise<unknown> | unknown) {
    this.playbackPreparation = preparation;
    return () => {
      if (this.playbackPreparation === preparation) this.playbackPreparation = null;
    };
  }

  subscribe(listener: (playback: AlertPlayback) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(playback: AlertPlayback) {
    for (const listener of this.listeners) listener(playback);
  }

  unlock() {
    this.unlocked = true;
    void this.playNext();
  }

  enqueue(alert: Alert) {
    const key = alert.eventId;
    if (this.announced.has(key)) return;
    this.announced.add(key);
    this.queue.push(alert);
    void this.playNext();
  }

  private async playNext() {
    if (!this.unlocked || this.active || !this.queue.length) return;
    this.active = true;
    const alert = this.queue.shift()!;
    this.notify({ ...alert, phase: 'started' });
    try {
      try { await this.playbackPreparation?.(); } catch { }
      const audio = new Audio(`http://127.0.0.1:8000/api/audio/${encodeURIComponent(alert.filename)}`);
      audio.volume = 1;
      audio.muted = false;
      await audio.play();
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
      });
    } catch {
      this.announced.delete(alert.eventId);
    } finally {
      this.notify({ ...alert, phase: 'ended' });
      this.active = false;
      void this.playNext();
    }
  }

  async test(filename: string, token: string) {
    this.unlock();
    try { await this.playbackPreparation?.(); } catch { }
    const response = await fetch('http://127.0.0.1:8000/api/admin/audio-test', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ filename }),
    });
    if (!response.ok) throw new Error('Unable to load this audio file');
    const blob = await response.blob();
    const player = new Audio(URL.createObjectURL(blob));
    player.volume = 1;
    player.muted = false;
    await player.play();
  }
}

export const alertAudio = new AlertAudioQueue();