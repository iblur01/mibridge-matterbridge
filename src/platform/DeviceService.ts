/**
 * Abstract base class for all Xiaomi device services.
 * Each device type (vacuum, fountain, ...) extends this.
 *
 * @file platform/DeviceService.ts
 */
import type { DeviceInfo, Session } from '@mibridge/core';
import type { AnsiLogger } from 'matterbridge/logger';

export interface XiaomiServiceConfig {
  session: Session;
  region?: string;
  pollInterval?: number;
}

export abstract class BaseDeviceService {
  protected log: AnsiLogger;
  protected config: XiaomiServiceConfig;

  constructor(log: AnsiLogger, config: XiaomiServiceConfig) {
    this.log = log;
    this.config = config;
  }

  /** Xiaomi model substrings this service handles (e.g. ['pet_waterer']). */
  abstract readonly modelPatterns: readonly string[];

  /**
   * Filter `allDevices` by modelPatterns, instantiate clients.
   * Does NOT call client.connect() — that happens in connectDevice().
   */
  abstract connect(allDevices: DeviceInfo[]): Promise<void>;

  /** Returns the DeviceInfo list for devices this service owns. */
  abstract getDevices(): DeviceInfo[];

  /** Connect (if not already connected) and return the client for a given DID. */
  abstract connectDevice(did: string): Promise<unknown>;

  /** Gracefully disconnect all clients. */
  abstract disconnect(): Promise<void>;
}
