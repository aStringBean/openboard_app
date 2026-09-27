import { PermissionsAndroid, Platform } from "react-native";
import { BleManager, type Device, type Subscription } from "react-native-ble-plx";
import {
  chunkPacket,
  DEVICE_NAMES,
  encodeAllOff,
  encodeFrame,
  NUS_RX_CHAR_UUID,
  NUS_SERVICE_UUID,
  type Led,
} from "@openboard/aurora-protocol";
import {
  chunk,
  CommandTimeout,
  DEVICE_NAME as OPENBOARD_NAME,
  NUS_TX_CHAR_UUID,
  Session,
  type Info,
  type Settings,
} from "@openboard/openboard-protocol";

import { fromBase64, toBase64 } from "./base64";

/**
 * Which protocol a board speaks is decided by the name it advertises: the
 * firmware's board type picks both (docs/openboard-api-1.md, section 1).
 * "OpenBoard" speaks OpenBoard API 1: full colour, settings, replies. An
 * Aurora-family name speaks Aurora API 3, exactly as the vendor apps do.
 */
const AURORA_NAMES = new Set<string>([
  DEVICE_NAMES.aurora,
  DEVICE_NAMES.kilter,
  DEVICE_NAMES.tension,
  DEVICE_NAMES.decoy,
  DEVICE_NAMES.grasshopper,
]);

export type Protocol = "aurora" | "openboard";

const protocolFor = (name: string): Protocol | null =>
  name === OPENBOARD_NAME ? "openboard" : AURORA_NAMES.has(name) ? "aurora" : null;

const manager = new BleManager();

let device: Device | null = null;
let chunkSize = 20;
/* OpenBoard only: the conversation, and the notifications feeding it. */
let session: Session | null = null;
let notifications: Subscription | null = null;
/* Aurora only: one frame at a time, so packets cannot interleave. */
let queue: Promise<unknown> = Promise.resolve();

export type ConnectionState =
  | { status: "idle" }
  | { status: "scanning" }
  | { status: "connecting"; name: string }
  | { status: "connected"; name: string; mtu: number; protocol: Protocol; info: Info | null }
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
function scan(timeoutMs: number): Promise<Device> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      manager.stopDeviceScan();
      reject(new Error("No board found. Is it powered, and not connected to something else?"));
    }, timeoutMs);

    manager.startDeviceScan(null, { allowDuplicates: false }, (error, found) => {
      if (error) {
        clearTimeout(timer);
        manager.stopDeviceScan();
        reject(error);
        return;
      }

      if (found?.name && protocolFor(found.name)) {
        clearTimeout(timer);
        manager.stopDeviceScan();
        resolve(found);
      }
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

export async function connect(timeoutMs = 15000): Promise<void> {
  const onState = setState;
  if (state.status === "scanning" || state.status === "connecting") return;

  try {
    if (!(await requestPermissions())) {
      onState({ status: "error", message: "Bluetooth permission denied" });
      return;
    }

    onState({ status: "scanning" });
    const found = await scan(timeoutMs);
    const name = found.name ?? "board";
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
      forget();
      onState({ status: "idle" });
    });

    const info = protocol === "openboard" ? await openSession(withMtu) : null;

    onState({ status: "connected", name, mtu: withMtu.mtu ?? 23, protocol, info });
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
}

export const isConnected = (): boolean => device !== null;

/** Writes one whole frame. Calls are serialised so packets cannot interleave. */
export function send(leds: readonly Led[]): Promise<unknown> {
  if (session) {
    return session.showFrame(leds).catch((err) => console.warn("[board] send failed", err));
  }

  queue = queue
    .then(async () => {
      const d = device;
      if (!d) return;

      /* Cap each packet at one BLE write, so a frame costs as few round trips
       * as the negotiated MTU allows and chunkPacket has nothing left to do. */
      const opts = { maxPacketBytes: chunkSize };
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

// ------------------------------------------------ OpenBoard settings

/** The board's settings, or null when the board does not speak OpenBoard API 1. */
export async function readSettings(): Promise<Settings | null> {
  return session ? session.getSettings() : null;
}

/** Brightness 1-255; saved on the board. Only for an OpenBoard board. */
export async function setBrightness(value: number): Promise<void> {
  if (!session) throw new Error("Brightness can only be set on a board in OpenBoard mode.");
  await session.setBrightness(value);
}
