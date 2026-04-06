/**
 * Xiaomi Vacuum Service - Manages connections to Xiaomi Cloud and vacuum clients.
 *
 * @file xiaomiService.ts
 * @author Théo DELANNOY
 * @license Apache-2.0
 */

import { AnsiLogger } from 'matterbridge/logger';
import { DreameVacuumClient, listDevices, Session, DeviceInfo } from '@mibridge/core';

export interface XiaomiServiceConfig {
  session: Session;
  region?: string;
  pollInterval?: number;
}

export class XiaomiVacuumService {
  private log: AnsiLogger;
  private config: XiaomiServiceConfig;
  private clients: Map<string, DreameVacuumClient> = new Map();
  private devices: DeviceInfo[] = [];
  private isConnected = false;

  constructor(log: AnsiLogger, config: XiaomiServiceConfig) {
    this.log = log;
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      this.log.warn('XiaomiVacuumService already connected');
      return;
    }

    try {
      this.log.info('Connecting to Xiaomi Cloud...');
      this.devices = await listDevices(this.config.session, this.config.region ?? 'de');
      this.log.info(`Found ${this.devices.length} Xiaomi devices`);

      const vacuums = this.devices.filter((d) => 
        d.model.includes('dreame') || 
        d.model.includes('vacuum') || 
        d.model.includes('roborock')
      );
      
      this.log.info(`Found ${vacuums.length} vacuum devices: ${vacuums.map((v) => `${v.name} (${v.model})`).join(', ')}`);

      for (const device of vacuums) {
        const client = new DreameVacuumClient({
          deviceId: device.did,
          region: this.config.region ?? 'de',
          pollInterval: this.config.pollInterval ?? 5000,
          session: this.config.session,
        });

        this.clients.set(device.did, client);
        this.log.debug(`Created client for ${device.name} (${device.did})`);
      }

      this.isConnected = true;
      this.log.info('XiaomiVacuumService connected successfully');
    } catch (error) {
      this.log.error(`Failed to connect to Xiaomi Cloud: ${error}`);
      throw error;
    }
  }

  async connectVacuum(did: string): Promise<DreameVacuumClient> {
    const client = this.clients.get(did);
    if (!client) {
      throw new Error(`No client found for device ${did}`);
    }

    if (!client.isConnected()) {
      this.log.info(`Connecting to vacuum ${did}...`);
      await client.connect();
      this.log.info(`Vacuum ${did} connected`);
    }

    return client;
  }

  async disconnect(): Promise<void> {
    if (!this.isConnected) return;

    this.log.info('Disconnecting XiaomiVacuumService...');

    for (const [did, client] of this.clients.entries()) {
      try {
        if (client.isConnected()) {
          await client.disconnect();
          this.log.debug(`Disconnected vacuum ${did}`);
        }
      } catch (error) {
        this.log.error(`Error disconnecting vacuum ${did}: ${error}`);
      }
    }

    this.clients.clear();
    this.devices = [];
    this.isConnected = false;
    this.log.info('XiaomiVacuumService disconnected');
  }

  getDevices(): DeviceInfo[] {
    return [...this.devices];
  }

  getVacuums(): DeviceInfo[] {
    return this.devices.filter((d) => 
      d.model.includes('dreame') || 
      d.model.includes('vacuum') || 
      d.model.includes('roborock')
    );
  }

  getClient(did: string): DreameVacuumClient | undefined {
    return this.clients.get(did);
  }

  isServiceConnected(): boolean {
    return this.isConnected;
  }
}
