import { PermissionsAndroid, Platform } from "react-native";
import { BleManager, type Device, type Subscription } from "react-native-ble-plx";
import {
  chunkPacket,
  encodeAllOff,
  encodeFrame,
  NUS_RX_CHAR_UUID,
  NUS_SERVICE_UUID,
  type Led,
} from "@openboard/aurora-protocol";
import {
  chunk,
  CommandTimeout,
  NUS_TX_CHAR_UUID,
  Session,
  type Info,
  type Settings,
} from "@openboard/openboard-protocol";

import { fromBase64, toBase64 } from "./base64";
import { protocolFor, type Protocol } from "./boardName";

/**
 * Which protocol a board speaks is decided by the name it advertises: the
 * firmware's board type picks both (docs/openboard-api-1.md, section 1).
 * "OpenBoard" speaks OpenBoard API 1: full colour, settings, replies. Any
 * Aurora-family board announcing API 3 is spoken to in Aurora API 3 only,
 * exactly as the vendor apps do (see boardName.ts).
 */
export type { Protocol };

/* Aurora frames always go as API 3, never the encoder's default of the day. */
const AURORA_API = 3;

const manager = new BleManager();

let device: Device | null = null;
let chunkSize = 20;
/* OpenBoard only: the conversation, and the notifications feeding it. */
let session: Session | null = null;
let notifications: Subscription | null = null;
/* Aurora only: one frame at a time, so packets cannot interleave. */
let queue: Promise<unknown> = Promise.resolve();

export type ConnectionState =
  /* notice: why a connection ended, when the app did not end it. */
  | { status: "idle"; notice?: string }
  | { status: "scanning" }
  | { status: "connecting"; name: string }
  /* Several boards in range, or not the one this wall used: the user picks. */
  | { status: "choosing"; boards: FoundBoard[]; preferred: string | null }
  | {
      status: "connected";
      /** The board's Bluetooth id: on Android, its address. */
      id: string;
      name: string;
      mtu: number;
      protocol: Protocol;
      info: Info | null;
      /** How many LEDs the board drives; null when it cannot say (Aurora mode). */
      chainLength: number | null;
      /** The board's own name; "" when it has none or cannot have one. */
      boardName: string;
    }
  | { status: "error"; message: string };

/*
 * The connection is one per app, not per screen, so its state lives here and
 * screens subscribe to it (see useConnection) rather than each tracking a
 * copy that goes stale when another screen connects or the board drops.
 */
let state: ConnectionState = { status: "idle" };
const listeners = new Set<() => void>();

function setState(next: ConnectionState) {
  state = next;
  for (const l of listeners) l();
}

export const getConnection = (): ConnectionState => state;

export function subscribeConnection(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function requestPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;

  /* neverForLocation is set in app.json, so from Android 12 the scan and
   * connect permissions are enough and location is not required. */
  const perms =
    Platform.Version >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const result = await PermissionsAndroid.requestMultiple(perms);

  return Object.values(result).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
}

/**
 * Scans until a board appears, or the timeout elapses. The controller
 * advertises an Aurora service UUID it does not register in GATT, so
 * matching is on the name.
 */
/* What the board advertises now. Android keeps a device's name from earlier
 * sightings, so a renamed board is read from its advertisement first. */
const advertisedName = (d: Device): string => d.localName ?? d.name ?? "";

/** A board heard while scanning, as the picker lists it. */
export interface FoundBoard {
  id: string;
  /** What it advertises: "OpenBoard Garage wall", "Kilter Board#1@3" and so on. */
  name: string;
  /** Signal strength in dBm: higher is nearer. Null if the phone did not say. */
  rssi: number | null;
}

/* Once one board is heard, how much longer to listen so every board in range
 * is: they advertise many times a second. */
const SETTLE_MS = 2000;

/* The boards the last scan found, by id, for chooseBoard. */
let candidates = new Map<string, Device>();

/**
 * Every board in range: listens until SETTLE_MS after the first is heard, or
 * the timeout if none is. Stops at once on hearing `stopAt`, the board this
 * wall used last.
 */
function scan(timeoutMs: number, stopAt: string | null): Promise<Map<string, Device>> {
  return new Promise((resolve, reject) => {
    const found = new Map<string, Device>();
    let settle: ReturnType<typeof setTimeout> | null = null;
    let done = false;
    const end = (err?: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (settle) clearTimeout(settle);
      manager.stopDeviceScan();
      if (err) reject(err);
      else resolve(found);
    };
    const timer = setTimeout(() => end(), timeoutMs);

    manager.startDeviceScan(null, { allowDuplicates: true }, (error, d) => {
      if (error) return end(error);
      if (!d || !protocolFor(advertisedName(d))) return;
      found.set(d.id, d);
      if (d.id === stopAt) return end();
      settle ??= setTimeout(() => end(), SETTLE_MS);
    });
  });
}

async function writeChunks(d: Device, packet: Uint8Array): Promise<void> {
  for (const part of chunk(packet, chunkSize)) {
    await d.writeCharacteristicWithoutResponseForService(NUS_SERVICE_UUID, NUS_RX_CHAR_UUID, toBase64(part));
  }
}

/** Starts an OpenBoard API 1 conversation and asks the board what it is. */
async function openSession(d: Device): Promise<Info> {
  const s = new Session({ write: (packet) => writeChunks(d, packet) });

  notifications = d.monitorCharacteristicForService(NUS_SERVICE_UUID, NUS_TX_CHAR_UUID, (error, ch) => {
    if (error || !ch?.value) return;
    s.receive(fromBase64(ch.value));
  });
  session = s;

  try {
    return await s.getInfo();
  } catch (err) {
    if (err instanceof CommandTimeout) {
      throw new Error(
        "This board advertises as OpenBoard but did not answer. Its firmware may be older than OpenBoard API 1.",
      );
    }
    throw err;
  }
}

function forget() {
  notifications?.remove();
  notifications = null;
  session?.close();
  session = null;
  device = null;
}

/**
 * Finds a board and connects to it. `prefer` is the board this wall used
 * last: found, it is taken at once. Otherwise the only board in range is taken
 * when the wall has none yet; anything else (several boards, or only boards
 * that are not this wall's) waits in "choosing" for chooseBoard or
 * cancelChoice. A board other than the wall's is never taken without asking.
 *
 * With `ask`, always asks: drops any board connected now, listens for every
 * board in range, and shows them all, even one.
 */
export async function connect(
  prefer: string | null = null,
  { ask = false, timeoutMs = 15000 }: { ask?: boolean; timeoutMs?: number } = {},
): Promise<void> {
  if (state.status === "scanning" || state.status === "connecting" || state.status === "choosing") return;
  if (ask && state.status === "connected") await disconnect();

  try {
    if (!(await requestPermissions())) {
      setState({ status: "error", message: "Bluetooth permission denied" });
      return;
    }

    setState({ status: "scanning" });
    candidates = await scan(timeoutMs, ask ? null : prefer);
  } catch (err) {
    setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    return;
  }

  if (candidates.size === 0) {
    setState({ status: "error", message: "No board found. Is it powered and in range?" });
    return;
  }

  if (!ask) {
    const preferred = prefer ? candidates.get(prefer) : undefined;
    if (preferred) return connectTo(preferred);
    if (candidates.size === 1 && !prefer) return connectTo([...candidates.values()][0]!);
  }

  const boards = [...candidates.values()]
    .map((d) => ({ id: d.id, name: advertisedName(d), rssi: d.rssi ?? null }))
    .sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
  setState({ status: "choosing", boards, preferred: prefer });
}

/** Connects to a board from the picker. */
export async function chooseBoard(id: string): Promise<void> {
  const found = candidates.get(id);
  if (state.status !== "choosing" || !found) return;
  await connectTo(found);
}

/** Closes the picker without connecting. */
export function cancelChoice(): void {
  if (state.status === "choosing") setState({ status: "idle" });
}

async function connectTo(found: Device): Promise<void> {
  const onState = setState;

  try {
    const name = advertisedName(found);
    const protocol = protocolFor(name)!;

    onState({ status: "connecting", name });

    const connected = await found.connect();
    /* Without this Android stays at the 23 byte default and every packet is
     * split into 20 byte writes. */
    const withMtu = await connected.requestMTU(247);
    await withMtu.discoverAllServicesAndCharacteristics();

    device = withMtu;
    chunkSize = Math.max(20, (withMtu.mtu ?? 23) - 3);

    withMtu.onDisconnected(() => {
      /* Already forgotten: the app ended this link itself (disconnect). */
      if (device?.id !== withMtu.id) return;
      forget();
      /* The board ended it. Boards serve one phone at a time, and a phone
       * that connects takes the board, so that is the likely reason. */
      onState({
        status: "idle",
        notice: "Disconnected: another phone connected to the board, or it went out of range.",
      });
    });

    const info = protocol === "openboard" ? await openSession(withMtu) : null;
    /* Read now, so every screen can tell when the wall uses LEDs past the end. */
    const settings = session ? await session.getSettings().catch(() => null) : null;
    const chainLength = settings?.chainLength ?? null;
    const boardName = settings?.name ?? "";

    onState({
      status: "connected",
      id: withMtu.id,
      name,
      mtu: withMtu.mtu ?? 23,
      protocol,
      info,
      chainLength,
      boardName,
    });
    await send([]);
  } catch (err) {
    const d = device;
    forget();
    if (d) await manager.cancelDeviceConnection(d.id).catch(() => {});
    onState({ status: "error", message: err instanceof Error ? err.message : String(err) });
  }
}

export async function disconnect(): Promise<void> {
  const d = device;
  forget();
  if (d) await manager.cancelDeviceConnection(d.id).catch(() => {});
  if (state.status === "connected") setState({ status: "idle" });
}

export const isConnected = (): boolean => device !== null;

/* Bumped by every frame sent, so a blink or timed frame in progress knows to stop. */
let blinkRun = 0;
const BLINK_HALF_MS = 250;

/** Writes one whole frame, ending any blink. Calls are serialised so packets cannot interleave. */
export function send(leds: readonly Led[]): Promise<unknown> {
  blinkRun++;
  return sendFrame(leds);
}

function sendFrame(leds: readonly Led[]): Promise<unknown> {
  if (session) {
    return session.showFrame(leds).catch((err) => console.warn("[board] send failed", err));
  }

  queue = queue
    .then(async () => {
      const d = device;
      if (!d) return;

      /* Cap each packet at one BLE write, so a frame costs as few round trips
       * as the negotiated MTU allows and chunkPacket has nothing left to do. */
      const opts = { maxPacketBytes: chunkSize, api: AURORA_API } as const;
      const packets = leds.length ? encodeFrame(leds, opts) : encodeAllOff(opts);

      for (const packet of packets) {
        for (const part of chunkPacket(packet, chunkSize)) {
          await d.writeCharacteristicWithoutResponseForService(NUS_SERVICE_UUID, NUS_RX_CHAR_UUID, toBase64(part));
        }
      }
    })
    .catch((err) => console.warn("[board] send failed", err));

  return queue;
}

export const lightOne = (pos: number, colour: { r: number; g: number; b: number }) =>
  send([{ pos, ...colour }]);

export const blank = () => send([]);

/**
 * Blinks one LED, twice a second, then turns the strip off: to find it on the
 * wall. Any frame sent meanwhile, such as a problem being opened, ends the
 * blink and is left showing.
 */
export async function blink(pos: number, colour: { r: number; g: number; b: number }, ms: number): Promise<void> {
  const run = ++blinkRun;
  const until = Date.now() + ms;
  for (let on = true; Date.now() < until; on = !on) {
    if (run !== blinkRun) return;
    await sendFrame(on ? [{ pos, ...colour }] : []);
    await new Promise((resolve) => setTimeout(resolve, BLINK_HALF_MS));
  }
  if (run === blinkRun) await sendFrame([]);
}

/**
 * Shows a frame for a while, then turns the strip off. Any frame sent
 * meanwhile ends it early and is left showing.
 */
export async function showFor(leds: readonly Led[], ms: number): Promise<void> {
  const run = ++blinkRun;
  await sendFrame(leds);
  await new Promise((resolve) => setTimeout(resolve, ms));
  if (run === blinkRun) await sendFrame([]);
}

// ------------------------------------------------ OpenBoard settings

/** The board's settings, or null when the board does not speak OpenBoard API 1. */
export async function readSettings(): Promise<Settings | null> {
  if (!session) return null;
  const s = await session.getSettings();
  /* It may have been changed from the board's console meanwhile. */
  if (state.status === "connected" && (state.chainLength !== s.chainLength || state.boardName !== s.name)) {
    setState({ ...state, chainLength: s.chainLength, boardName: s.name });
  }
  return s;
}

/** Brightness 1-255; saved on the board. Only for an OpenBoard board. */
export async function setBrightness(value: number): Promise<void> {
  if (!session) throw new Error("Brightness can only be set on a board in OpenBoard mode.");
  await session.setBrightness(value);
}

/** The order the strip's LEDs take their colours in; saved on the board. Only for an OpenBoard board. */
export async function setColorOrder(order: "rgb" | "grb"): Promise<void> {
  if (!session) throw new Error("The colour order can only be set on a board in OpenBoard mode.");
  await session.setColorOrder(order);
}

/** The board's name, "" to clear it; saved on the board, and advertised. Only for an OpenBoard board. */
export async function setBoardName(name: string): Promise<void> {
  if (!session) throw new Error("A board can only be named in OpenBoard mode.");
  await session.setBoardName(name);
  if (state.status === "connected") setState({ ...state, boardName: name });
}

/** How many LEDs the board drives, 1 to its largest (INFO); saved on the board. Only for an OpenBoard board. */
export async function setChainLength(length: number): Promise<void> {
  if (!session) throw new Error("The strip length can only be set on a board in OpenBoard mode.");
  await session.setChainLength(length);
  if (state.status === "connected") setState({ ...state, chainLength: length });
}
