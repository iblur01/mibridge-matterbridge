/**
 * WaterValve Matter accessory for Xiaomi pet fountains.
 * Maps pump on/off, battery, filter life, and water shortage to Matter clusters.
 *
 * @file devices/fountain/FountainAccessory.ts
 * @license Apache-2.0
 */
import { FountainFaultCode, FountainStatus } from '@mibridge/core';
import type { DeviceInfo, PetFountainClient } from '@mibridge/core';
import { MatterbridgeEndpoint, powerSource, waterValve } from 'matterbridge';
import { BaseDeviceAccessory, PlatformContext } from '../../platform/DeviceAccessory.js';

export class FountainAccessory extends BaseDeviceAccessory {
  private currentMode: string | null = null;

  async register(
    platform: PlatformContext,
    device: DeviceInfo,
    client: unknown,
  ): Promise<MatterbridgeEndpoint | null> {
    const fountainClient = client as PetFountainClient;
    const did = device.did;

    const endpoint = new MatterbridgeEndpoint(
      [waterValve, powerSource],
      { id: `${device.name.replaceAll(' ', '')}-${did}`, mode: 'server' },
    );

    endpoint
      .createDefaultIdentifyClusterServer()
      .createDefaultBasicInformationClusterServer(device.name, did, 0xfff1, 'Matterbridge', 0x8000, 'Matterbridge Pet Fountain')
      .createDefaultPowerSourceRechargeableBatteryClusterServer(200)
      .createDefaultValveConfigurationAndControlClusterServer()
      .createDefaultActivatedCarbonFilterMonitoringClusterServer(100, 0)
      .createDefaultBooleanStateClusterServer(false);

    // Sync initial state
    const initialStatus = await fountainClient.getStatus();
    this.syncState(endpoint, initialStatus, did);

    // Commands: Apple Home valve open/close → pump on/off
    endpoint.addCommandHandler('ValveConfigurationAndControl.open', async () => {
      this.log.info(`[${did}] open command received`);
      try {
        await fountainClient.setOn(true);
      } catch (err) {
        this.log.error(`[${did}] Failed to turn on fountain: ${err}`);
        throw err;
      }
    });

    endpoint.addCommandHandler('ValveConfigurationAndControl.close', async () => {
      this.log.info(`[${did}] close command received`);
      try {
        await fountainClient.setOn(false);
      } catch (err) {
        this.log.error(`[${did}] Failed to turn off fountain: ${err}`);
        throw err;
      }
    });

    // Command: filter reset (ActivatedCarbonFilterMonitoring.ResetCondition)
    endpoint.addCommandHandler('resetCondition', async () => {
      this.log.info(`[${did}] resetCondition (filter reset) command received`);
      try {
        await fountainClient.resetFilter();
        this.log.info(`[${did}] Filter reset successful`);
      } catch (err) {
        this.log.error(`[${did}] Failed to reset filter: ${err}`);
        throw err;
      }
    });

    // Events: polling updates from PetFountainClient
    fountainClient.on('statusChange', (status: FountainStatus) => {
      if (this.verbose) {
        this.log.info(`[${did}] Status update: on=${status.on}, battery=${status.batteryLevel}%, filter=${status.filterLifeLeft}%, fault=${status.fault}`);
      } else {
        this.log.debug(`[${did}] Status update received`);
      }
      this.syncState(endpoint, status, did);
    });

    fountainClient.on('error', (err: Error) => {
      this.log.error(`[${did}] Fountain error: ${err.message}`);
    });

    fountainClient.on('connected', () => {
      this.log.info(`[${did}] Fountain client connected`);
    });

    fountainClient.on('disconnected', () => {
      this.log.warn(`[${did}] Fountain client disconnected`);
    });

    // Register with Matterbridge
    platform.setSelectDevice(did, device.name);
    const selected = platform.validateDevice([device.name, did]);

    if (!selected) {
      this.log.debug(`[${did}] Fountain excluded by white/blacklist`);
      return null;
    }

    await platform.registerDevice(endpoint);
    this.log.info(`Registered fountain: ${device.name} (${did})`);

    return endpoint;
  }

  private syncState(endpoint: MatterbridgeEndpoint, status: FountainStatus, did: string): void {
    this.currentMode = status.mode;

    // Valve state: 1 = Open (pump on), 0 = Closed (pump off)
    const valveState = status.on ? 1 : 0;
    endpoint.setAttribute('valveConfigurationAndControl', 'currentState', valveState);
    endpoint.setAttribute('valveConfigurationAndControl', 'targetState', valveState);

    // Battery: Matter scale is 0-200 representing 0-100%
    endpoint.setAttribute('powerSource', 'batPercentRemaining', Math.floor(status.batteryLevel * 2));

    // Filter life (0-100%)
    endpoint.setAttribute('activatedCarbonFilterMonitoring', 'condition', status.filterLifeLeft);
    endpoint.setAttribute(
      'activatedCarbonFilterMonitoring',
      'changeIndication',
      this.filterIndication(status.fault, status.filterLifeLeft),
    );

    // Water shortage: true if explicit shortage OR lid is removed
    const shortage = status.waterShortage || status.fault === FountainFaultCode.LidRemoved;
    endpoint.setAttribute('booleanState', 'stateValue', shortage);

    if (status.fault === FountainFaultCode.PumpBlocked) {
      this.log.warn(`[${did}] Pump blocked — check fountain for obstruction`);
    }
  }

  /**
   * Maps fault code + filter life percentage to a Matter ResourceMonitoring
   * ChangeIndication value: 0 = Ok, 1 = Warning, 2 = Critical.
   */
  private filterIndication(fault: FountainFaultCode, filterLifeLeft: number): number {
    if (fault === FountainFaultCode.FilterExpired) return 2; // Critical
    if (filterLifeLeft <= 10) return 2; // Critical
    if (filterLifeLeft <= 30) return 1; // Warning
    return 0; // Ok
  }
}
