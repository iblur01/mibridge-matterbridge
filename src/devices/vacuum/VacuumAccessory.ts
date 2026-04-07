/**
 * RoboticVacuumCleaner Matter accessory.
 * Extracts vacuum-specific Matter wiring from module.ts.
 *
 * @file devices/vacuum/VacuumAccessory.ts
 * @license Apache-2.0
 */
import {
  Area,
  CleanMode,
  DeviceInfo,
  DreameVacuumClient,
  VacuumErrorCode,
  VacuumMap,
  VacuumState,
} from '@mibridge/core';
import { RoboticVacuumCleaner } from 'matterbridge/devices';
import { BaseDeviceAccessory, PlatformContext } from '../../platform/DeviceAccessory.js';

export class VacuumAccessory extends BaseDeviceAccessory {
  async register(
    platform: PlatformContext,
    device: DeviceInfo,
    client: unknown,
  ): Promise<RoboticVacuumCleaner | null> {
    const vacuumClient = client as DreameVacuumClient;
    const did = device.did;

    this.log.info(`[${did}] Loading maps and areas...`);
    const maps = await vacuumClient.getMaps();
    this.log.info(`[${did}] Found ${maps.length} map(s)`);

    const areas = maps.length > 0 ? maps[0].areas : [];
    this.log.info(`[${did}] Found ${areas.length} area(s): ${areas.map((a: Area) => a.name).join(', ')}`);

    const supportedAreas = areas.map((area: Area, index: number) => ({
      areaId: parseInt(area.id) || index + 1,
      mapId: area.mapId ? parseInt(area.mapId) : null,
      areaInfo: {
        locationInfo: { locationName: area.name, floorNumber: null, areaType: null },
        landmarkInfo: null,
      },
    }));

    const supportedMaps = maps.map((map: VacuumMap) => ({
      mapId: parseInt(map.id) || 1,
      name: map.name,
    }));

    const vacuum = new RoboticVacuumCleaner(
      device.name,
      did,
      'server',
      1,   // currentRunMode (Idle)
      undefined,
      1,   // currentCleanMode (Vacuum)
      undefined,
      null,
      null,
      0x42, // operationalState (Docked)
      undefined,
      supportedAreas,
      [],
      supportedAreas.length > 0 ? supportedAreas[0].areaId : 1,
      supportedMaps.length > 0 ? supportedMaps : undefined,
    );

    this.log.info(`[${did}] Created vacuum with ${supportedAreas.length} area(s)`);

    await this.detectAndConfigureMopCapabilities(did, vacuumClient, vacuum);

    if (this.verbose) {
      await this.displayVerboseInfo(device, vacuumClient, maps, areas, supportedAreas);
    }

    this.setupCommandHandlers(vacuum, vacuumClient, did);
    this.setupEventListeners(vacuum, vacuumClient, did);

    platform.setSelectDevice(did, device.name);
    const selected = platform.validateDevice([device.name, did]);

    if (!selected) {
      this.log.debug(`[${did}] Vacuum excluded by white/blacklist`);
      return null;
    }

    await platform.registerDevice(vacuum);
    this.log.info(`Registered vacuum: ${device.name}`);

    return vacuum;
  }

  private setupCommandHandlers(vacuum: RoboticVacuumCleaner, client: DreameVacuumClient, did: string): void {
    vacuum.addCommandHandler('RvcOperationalState.goHome', async () => {
      this.log.info(`[${did}] goHome command received`);
      try { await client.returnToDock(); } catch (err) { this.log.error(`[${did}] goHome failed: ${err}`); throw err; }
    });

    vacuum.addCommandHandler('RvcOperationalState.resume', async () => {
      this.log.info(`[${did}] resume command received`);
      try { await client.resume(); } catch (err) { this.log.error(`[${did}] resume failed: ${err}`); throw err; }
    });

    vacuum.addCommandHandler('RvcOperationalState.pause', async () => {
      this.log.info(`[${did}] pause command received`);
      try { await client.pause(); } catch (err) { this.log.error(`[${did}] pause failed: ${err}`); throw err; }
    });

    vacuum.addCommandHandler('ServiceArea.selectAreas', async ({ request }: { request: { newAreas?: unknown[] } }) => {
      const areaIds = request.newAreas?.map((a: unknown) => String(a)) || [];
      this.log.info(`[${did}] selectAreas: ${JSON.stringify(areaIds)}`);
      try { await client.selectAreas(areaIds); } catch (err) { this.log.error(`[${did}] selectAreas failed: ${err}`); throw err; }
    });

    vacuum.addCommandHandler('RvcRunMode.changeToMode', async ({ request }: { request: { newMode: number } }) => {
      const mode = request.newMode;
      this.log.info(`[${did}] changeToMode: ${mode}`);
      try {
        if (mode === 0) {
          await client.stop();
        } else if (mode === 1) {
          const selected = await client.getSelectedAreas();
          if (selected.length > 0) {
            await client.startCleaningAreas(selected);
          } else {
            await client.start();
          }
        } else if (mode === 2) {
          await client.startMapping();
        }
      } catch (err) { this.log.error(`[${did}] changeToMode failed: ${err}`); throw err; }
    });

    vacuum.addCommandHandler('RvcCleanMode.changeToMode', async ({ request }: { request: { newMode: number } }) => {
      const mode = request.newMode;
      const modeMap: Record<number, CleanMode> = {
        0: CleanMode.Vacuum,
        1: CleanMode.Mop,
        2: CleanMode.VacuumThenMop,
      };
      if (modeMap[mode]) {
        try { await client.setCleanMode(modeMap[mode]!); } catch (err) { this.log.error(`[${did}] setCleanMode failed: ${err}`); throw err; }
      }
    });
  }

  private setupEventListeners(vacuum: RoboticVacuumCleaner, client: DreameVacuumClient, did: string): void {
    let lastMopPresent: boolean | null = null;

    client.on('statusChange', async (status) => {
      if (this.verbose) {
        this.log.info(`[${did}] Status: state=${status.state}, battery=${status.batteryLevel}%`);
      }

      if (status.batteryLevel !== undefined) {
        try {
          await vacuum.setAttribute('PowerSource', 'batPercentRemaining', Math.floor((status.batteryLevel / 100) * 200));
        } catch (err) {
          this.log.debug(`[${did}] Could not update battery: ${err}`);
        }
      }

      if (status.state !== undefined) {
        try {
          await vacuum.setAttribute('RvcOperationalState', 'operationalState', this.mapState(status.state));
        } catch (err) {
          this.log.debug(`[${did}] Could not update operational state: ${err}`);
        }
      }

      const mopMissing = status.errorCode === VacuumErrorCode.MopPadMissing;
      const waterMissing = status.errorCode === VacuumErrorCode.WaterTankMissing || status.errorCode === VacuumErrorCode.WaterTankEmpty;
      const currentMopPresent = !mopMissing && !waterMissing;

      if (lastMopPresent !== null && lastMopPresent !== currentMopPresent) {
        this.log.info(`[${did}] Mop pad ${currentMopPresent ? 'detected' : 'removed'} — reconfiguring modes`);
        await this.detectAndConfigureMopCapabilities(did, client, vacuum);
      }
      lastMopPresent = currentMopPresent;
    });

    client.on('stateChange', async (state: VacuumState) => {
      this.log.info(`[${did}] State changed: ${state}`);
      try {
        await vacuum.setAttribute('RvcOperationalState', 'operationalState', this.mapState(state));
      } catch (err) {
        this.log.error(`[${did}] Failed to update state: ${err}`);
      }
    });

    client.on('error', (err: Error) => { this.log.error(`[${did}] Vacuum error: ${err}`); });
    client.on('connected', () => { this.log.info(`[${did}] Vacuum client connected`); });
    client.on('disconnected', () => { this.log.warn(`[${did}] Vacuum client disconnected`); });
  }

  private mapState(state: VacuumState): number {
    const map: Record<VacuumState, number> = {
      [VacuumState.Idle]: 0x00,
      [VacuumState.Cleaning]: 0x01,
      [VacuumState.Mapping]: 0x01,
      [VacuumState.Returning]: 0x40,
      [VacuumState.Docked]: 0x42,
      [VacuumState.Paused]: 0x02,
      [VacuumState.Error]: 0x03,
    };
    return map[state] ?? 0x00;
  }

  private async detectAndConfigureMopCapabilities(did: string, client: DreameVacuumClient, vacuum: RoboticVacuumCleaner): Promise<void> {
    try {
      const status = await client.getStatus();
      const supportedModes = await client.getSupportedCleanModes();
      const mopMissing = status.errorCode === VacuumErrorCode.MopPadMissing;
      const waterMissing = status.errorCode === VacuumErrorCode.WaterTankMissing || status.errorCode === VacuumErrorCode.WaterTankEmpty;
      const hasMop = status.waterLevel && status.waterLevel !== 'off';

      let configuredModes: CleanMode[];
      if (mopMissing || waterMissing) {
        configuredModes = [CleanMode.Vacuum];
      } else if (hasMop || supportedModes.includes(CleanMode.Mop)) {
        configuredModes = supportedModes;
      } else {
        configuredModes = supportedModes;
      }

      const modeLabels: Record<CleanMode, string> = {
        [CleanMode.Vacuum]: 'Vacuum',
        [CleanMode.Mop]: 'Mop',
        [CleanMode.VacuumThenMop]: 'Vacuum + Mop',
      };

      const cleanModeOptions = configuredModes.map((mode, index) => ({
        label: modeLabels[mode] || mode,
        mode: index,
        modeTags: [{ value: index + 1 }],
      }));

      try {
        vacuum.createDefaultRvcCleanModeClusterServer(0, cleanModeOptions);
      } catch (err) {
        this.log.debug(`[${did}] Could not update clean modes: ${err}`);
      }
    } catch (err) {
      this.log.warn(`[${did}] Could not detect mop capabilities: ${err}`);
    }
  }

  private async displayVerboseInfo(device: DeviceInfo, client: DreameVacuumClient, maps: VacuumMap[], areas: Area[], supportedAreas: { areaId: number }[]): Promise<void> {
    this.log.info(`\n${'='.repeat(80)}`);
    this.log.info(`VERBOSE MODE — ${device.name}`);
    this.log.info(`${'='.repeat(80)}\n`);

    try {
      const info = await client.getInfo();
      this.log.info(`Model: ${info.model} | FW: ${info.firmwareVersion} | SN: ${info.serialNumber}`);
    } catch (_err) { /* non-fatal */ }

    try {
      const status = await client.getStatus();
      this.log.info(`State: ${status.state} | Battery: ${status.batteryLevel}% | Clean: ${status.cleanMode}`);
    } catch (_err) { /* non-fatal */ }

    this.log.info(`Maps: ${maps.length} | Areas: ${areas.length} | Matter areas: ${supportedAreas.length}`);
    this.log.info(`${'='.repeat(80)}\n`);
  }
}
