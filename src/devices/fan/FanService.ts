/**
 * Fan device service — discovers and manages FanClient instances.
 *
 * @file devices/fan/FanService.ts
 * @license Apache-2.0
 */
import { DeviceInfo, FanClient } from '@mibridge/core';
import { BaseDeviceService } from '../../platform/DeviceService.js';

export class FanService extends BaseDeviceService {
  readonly modelPatterns = ['dmaker.fan'] as const;

  private clients: Map<string, FanClient> = new Map();
  private devices: DeviceInfo[] = [];

  async connect(allDevices: DeviceInfo[]): Promise<void> {
    const fans = allDevices.filter((d) =>
      this.modelPatterns.some((p) => d.model.includes(p)),
    );
    this.log.info(`Found ${fans.length} fan device(s): ${fans.map((f) => `${f.name} (${f.model})`).join(', ')}`);

    for (const device of fans) {
      const client = new FanClient({
        deviceId: device.did,
        region: this.config.region ?? 'de',
        pollInterval: this.config.pollInterval ?? 10_000,
        session: this.config.session,
      });
      this.clients.set(device.did, client);
      this.devices.push(device);
      this.log.debug(`Created fan client for ${device.name} (${device.did})`);
    }
  }

  getDevices(): DeviceInfo[] {
    return [...this.devices];
  }

  async connectDevice(did: string): Promise<FanClient> {
    const client = this.clients.get(did);
    if (!client) throw new Error(`No fan client for device ${did}`);

    if (!client.isConnected()) {
      this.log.info(`Connecting fan ${did}...`);
      await client.connect();
      this.log.info(`Fan ${did} connected`);
    }

    return client;
  }

  async disconnect(): Promise<void> {
    for (const [did, client] of this.clients.entries()) {
      try {
        if (client.isConnected()) {
          await client.disconnect();
          this.log.debug(`Disconnected fan ${did}`);
        }
      } catch (err) {
        this.log.error(`Error disconnecting fan ${did}: ${err}`);
      }
    }
    this.clients.clear();
    this.devices = [];
    this.log.info('FanService disconnected');
  }
}
