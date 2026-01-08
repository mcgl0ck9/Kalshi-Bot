/**
 * Calibration Utilities
 *
 * Provides access to historical prediction records for ML training.
 * Reads from data/predictions.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger.js';
import type { CalibrationRecord } from '../types/index.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const PREDICTIONS_FILE = path.join(DATA_DIR, 'predictions.json');

/**
 * Get all prediction records from disk
 */
export function getAllPredictions(): CalibrationRecord[] {
  try {
    if (!fs.existsSync(PREDICTIONS_FILE)) {
      return [];
    }
    const data = fs.readFileSync(PREDICTIONS_FILE, 'utf-8');
    return JSON.parse(data) as CalibrationRecord[];
  } catch (error) {
    logger.warn(`Failed to load predictions: ${error}`);
    return [];
  }
}

/**
 * Record a prediction (append to predictions.json)
 */
export function recordPrediction(record: CalibrationRecord): void {
  try {
    const predictions = getAllPredictions();
    predictions.push(record);

    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    fs.writeFileSync(PREDICTIONS_FILE, JSON.stringify(predictions, null, 2));
  } catch (error) {
    logger.error(`Failed to record prediction: ${error}`);
  }
}
