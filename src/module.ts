/**
 * Matterbridge Xiaomi Wrapper plugin.
 *
 * @file module.ts
 * @author Théo DELANNOY
 * @license Apache-2.0
 */
import { listDevices, Session } from '@mibridge/core';
import { MatterbridgeDynamicPlatform, PlatformConfig, PlatformMatterbridge } from 'matterbridge';

import { PlatformContext } from './platform/DeviceAccessory.js';
import { BaseDeviceService } from './platform/DeviceService.js';
import { registry } from './platform/registry.js';

type PlatformLogger = ConstructorParameters<typeof MatterbridgeDynamicPlatform>[1];
type PlatformLogLevel = Parameters<MatterbridgeDynamicPlatform['onChangeLoggerLevel']>[0];

/**
 * Matterbridge plugin entry point — instantiates MibridgePlatform.
 *
 * @param {PlatformMatterbridge} matterbridge - The Matterbridge host object.
 * @param {PlatformLogger} log - The platform logger.
 * @param {PlatformConfig} config - The plugin configuration.
 * @returns {MibridgePlatform} A new MibridgePlatform instance.
 */
export default function initializePlugin(matterbridge: PlatformMatterbridge, log: PlatformLogger, config: PlatformConfig): MibridgePlatform {
  return new MibridgePlatform(matterbridge, log, config);
}

export class MibridgePlatform extends MatterbridgeDynamicPlatform implements PlatformContext {
  private services: BaseDeviceService[] = [];
  verbose = false;

  constructor(matterbridge: PlatformMatterbridge, log: PlatformLogger, config: PlatformConfig) {
    super(matterbridge, log, config);

    if (this.verifyMatterbridgeVersion === undefined || typeof this.verifyMatterbridgeVersion !== 'function' || !this.verifyMatterbridgeVersion('3.4.0')) {
      throw new Error(
        `This plugin requires Matterbridge version >= "3.4.0". Please update Matterbridge from ${this.matterbridge.matterbridgeVersion} to the latest version in the frontend.`,
      );
    }

    this.verbose = config.verbose === true;
    this.log.info(`Initializing MiBridge Platform... ${this.verbose ? '(Verbose Mode Enabled)' : ''}`);
  }

  override async onStart(reason?: string) {
    this.log.info(`onStart called with reason: ${reason ?? 'none'}`);
    await this.ready;
    await this.clearSelect();

    const sessionConfig = this.config.session as Omit<Session, 'savedAt'> | undefined;
    if (!sessionConfig || !sessionConfig.userId || !sessionConfig.ssecurity || !sessionConfig.serviceToken) {
      this.log.error('Xiaomi session not configured. Please configure session tokens in plugin settings.');
      return;
    }

    // @mibridge/core requires savedAt on Session, but it is not used for cloud auth
    const session: Session = { ...sessionConfig, savedAt: '2024-01-01T00:00:00.000Z' };
    const region = (this.config.region as string) ?? 'de';
    const vacuumPollInterval = (this.config.pollInterval as number) ?? 5000;
    const fountainPollInterval = (this.config.fountainPollInterval as number) ?? 30_000;
    const fanPollInterval = (this.config.fanPollInterval as number) ?? 10_000;

    try {
      this.log.info('Connecting to Xiaomi Cloud...');
      const allDevices = await listDevices(session, region);
      this.log.info(`Found ${allDevices.length} total Xiaomi device(s)`);

      for (const entry of registry) {
        const service = new entry.ServiceClass(this.log, {
          session,
          region,
          pollInterval: entry.ServiceClass.name === 'FountainService' ? fountainPollInterval : entry.ServiceClass.name === 'FanService' ? fanPollInterval : vacuumPollInterval,
        });
        try {
          await service.connect(allDevices);
          this.services.push(service);

          for (const device of service.getDevices()) {
            try {
              this.log.info(`Setting up ${device.name} (${device.model}) — DID: ${device.did}`);
              const client = await service.connectDevice(device.did);
              const accessory = new entry.AccessoryClass(this.log, this.verbose);
              await accessory.register(this, device, client);
            } catch (err) {
              this.log.error(`Failed to setup device ${device.name}: ${err}`);
            }
          }
        } catch (err) {
          this.log.error(`Failed to connect service ${entry.ServiceClass.name}: ${err}`);
        }
      }
    } catch (err) {
      this.log.error(`Failed to connect to Xiaomi Cloud: ${err}`);
    }
  }

  override async onConfigure() {
    await super.onConfigure();
    this.log.info('onConfigure called');
  }

  override async onChangeLoggerLevel(logLevel: PlatformLogLevel) {
    this.log.info(`onChangeLoggerLevel called with: ${logLevel}`);
  }

  override async onShutdown(reason?: string) {
    await super.onShutdown(reason);
    this.log.info(`onShutdown called with reason: ${reason ?? 'none'}`);

    for (const service of this.services) {
      await service.disconnect();
    }
    this.services = [];

    if (this.config.unregisterOnShutdown === true) await this.unregisterAllDevices();
  }
}
