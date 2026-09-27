import { decodeMessage, type Info, type Message, type Settings } from "./decode.js";
import {
  encodeFrame,
  encodeGetInfo,
  encodeGetSettings,
  encodeSetBrightness,
  encodeSetChainLength,
  encodeSetColorOrder,
  type Led,
} from "./encode.js";
import { PacketReader } from "./envelope.js";
import type { ErrorCodeName } from "./constants.js";

/* Timers exist in every runtime this runs in (React Native, Node), but the
 * package builds without platform types, so declare the two it uses. */
declare function setTimeout(callback: () => void, ms: number): unknown;
declare function clearTimeout(handle: unknown): void;

/** Whatever carries packets to the board: over BLE, a write to NUS RX, split
 * into as many writes as the MTU needs. */
export interface Transport {
  write(packet: Uint8Array): Promise<void>;
}

/** The board refused a command. */
export class CommandError extends Error {
  constructor(
    readonly opcode: number,
    readonly code: number,
    readonly codeName: ErrorCodeName | "unknown",
  ) {
    super(`command 0x${opcode.toString(16)} refused: ${codeName} (0x${code.toString(16)})`);
    this.name = "CommandError";
  }
}

/** No reply arrived in time: most likely firmware that does not speak API 1. */
export class CommandTimeout extends Error {
  constructor(readonly opcode: number) {
    super(`no reply to command 0x${opcode.toString(16)}`);
    this.name = "CommandTimeout";
  }
}

export type FrameEvent = Extract<Message, { kind: "frameShown" | "frameDropped" }>;

type Reply = Extract<Message, { kind: "ok" | "error" | "info" | "settings" }>;

interface Pending {
  opcode: number;
  resolve: (r: Reply) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * One conversation with a board over OpenBoard API 1: numbers requests and
 * frames, matches replies to requests, and passes frame events on. Feed it
 * every notification with receive(); it writes through the transport, one
 * packet at a time, in call order.
 */
export class Session {
  private readonly reader = new PacketReader();
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(e: FrameEvent) => void>();
  private nextRequest = 1;
  private nextFrame = 0;
  private writes: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(
    private readonly transport: Transport,
    private readonly timeoutMs = 1500,
  ) {}

  /** Bytes from a TX notification. */
  receive(bytes: Uint8Array): void {
    for (const payload of this.reader.push(bytes)) {
      let msg: Message;
      try {
        msg = decodeMessage(payload);
      } catch {
        continue; /* not a reply at all: nothing to do with it */
      }

      if (msg.kind === "frameShown" || msg.kind === "frameDropped") {
        for (const l of this.listeners) l(msg);
      } else if (msg.kind !== "unknown") {
        const p = this.pending.get(msg.requestId);
        if (!p) continue; /* late, or not ours */
        this.pending.delete(msg.requestId);
        clearTimeout(p.timer);
        p.resolve(msg);
      }
    }
  }

  onFrameEvent(listener: (e: FrameEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getInfo(): Promise<Info> {
    return this.request(0x01, encodeGetInfo).then((r) => this.expect(r, "info"));
  }

  getSettings(): Promise<Settings> {
    return this.request(0x02, encodeGetSettings).then((r) => this.expect(r, "settings"));
  }

  setBrightness(value: number): Promise<void> {
    return this.request(0x03, (id) => encodeSetBrightness(id, value)).then((r) => this.ok(r));
  }

  setChainLength(value: number): Promise<void> {
    return this.request(0x03, (id) => encodeSetChainLength(id, value)).then((r) => this.ok(r));
  }

  setColorOrder(order: "rgb" | "grb"): Promise<void> {
    return this.request(0x03, (id) => encodeSetColorOrder(id, order)).then((r) => this.ok(r));
  }

  /** Sends a whole frame; resolves with its frame id once written. */
  async showFrame(leds: readonly Led[]): Promise<number> {
    const id = this.nextFrame;
    this.nextFrame = (this.nextFrame + 1) & 0xff;
    const packets = encodeFrame(id, leds);
    await this.enqueue(async () => {
      for (const p of packets) await this.transport.write(p);
    });
    return id;
  }

  /** The link is gone: fails whatever is waiting, and forgets partial bytes. */
  close(): void {
    this.closed = true;
    this.reader.reset();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("disconnected"));
    }
    this.pending.clear();
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.writes.then(job);
    this.writes = run.catch(() => {});
    return run;
  }

  private request(opcode: number, encode: (id: number) => Uint8Array): Promise<Reply> {
    if (this.closed) return Promise.reject(new Error("disconnected"));

    const id = this.nextRequest;
    this.nextRequest = this.nextRequest === 255 ? 1 : this.nextRequest + 1;
    const packet = encode(id);

    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CommandTimeout(opcode));
      }, this.timeoutMs);
      this.pending.set(id, { opcode, resolve, reject, timer });

      this.enqueue(() => this.transport.write(packet)).catch((err: unknown) => {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  private ok(r: Reply): void {
    if (r.kind === "error") throw new CommandError(r.opcode, r.code, r.codeName);
    if (r.kind !== "ok") throw new Error(`expected OK, got ${r.kind}`);
  }

  private expect<K extends "info" | "settings">(r: Reply, kind: K): Extract<Reply, { kind: K }> {
    if (r.kind === "error") throw new CommandError(r.opcode, r.code, r.codeName);
    if (r.kind !== kind) throw new Error(`expected ${kind}, got ${r.kind}`);
    return r as Extract<Reply, { kind: K }>;
  }
}
