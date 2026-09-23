import { PermissionsAndroid, Platform } from "react-native";
import { BleManager, type Device } from "react-native-ble-plx";
import {
  chunkPacket,
  DEVICE_NAMES,
  encodeAllOff,
  encodeFrame,
  NUS_RX_CHAR_UUID,
  NUS_SERVICE_UUID,
  type Led,
} from "@openboard/aurora-protocol";

import { toBase64 } from "./base64";

/**
 * The controller advertises an Aurora service UUID it does not actually
 * register in GATT, so scanning has to match on the advertised name instead.
 * Which name depends on the emulated mode, and it cannot be read back over
 * BLE, so all of the Aurora-family names are accepted.
 */
const BOARD_NAMES = new Set<string>([
  DEVICE_NAMES.aurora,
  DEVICE_NAMES.kilter,
  DEVICE_NAMES.tension,
  DEVICE_NAMES.decoy,
  DEVICE_NAMES.grasshopper,
]);

const manager = new BleManager();

let device: Device | null = null;
let chunkSize = 20;
/* One frame at a time: a frame's packets must not interleave with another's. */
let queue: Promise<unknown> = Promise.resolve();

export type ConnectionState =
  | { status: "idle" }
  | { status: "scanning" }
  | { status: "connecting"; name: string }
  | { status: "connected"; name: string; mtu: number }
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

/** Scans until an Aurora-family board appears, or the timeout elapses. */
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

      if (found?.name && BOARD_NAMES.has(found.name)) {
        clearTimeout(timer);
        manager.stopDeviceScan();
        resolve(found);
      }
    });
  });
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

    onState({ status: "connecting", name });

    const connected = await found.connect();
    /* Without this Android stays at the 23 byte default and every packet is
     * split into 20 byte writes. */
    const withMtu = await connected.requestMTU(247);
    await withMtu.discoverAllServicesAndCharacteristics();

    device = withMtu;
    chunkSize = Math.max(20, (withMtu.mtu ?? 23) - 3);

    withMtu.onDisconnected(() => {
      device = null;
      onState({ status: "idle" });
    });

    onState({ status: "connected", name, mtu: withMtu.mtu ?? 23 });
    await send([]);
  } catch (err) {
    device = null;
    onState({ status: "error", message: err instanceof Error ? err.message : String(err) });
  }
}

export async function disconnect(): Promise<void> {
  const d = device;
  device = null;
  if (d) await manager.cancelDeviceConnection(d.id).catch(() => {});
}

export const isConnected = (): boolean => device !== null;

/** Writes one whole frame. Calls are serialised so packets cannot interleave. */
export function send(leds: readonly Led[]): Promise<unknown> {
  queue = queue
    .then(async () => {
      const d = device;
      if (!d) return;

      /* Cap each packet at one BLE write, so a frame costs as few round trips
       * as the negotiated MTU allows and chunkPacket has nothing left to do. */
      const opts = { maxPacketBytes: chunkSize };
      const packets = leds.length ? encodeFrame(leds, opts) : encodeAllOff(opts);

      for (const packet of packets) {
        for (const chunk of chunkPacket(packet, chunkSize)) {
          await d.writeCharacteristicWithoutResponseForService(
            NUS_SERVICE_UUID,
            NUS_RX_CHAR_UUID,
            toBase64(chunk),
          );
        }
      }
    })
    .catch((err) => console.warn("[board] send failed", err));

  return queue;
}

export const lightOne = (pos: number, colour: { r: number; g: number; b: number }) =>
  send([{ pos, ...colour }]);

export const blank = () => send([]);
