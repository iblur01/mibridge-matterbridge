/**
 * Fan Matter accessory.
 * Maps FanControl cluster (fanMode Off/Low/Medium/High) to FanClient speed levels 1–3.
 *
 * @file devices/fan/FanAccessory.ts
 * @license Apache-2.0
 */
import type { DeviceInfo, FanClient, FanStatus, FanSpeed } from '@mibridge/core';
import { MatterbridgeEndpoint, fanDevice } from 'matterbridge';
import { BaseDeviceAccessory, PlatformContext } from '../../platform/DeviceAccessory.js';

// Matter FanControl.FanMode values
const MatterFanMode = { Off: 0, Low: 1, Medium: 2, High: 3, On: 4 } as const;

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
      // 0 = Off (initial), 0 = OffLowMedHigh sequence
      .createDefaultFanControlClusterServer(0, 0);

    // Register with Matterbridge
    platform.setSelectDevice(did, device.name);
    const selected = platform.validateDevice([device.name, did]);

    if (!selected) {
      this.log.debug(`[${did}] Fan excluded by white/blacklist`);
      return null;
    }

    await platform.registerDevice(endpoint);
    this.log.info(`Registered fan: ${device.name} (${did})`);

    // Subscribe to fanMode changes from Matter controller
    await endpoint.subscribeAttribute(
      'fanControl',
      'fanMode',
      async (newValue: number, _oldValue: number, context: { offline?: boolean }) => {
        if (context.offline === true) return;
        this.log.info(`[${did}] fanMode changed to ${newValue}`);
        try {
          await this.applyFanMode(fanClient, newValue);
        } catch (err) {
          this.log.error(`[${did}] Failed to apply fanMode ${newValue}: ${err}`);
        }
      },
      this.log,
    );

    // Event listeners for device → Matter sync
    fanClient.on('statusChange', (status: FanStatus) => {
      if (this.verbose) {
        this.log.info(`[${did}] Status: on=${status.on}, speed=${JSON.stringify(status.speed)}`);
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
    endpoint.setAttribute('fanControl', 'fanMode', this.statusToFanMode(status));
  }

  private statusToFanMode(status: FanStatus): number {
    if (!status.on) return MatterFanMode.Off;
    const speed = status.speed as FanSpeed;
    if (speed.type === 'level') {
      if (speed.value === 1) return MatterFanMode.Low;
      if (speed.value === 2) return MatterFanMode.Medium;
      if (speed.value >= 3) return MatterFanMode.High;
    }
    return MatterFanMode.On;
  }

  private async applyFanMode(client: FanClient, fanMode: number): Promise<void> {
    if (fanMode === MatterFanMode.Off) {
      await client.setOn(false);
      return;
    }
    await client.setOn(true);
    if (fanMode === MatterFanMode.Low) {
      await client.setSpeed({ type: 'level', value: 1 });
    } else if (fanMode === MatterFanMode.Medium) {
      await client.setSpeed({ type: 'level', value: 2 });
    } else if (fanMode === MatterFanMode.High) {
      await client.setSpeed({ type: 'level', value: 3 });
    }
    // fanMode On (4): just turn on, keep current speed
  }
}
