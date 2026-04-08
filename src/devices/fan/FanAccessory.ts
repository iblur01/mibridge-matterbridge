/**
 * Fan Matter accessory.
 * Maps FanControl cluster (percentSetting 0-100%, rockSetting) to FanClient speed levels 1–3 + oscillation.
 *
 * @file devices/fan/FanAccessory.ts
 * @license Apache-2.0
 */
import type { DeviceInfo, FanClient, FanStatus, FanSpeed } from '@mibridge/core';
import { MatterbridgeEndpoint, fanDevice } from 'matterbridge';
import { BaseDeviceAccessory, PlatformContext } from '../../platform/DeviceAccessory.js';

// Matter FanControl.FanMode values
const MatterFanMode = { Off: 0, Low: 1, Medium: 2, High: 3 } as const;

// Percent thresholds for speed level mapping
const LEVEL_THRESHOLDS = { low: 33, mid: 66 } as const;

// Percent values representing each speed level
const LEVEL_PERCENT = { off: 0, low: 25, medium: 50, high: 75 } as const;

type RockSetting = { rockLeftRight: boolean; rockUpDown: boolean; rockRound: boolean };

const ROCK_OFF: RockSetting = { rockLeftRight: false, rockUpDown: false, rockRound: false };

export class FanAccessory extends BaseDeviceAccessory {
  async register(
    platform: PlatformContext,
    device: DeviceInfo,
    client: unknown,
  ): Promise<MatterbridgeEndpoint | null> {
    const fanClient = client as FanClient;
    const did = device.did;

    const endpoint = new MatterbridgeEndpoint(
      [fanDevice],
      { id: `${device.name.replaceAll(' ', '')}-${did}` },
    );

    endpoint
      .createDefaultIdentifyClusterServer()
      .createDefaultBridgedDeviceBasicInformationClusterServer(
        device.name,
        did,
        0xfff1,
        'Matterbridge',
        'Matterbridge Fan',
      )
      // Complete cluster: percent speed + RCK (rock/oscillation), no AUT
      .createCompleteFanControlClusterServer(
        0,         // fanMode: Off
        0,         // fanModeSequence: OffLowMedHigh
        0,         // percentSetting: 0%
        0,         // percentCurrent: 0%
        undefined,
        undefined,
        undefined,
        { rockLeftRight: true, rockUpDown: false, rockRound: false },  // rockSupport
        { ...ROCK_OFF },                                                // rockSetting (initial)
      );

    // Register with Matterbridge
    platform.setSelectDevice(did, device.name);
    const selected = platform.validateDevice([device.name, did]);

    if (!selected) {
      this.log.debug(`[${did}] Fan excluded by white/blacklist`);
      return null;
    }

    await platform.registerDevice(endpoint);
    this.log.info(`Registered fan: ${device.name} (${did})`);

    // Subscribe to percentSetting changes from Matter controller
    await endpoint.subscribeAttribute(
      'fanControl',
      'percentSetting',
      async (newValue: number, _oldValue: number, context: { offline?: boolean }) => {
        if (context.offline === true) return;
        this.log.info(`[${did}] percentSetting changed to ${newValue}`);
        try {
          await this.applyPercent(fanClient, newValue);
        } catch (err) {
          this.log.error(`[${did}] Failed to apply percentSetting ${newValue}: ${err}`);
        }
      },
      this.log,
    );

    // Subscribe to rockSetting changes from Matter controller
    await endpoint.subscribeAttribute(
      'fanControl',
      'rockSetting',
      async (newValue: RockSetting, _oldValue: RockSetting, context: { offline?: boolean }) => {
        if (context.offline === true) return;
        this.log.info(`[${did}] rockSetting changed to ${JSON.stringify(newValue)}`);
        try {
          await fanClient.setOscillating(newValue.rockLeftRight);
        } catch (err) {
          this.log.error(`[${did}] Failed to apply rockSetting: ${err}`);
        }
      },
      this.log,
    );

    // Event listeners for device → Matter sync
    fanClient.on('statusChange', (status: FanStatus) => {
      if (this.verbose) {
        this.log.info(`[${did}] Status: on=${status.on}, speed=${JSON.stringify(status.speed)}, oscillating=${status.oscillating}`);
      } else {
        this.log.debug(`[${did}] Status update received`);
      }
      this.syncState(endpoint, status);
    });

    fanClient.on('error', (err: Error) => {
      this.log.error(`[${did}] Fan error: ${err.message}`);
    });

    fanClient.on('connected', () => {
      this.log.info(`[${did}] Fan client connected`);
    });

    fanClient.on('disconnected', () => {
      this.log.warn(`[${did}] Fan client disconnected`);
    });

    // Sync initial state
    const initialStatus = await fanClient.getStatus();
    this.syncState(endpoint, initialStatus);

    return endpoint;
  }

  private syncState(endpoint: MatterbridgeEndpoint, status: FanStatus): void {
    const percent = this.statusToPercent(status);
    const fanMode = this.statusToFanMode(status);
    const rockSetting: RockSetting = { ...ROCK_OFF, rockLeftRight: status.oscillating };

    endpoint.setAttribute('fanControl', 'fanMode', fanMode);
    endpoint.setAttribute('fanControl', 'percentSetting', percent);
    endpoint.setAttribute('fanControl', 'percentCurrent', percent);
    endpoint.setAttribute('fanControl', 'rockSetting', rockSetting);
  }

  private statusToPercent(status: FanStatus): number {
    if (!status.on) return LEVEL_PERCENT.off;
    const speed = status.speed as FanSpeed;
    if (speed.type === 'level') {
      if (speed.value === 1) return LEVEL_PERCENT.low;
      if (speed.value === 2) return LEVEL_PERCENT.medium;
      if (speed.value >= 3) return LEVEL_PERCENT.high;
    }
    return LEVEL_PERCENT.medium;
  }

  private statusToFanMode(status: FanStatus): number {
    if (!status.on) return MatterFanMode.Off;
    const speed = status.speed as FanSpeed;
    if (speed.type === 'level') {
      if (speed.value === 1) return MatterFanMode.Low;
      if (speed.value === 2) return MatterFanMode.Medium;
      if (speed.value >= 3) return MatterFanMode.High;
    }
    return MatterFanMode.Medium;
  }

  private async applyPercent(client: FanClient, percent: number): Promise<void> {
    if (percent === 0) {
      await client.setOn(false);
      return;
    }
    await client.setOn(true);
    if (percent <= LEVEL_THRESHOLDS.low) {
      await client.setSpeed({ type: 'level', value: 1 });
    } else if (percent <= LEVEL_THRESHOLDS.mid) {
      await client.setSpeed({ type: 'level', value: 2 });
    } else {
      await client.setSpeed({ type: 'level', value: 3 });
    }
  }
}
