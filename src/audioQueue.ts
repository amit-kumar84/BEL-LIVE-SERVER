type Alert = { monitorId: string; filename: string; kind: string; eventId: string };

export class AlertAudioQueue {
  private queue: Alert[] = [];
  private active = false;
  private announced = new Set<string>();
  private unlocked = false;

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
    try {
      const audio = new Audio(`http://127.0.0.1:8000/api/audio/${encodeURIComponent(alert.filename)}`);
      await audio.play();
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
      });
    } catch {
      this.announced.delete(alert.eventId);
    } finally {
      this.active = false;
      void this.playNext();
    }
  }

  async test(filename: string, token: string) {
    this.unlock();
    const response = await fetch('http://127.0.0.1:8000/api/admin/audio-test', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ filename }),
    });
    if (!response.ok) throw new Error('Unable to load this audio file');
    const blob = await response.blob();
    const player = new Audio(URL.createObjectURL(blob));
    await player.play();
  }
}

export const alertAudio = new AlertAudioQueue();