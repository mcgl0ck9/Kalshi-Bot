/**
 * Logger utility for Kalshi Edge Detector
 */

import chalk from 'chalk';
import dayjs from 'dayjs';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';

function formatTimestamp(): string {
  return dayjs().format('YYYY-MM-DD HH:mm:ss');
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

export const logger = {
  debug(message: string, ...args: unknown[]): void {
    if (shouldLog('debug')) {
      console.log(
        chalk.gray(`${formatTimestamp()} - DEBUG - ${message}`),
        ...args
      );
    }
  },

  info(message: string, ...args: unknown[]): void {
    if (shouldLog('info')) {
      console.log(
        chalk.blue(`${formatTimestamp()} - INFO - ${message}`),
        ...args
      );
    }
  },

  warn(message: string, ...args: unknown[]): void {
    if (shouldLog('warn')) {
      console.log(
        chalk.yellow(`${formatTimestamp()} - WARN - ${message}`),
        ...args
      );
    }
  },

  error(message: string, ...args: unknown[]): void {
    if (shouldLog('error')) {
      console.log(
        chalk.red(`${formatTimestamp()} - ERROR - ${message}`),
        ...args
      );
    }
  },

  // Styled output for pipeline steps
  step(stepNumber: number, message: string): void {
    console.log(chalk.cyan(`\nStep ${stepNumber}: ${message}`));
  },

  success(message: string): void {
    console.log(chalk.green(`  ✓ ${message}`));
  },

  divider(): void {
    console.log(chalk.gray('═'.repeat(60)));
  },
};
