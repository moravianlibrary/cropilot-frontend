import { inject, Injectable, NgZone } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { EnvironmentService } from './environment.service';
import { LocalStorageService } from './local-storage.service';
import { EditorSettingsSnapshot, HEARTBEAT_SECONDS, TelemetryEvent, TelemetryEventMap, TelemetryEventType } from '../stats.types';

// Collects editor usage events and ships them to POST /events in batches.
//
// Privacy: events never contain user identity; the backend attributes them to
// the signed-in user from the JWT and only exposes aggregates. Failures are
// silent — telemetry must never get in the user's way.
@Injectable({ providedIn: 'root' })
export class TelemetryService {
  private auth = inject(AuthService);
  private env = inject(EnvironmentService);
  private storage = inject(LocalStorageService);
  private zone = inject(NgZone);
  private router = inject(Router);

  private readonly MAX_QUEUE = 500;
  private readonly BATCH_SIZE = 50;
  private readonly MAX_PER_REQUEST = 200;
  private readonly MAX_BODY_BYTES = 60_000; // fetch keepalive bodies are capped at 64 KB
  private readonly FLUSH_MS = 10_000;
  private readonly IDLE_MS = 60_000;

  private queue: TelemetryEvent[] = [];
  private sessionId: string | null = null;
  private titleId: string | null = null;
  private saves = 0;

  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private visibleSince: number | null = null;
  private visibleMs = 0;
  private lastInput = 0;
  private lastInputTick = 0;
  private listenersAttached = false;
  private retryPending = false;

  // Kill switch: APP_TELEMETRY_ENABLED=false -> env.json telemetryEnabled=false.
  // A missing key (older env.json) keeps telemetry on.
  get enabled(): boolean {
    return this.env.get('telemetryEnabled') !== false;
  }


  // ========== SESSION ==========
  startSession(titleId: string, open: TelemetryEventMap['editor_open'], settings: EditorSettingsSnapshot): void {
    if (!this.enabled) return;
    if (this.sessionId) this.endSession('close');

    this.sessionId = crypto.randomUUID();
    this.titleId = titleId;
    this.saves = 0;
    this.visibleMs = 0;
    this.visibleSince = document.visibilityState === 'visible' ? performance.now() : null;
    this.lastInput = performance.now();

    this.attachListeners();
    this.track('editor_open', open);
    this.track('settings_snapshot', settings);
    this.startTimers();
  }

  endSession(reason: 'close' | 'unload'): void {
    if (!this.sessionId) return;
    if (this.visibleSince !== null) {
      this.visibleMs += performance.now() - this.visibleSince;
      this.visibleSince = null;
    }
    this.track('editor_close', { duration_ms_visible: Math.round(this.visibleMs), saves: this.saves });
    this.stopTimers();
    this.sessionId = null;
    this.titleId = null;
    this.flush(reason);
  }

  noteSave(): void {
    this.saves++;
  }


  // ========== EVENTS ==========
  track<T extends TelemetryEventType>(type: T, payload: TelemetryEventMap[T]): void {
    if (!this.enabled || !this.sessionId) return;
    this.queue.push({
      type,
      client_ts: new Date().toISOString(),
      session_id: this.sessionId,
      title_id: this.titleId,
      payload
    });
    if (this.queue.length > this.MAX_QUEUE) this.queue.splice(0, this.queue.length - this.MAX_QUEUE);
    if (this.queue.length >= this.BATCH_SIZE) this.flush('batch');
  }

  // Sends queued events. Uses fetch with keepalive so the final batch survives
  // page unload; sendBeacon cannot carry the Authorization header.
  flush(reason: 'timer' | 'batch' | 'hidden' | 'unload' | 'close' = 'timer'): void {
    if (!this.queue.length) return;
    const token = this.storage.get<string>('access_token', null, true);
    if (!token) {
      this.queue = [];
      return;
    }

    while (this.queue.length) {
      let count = Math.min(this.queue.length, this.MAX_PER_REQUEST);
      let body = JSON.stringify(this.queue.slice(0, count));
      while (body.length > this.MAX_BODY_BYTES && count > 1) {
        count = Math.ceil(count / 2);
        body = JSON.stringify(this.queue.slice(0, count));
      }
      const batch = this.queue.splice(0, count);
      this.send(body, batch, reason === 'unload' || reason === 'hidden');
    }
  }

  private send(body: string, batch: TelemetryEvent[], keepalive: boolean): void {
    const url = `${this.auth.apiUrl}/events`;
    const token = this.storage.get<string>('access_token', null, true);
    const request = fetch(url, {
      method: 'POST',
      keepalive,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body
    });

    request
      .then(res => {
        // 4xx: our fault (expired token, invalid payload) — drop, don't loop.
        if (res.status >= 500) this.requeueOnce(batch);
      })
      .catch(() => this.requeueOnce(batch));
  }

  // Network error or 5xx: put the batch back once; a second failure drops it.
  private requeueOnce(batch: TelemetryEvent[]): void {
    if (this.retryPending) return;
    this.retryPending = true;
    this.queue.unshift(...batch);
    setTimeout(() => { this.retryPending = false; }, this.FLUSH_MS * 2);
  }


  // ========== TIMERS & LISTENERS ==========
  private startTimers(): void {
    this.stopTimers();
    this.zone.runOutsideAngular(() => {
      this.flushTimer = setInterval(() => this.flush('timer'), this.FLUSH_MS);
      this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_SECONDS * 1000);
    });
  }

  private stopTimers(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.flushTimer = null;
    this.heartbeatTimer = null;
  }

  private heartbeat(): void {
    if (!this.sessionId) return;
    if (document.visibilityState !== 'visible') return;
    if (!this.router.url.startsWith('/book/')) return;
    this.track('editor_heartbeat', { active: performance.now() - this.lastInput < this.IDLE_MS });
  }

  private attachListeners(): void {
    if (this.listenersAttached) return;
    this.listenersAttached = true;

    this.zone.runOutsideAngular(() => {
      document.addEventListener('visibilitychange', () => {
        if (!this.sessionId) return;
        if (document.visibilityState === 'hidden') {
          if (this.visibleSince !== null) {
            this.visibleMs += performance.now() - this.visibleSince;
            this.visibleSince = null;
          }
          this.flush('hidden');
        } else {
          this.visibleSince = performance.now();
        }
      });

      // pagehide (not beforeunload): a cancelled "unsaved changes" prompt must
      // not end the session, and it also fires on window.location navigations.
      window.addEventListener('pagehide', () => this.endSession('unload'));

      const markInput = () => {
        const now = performance.now();
        if (now - this.lastInputTick < 1000) return; // throttle mousemove bursts
        this.lastInputTick = now;
        this.lastInput = now;
      };
      ['keydown', 'mousedown', 'wheel', 'mousemove'].forEach(type =>
        document.addEventListener(type, markInput, { passive: true })
      );
    });
  }
}
