/**
 * Vacuum device service — discovers and manages DreameVacuumClient instances.
 * Adapted from XiaomiVacuumService to use BaseDeviceService.
 *
 * @file devices/vacuum/VacuumService.ts
 * @license Apache-2.0
 */
import { DeviceInfo, DreameVacuumClient } from '@mibridge/core';
import { BaseDeviceService } from '../../platform/DeviceService.js';

export class VacuumService extends BaseDeviceService {
  readonly modelPatterns = ['dreame', 'vacuum', 'roborock'] as const;

  private clients: Map<string, DreameVacuumClient> = new Map();
  private devices: DeviceInfo[] = [];

  async connect(allDevices: DeviceInfo[]): Promise<void> {
    const vacuums = allDevices.filter((d) =>
      this.modelPatterns.some((p) => d.model.includes(p)),
    );
    this.log.info(`Found ${vacuums.length} vacuum device(s): ${vacuums.map((v) => `${v.name} (${v.model})`).join(', ')}`);

    for (const device of vacuums) {
      const client = new DreameVacuumClient({
        deviceId: device.did,
        region: this.config.region ?? 'de',
        pollInterval: this.config.pollInterval ?? 5000,
        session: this.config.session,
      });
      this.clients.set(device.did, client);
      this.devices.push(device);
      this.log.debug(`Created vacuum client for ${device.name} (${device.did})`);
    }
  }

  getDevices(): DeviceInfo[] {
    return [...this.devices];
  }

  async connectDevice(did: string): Promise<DreameVacuumClient> {
    const client = this.clients.get(did);
    if (!client) throw new Error(`No vacuum client for device ${did}`);

    if (!client.isConnected()) {
      this.log.info(`Connecting vacuum ${did}...`);
      await client.connect();
      this.log.info(`Vacuum ${did} connected`);
    }

    return client;
  }

  async disconnect(): Promise<void> {
    for (const [did, client] of this.clients.entries()) {
      try {
        if (client.isConnected()) {
          await client.disconnect();
          this.log.debug(`Disconnected vacuum ${did}`);
        }
      } catch (err) {
        this.log.error(`Error disconnecting vacuum ${did}: ${err}`);
      }
    }
    this.clients.clear();
    this.devices = [];
    this.log.info('VacuumService disconnected');
  }
}
