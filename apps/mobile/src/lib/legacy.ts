import AsyncStorage from "@react-native-async-storage/async-storage";

import { emptyCalibration, migrate, type Calibration } from "./calibration";

/*
 * Calibration lived in AsyncStorage before the SQLite database. It is read
 * once, to seed the first wall, and never written again. It is left in place
 * rather than deleted, as a fallback while the database is new.
 */
const KEYS = ["openboard.calibration.v2", "openboard.calibration.v1"];

export async function loadLegacyCalibration(): Promise<Calibration> {
  try {
    for (const key of KEYS) {
      const raw = await AsyncStorage.getItem(key);
      if (raw) return migrate(JSON.parse(raw));
    }
  } catch (err) {
    console.warn("[legacy] could not read old calibration", err);
  }
  return emptyCalibration();
}
