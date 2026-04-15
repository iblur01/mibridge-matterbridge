/**
 * WaterValve Matter accessory for Xiaomi pet fountains.
 * Maps pump on/off, battery, filter life, and water shortage to Matter clusters.
 *
 * @file devices/fountain/FountainAccessory.ts
 * @license Apache-2.0
 */
import type { DeviceInfo, PetFountainClient } from '@mibridge/core';
import { FountainFaultCode, FountainMode, FountainStatus } from '@mibridge/core';
import { airPurifier, MatterbridgeEndpoint, powerSource } from 'matterbridge';

import { BaseDeviceAccessory, PlatformContext } from '../../platform/DeviceAccessory.js';

// FanMode values from Matter FanControl cluster
const FanMode = { Off: 0, Low: 1, Medium: 2, High: 3, On: 4, Auto: 5 } as const;

export class FountainAccessory extends BaseDeviceAccessory {
  async register(platform: PlatformContext, device: DeviceInfo, client: unknown): Promise<MatterbridgeEndpoint | null> {
    const fountainClient = client as PetFountainClient;
    const did = device.did;

    const endpoint = new MatterbridgeEndpoint([airPurifier, powerSource], { id: `${device.name.replaceAll(' ', '')}-${did}` });

    endpoint
      .createDefaultIdentifyClusterServer()
      .createDefaultBridgedDeviceBasicInformationClusterServer(device.name, did, 0xfff1, 'Matterbridge', 'Matterbridge Pet Fountain')
      .createDefaultPowerSourceRechargeableBatteryClusterServer(200)
      .createDefaultFanControlClusterServer()
      .createDefaultActivatedCarbonFilterMonitoringClusterServer(100, 0)
      .createDefaultBooleanStateClusterServer(false);

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

    // Subscribe and sync after endpoint is active
    await endpoint.subscribeAttribute(
      'fanControl',
      'fanMode',
      async (newValue: number, _oldValue: number, context: { offline?: boolean }) => {
        if (context.offline === true) return;
        this.log.info(`[${did}] fanMode changed to ${newValue}`);
        try {
          if (newValue === FanMode.Off) {
            await fountainClient.setOn(false);
          } else {
            await fountainClient.setOn(true);
            const mode = this.fanModeToFountainMode(newValue);
            if (mode) await fountainClient.setMode(mode);
          }
        } catch (err) {
          this.log.error(`[${did}] Failed to apply fanMode ${newValue}: ${err}`);
        }
      },
      this.log,
    );

    const initialStatus = await fountainClient.getStatus();
    this.syncState(endpoint, initialStatus, did);

    return endpoint;
  }

  private syncState(endpoint: MatterbridgeEndpoint, status: FountainStatus, did: string): void {
    // Fan mode: Off when pump off, otherwise map fountain mode to FanMode
    endpoint.setAttribute('fanControl', 'fanMode', this.fountainModeToFanMode(status.on, status.mode));

    // Battery: Matter scale is 0-200 representing 0-100%
    endpoint.setAttribute('powerSource', 'batPercentRemaining', Math.floor(status.batteryLevel * 2));

    // Filter life (0-100%)
    endpoint.setAttribute('activatedCarbonFilterMonitoring', 'condition', status.filterLifeLeft);
    endpoint.setAttribute('activatedCarbonFilterMonitoring', 'changeIndication', this.filterIndication(status.fault, status.filterLifeLeft));

    // Water shortage: true if explicit shortage OR lid is removed
    const shortage = status.waterShortage || status.fault === FountainFaultCode.LidRemoved;
    endpoint.setAttribute('booleanState', 'stateValue', shortage);

    if (status.fault === FountainFaultCode.PumpBlocked) {
      this.log.warn(`[${did}] Pump blocked — check fountain for obstruction`);
    }
  }

  private fountainModeToFanMode(on: boolean, mode: string): number {
    if (!on) return FanMode.Off;
    if (mode === 'intermittent') return FanMode.Low;
    if (mode === 'sensor') return FanMode.Auto;
    return FanMode.High; // continuous or unknown → High
  }

  private fanModeToFountainMode(fanMode: number): FountainMode | null {
    if (fanMode === FanMode.Low) return FountainMode.Intermittent;
    if (fanMode === FanMode.Auto) return FountainMode.Sensor;
    if (fanMode === FanMode.Medium || fanMode === FanMode.High || fanMode === FanMode.On) return FountainMode.Continuous;
    return null;
  }

  /**
   * Maps fault code + filter life percentage to a Matter ResourceMonitoring
   * ChangeIndication value: 0 = Ok, 1 = Warning, 2 = Critical.
   *
   * @param {FountainFaultCode} fault - The current fault code reported by the fountain.
   * @param {number} filterLifeLeft - Remaining filter life as a percentage (0–100).
   * @returns {number} 0 for Ok, 1 for Warning, 2 for Critical.
   */
  private filterIndication(fault: FountainFaultCode, filterLifeLeft: number): number {
    if (fault === FountainFaultCode.FilterExpired) return 2; // Critical
    if (filterLifeLeft <= 10) return 2; // Critical
    if (filterLifeLeft <= 30) return 1; // Warning
    return 0; // Ok
  }
}
