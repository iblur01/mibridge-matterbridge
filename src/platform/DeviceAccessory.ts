/**
 * Abstract base class for Matter accessory registration.
 * Each device type implements this to create and wire up a Matter endpoint.
 *
 * @file platform/DeviceAccessory.ts
 */
import type { DeviceInfo } from '@mibridge/core';
import type { MatterbridgeEndpoint } from 'matterbridge';
import type { AnsiLogger } from 'matterbridge/logger';

/** Minimal platform surface needed by accessories — avoids circular imports. */
export interface PlatformContext {
  log: AnsiLogger;
  verbose: boolean;
  setSelectDevice(did: string, name: string): void;
  validateDevice(args: string[]): boolean;
  registerDevice(device: MatterbridgeEndpoint): Promise<void>;
}

export abstract class BaseDeviceAccessory {
  protected log: AnsiLogger;
  protected verbose: boolean;

  constructor(log: AnsiLogger, verbose: boolean) {
    this.log = log;
    this.verbose = verbose;
  }

  /**
   * Create the Matter endpoint, add clusters, set up command handlers and
   * event listeners, then call platform.registerDevice().
   * Returns the registered endpoint, or null if validateDevice() rejected it.
   */
  abstract register(
    platform: PlatformContext,
    device: DeviceInfo,
    client: unknown,
  ): Promise<MatterbridgeEndpoint | null>;
}
