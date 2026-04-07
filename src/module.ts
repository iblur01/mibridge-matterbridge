/**
 * Matterbridge Xiaomi Wrapper plugin.
 *
 * @file module.ts
 * @author Théo DELANNOY
 * @license Apache-2.0
 */

import { Area, CleanMode, DeviceInfo, DreameVacuumClient, Session, VacuumErrorCode, VacuumMap, VacuumState } from '@mibridge/core';
import { MatterbridgeDynamicPlatform, PlatformConfig, PlatformMatterbridge } from 'matterbridge';
import { RoboticVacuumCleaner } from 'matterbridge/devices';
import { AnsiLogger, LogLevel } from 'matterbridge/logger';

import { XiaomiVacuumService } from './xiaomiService.js';

/**
 * Matterbridge plugin entry point — instantiates and returns the platform.
 *
 * @param {PlatformMatterbridge} matterbridge - The Matterbridge instance.
 * @param {AnsiLogger} log - The logger instance provided by Matterbridge.
 * @param {PlatformConfig} config - The plugin configuration from the Matterbridge frontend.
 * @returns {MibridgePlatform} The initialized platform instance.
 */
export default function initializePlugin(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig): MibridgePlatform {
  return new MibridgePlatform(matterbridge, log, config);
}

export class MibridgePlatform extends MatterbridgeDynamicPlatform {
  private xiaomiService: XiaomiVacuumService | null = null;
  private vacuumClients: Map<string, DreameVacuumClient> = new Map();
  private verbose = false;

  constructor(matterbridge: PlatformMatterbridge, log: AnsiLogger, config: PlatformConfig) {
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

    // Check if Xiaomi session is configured
    const sessionConfig = this.config.session as Omit<Session, 'savedAt'> | undefined;
    if (!sessionConfig || !sessionConfig.userId || !sessionConfig.ssecurity || !sessionConfig.serviceToken) {
      this.log.error('Xiaomi session not configured. Please configure session tokens in plugin settings.');
      return;
    }

    const session: Session = { ...sessionConfig, savedAt: '2024-01-01T00:00:00.000Z' };

    try {
      // Initialize Xiaomi service
      this.xiaomiService = new XiaomiVacuumService(this.log, {
        session,
        region: (this.config.region as string) ?? 'de',
        pollInterval: (this.config.pollInterval as number) ?? 5000,
      });

      await this.xiaomiService.connect();
      await this.discoverDevices();
    } catch (error) {
      this.log.error(`Failed to initialize Xiaomi service: ${error}`);
    }
  }

  override async onConfigure() {
    await super.onConfigure();
    this.log.info('onConfigure called');
  }

  override async onChangeLoggerLevel(logLevel: LogLevel) {
    this.log.info(`onChangeLoggerLevel called with: ${logLevel}`);
  }

  override async onShutdown(reason?: string) {
    await super.onShutdown(reason);
    this.log.info(`onShutdown called with reason: ${reason ?? 'none'}`);

    // Disconnect Xiaomi service
    if (this.xiaomiService) {
      await this.xiaomiService.disconnect();
      this.xiaomiService = null;
    }

    this.vacuumClients.clear();

    if (this.config.unregisterOnShutdown === true) await this.unregisterAllDevices();
  }

  private async discoverDevices() {
    if (!this.xiaomiService) {
      this.log.error('Xiaomi service not initialized');
      return;
    }

    this.log.info('Discovering Xiaomi vacuum devices...');
    const vacuums = this.xiaomiService.getVacuums();

    if (vacuums.length === 0) {
      this.log.warn('No Xiaomi vacuum devices found');
      return;
    }

    this.log.info(`Found ${vacuums.length} vacuum(s)`);

    for (const device of vacuums) {
      try {
        this.log.info(`Setting up vacuum: ${device.name} (${device.model}) - DID: ${device.did}`);

        // Get Xiaomi client and connect first
        const client = await this.xiaomiService.connectVacuum(device.did);
        this.vacuumClients.set(device.did, client);

        // Load maps and areas from the vacuum
        this.log.info(`[${device.did}] Loading maps and areas...`);
        const maps = await client.getMaps();
        this.log.info(`[${device.did}] Found ${maps.length} map(s)`);

        const areas = maps.length > 0 ? maps[0].areas : [];
        this.log.info(`[${device.did}] Found ${areas.length} area(s): ${areas.map((a) => a.name).join(', ')}`);

        // Prepare service areas for Matter
        const supportedAreas = areas.map((area, index) => ({
          areaId: parseInt(area.id) || index + 1,
          mapId: area.mapId ? parseInt(area.mapId) : null,
          areaInfo: {
            locationInfo: {
              locationName: area.name,
              floorNumber: null,
              areaType: null,
            },
            landmarkInfo: null,
          },
        }));

        const supportedMaps = maps.map((map) => ({
          mapId: parseInt(map.id) || 1,
          name: map.name,
        }));

        // Create Matterbridge device with areas
        // Each vacuum uses 'server' mode so Apple Home assigns it its own child bridge
        const vacuum = new RoboticVacuumCleaner(
          device.name,
          device.did,
          'server', // deviceType: gives each vacuum its own child bridge / QR code in Apple Home
          1, // currentRunMode (Idle)
          undefined, // supportedRunModes (defaults)
          1, // currentCleanMode (Vacuum)
          undefined, // supportedCleanModes (defaults)
          null, // currentPhase
          null, // phaseList
          0x42, // operationalState (Docked)
          undefined, // operationalStateList (defaults)
          supportedAreas, // areas
          [], // selectedAreas
          supportedAreas.length > 0 ? supportedAreas[0].areaId : 1, // currentArea
          supportedMaps.length > 0 ? supportedMaps : undefined, // maps
        );

        this.log.info(`[${device.did}] Created vacuum with ${supportedAreas.length} area(s)`);

        // Detect mop pad presence and adjust supported clean modes
        await this.detectAndConfigureMopCapabilities(device.did, client, vacuum);

        // Verbose mode: Display detailed information
        if (this.verbose) {
          await this.displayVerboseInfo(device, client, maps, areas, supportedAreas);
        }

        // Setup command handlers
        this.setupCommandHandlers(vacuum, client, device.did);

        // Setup event listeners for state sync
        this.setupEventListeners(vacuum, client, device.did);

        // Add to device selection
        this.setSelectDevice(device.did, device.name);
        const selected = this.validateDevice([device.name, device.did]);

        if (selected) {
          await this.registerDevice(vacuum);
          this.log.info(`Registered vacuum: ${device.name}`);
        }
      } catch (error) {
        this.log.error(`Failed to setup vacuum ${device.name}: ${error}`);
      }
    }
  }

  private setupCommandHandlers(vacuum: RoboticVacuumCleaner, client: DreameVacuumClient, did: string) {
    // Command: Go Home (Return to dock)
    vacuum.addCommandHandler('RvcOperationalState.goHome', async () => {
      this.log.info(`[${did}] goHome command received`);
      try {
        await client.returnToDock();
        this.log.info(`[${did}] Vacuum is returning to dock`);
      } catch (error) {
        this.log.error(`[${did}] Failed to return to dock: ${error}`);
        throw error;
      }
    });

    // Command: Resume (Start/Resume cleaning)
    vacuum.addCommandHandler('RvcOperationalState.resume', async () => {
      this.log.info(`[${did}] resume command received`);
      try {
        await client.resume();
        this.log.info(`[${did}] Vacuum is resuming cleaning`);
      } catch (error) {
        this.log.error(`[${did}] Failed to resume: ${error}`);
        throw error;
      }
    });

    // Command: Pause
    vacuum.addCommandHandler('RvcOperationalState.pause', async () => {
      this.log.info(`[${did}] pause command received`);
      try {
        await client.pause();
        this.log.info(`[${did}] Vacuum is paused`);
      } catch (error) {
        this.log.error(`[${did}] Failed to pause: ${error}`);
        throw error;
      }
    });

    // Command: Select Areas (zones to clean)
    vacuum.addCommandHandler('ServiceArea.selectAreas', async ({ request }) => {
      const areaIds = request.newAreas?.map((a: unknown) => String(a)) || [];
      this.log.info(`[${did}] selectAreas command received: ${JSON.stringify(areaIds)}`);
      try {
        await client.selectAreas(areaIds);
        this.log.info(`[${did}] Selected ${areaIds.length} area(s)`);
      } catch (error) {
        this.log.error(`[${did}] Failed to select areas: ${error}`);
        throw error;
      }
    });

    // Command: Start Cleaning (with selected areas)
    vacuum.addCommandHandler('RvcRunMode.changeToMode', async ({ request }) => {
      const mode = request.newMode;
      this.log.info(`[${did}] changeToMode command received: mode ${mode}`);

      try {
        // Mode 0 = Idle, Mode 1 = Cleaning, Mode 2 = Mapping
        if (mode === 0) {
          // Idle - stop cleaning
          await client.stop();
          this.log.info(`[${did}] Stopped cleaning`);
        } else if (mode === 1) {
          // Cleaning mode - start cleaning selected areas
          const selectedAreas = await client.getSelectedAreas();
          if (selectedAreas.length > 0) {
            this.log.info(`[${did}] Starting cleaning of ${selectedAreas.length} area(s): ${selectedAreas.join(', ')}`);
            await client.startCleaningAreas(selectedAreas);
          } else {
            this.log.info(`[${did}] Starting full cleaning (no areas selected)`);
            await client.start();
          }
          this.log.info(`[${did}] Cleaning started`);
        } else if (mode === 2) {
          // Mapping mode
          this.log.info(`[${did}] Starting mapping`);
          await client.startMapping();
        }
      } catch (error) {
        this.log.error(`[${did}] Failed to change mode: ${error}`);
        throw error;
      }
    });

    // Command: Change Clean Mode (vacuum/mop/both)
    vacuum.addCommandHandler('RvcCleanMode.changeToMode', async ({ request }) => {
      const mode = request.newMode;
      this.log.info(`[${did}] changeToMode (clean mode) received: mode ${mode}`);

      try {
        // Mode 0 = Vacuum, Mode 1 = Mop, Mode 2 = VacuumThenMop
        const modeMap: Record<number, CleanMode> = {
          0: CleanMode.Vacuum,
          1: CleanMode.Mop,
          2: CleanMode.VacuumThenMop,
        };

        if (modeMap[mode]) {
          await client.setCleanMode(modeMap[mode]);
          this.log.info(`[${did}] Clean mode set to ${modeMap[mode]}`);
        }
      } catch (error) {
        this.log.error(`[${did}] Failed to change clean mode: ${error}`);
        throw error;
      }
    });
  }

  private setupEventListeners(vacuum: RoboticVacuumCleaner, client: DreameVacuumClient, did: string) {
    // Track mop presence state
    let lastMopPresent: boolean | null = null;

    // Listen for status changes
    client.on('statusChange', async (status) => {
      if (this.verbose) {
        this.log.info(`[${did}] Status update: state=${status.state}, battery=${status.batteryLevel}%, cleanMode=${status.cleanMode}, runMode=${status.runMode}`);
      } else {
        this.log.debug(`[${did}] Status update: ${JSON.stringify(status)}`);
      }

      // Update battery level
      if (status.batteryLevel !== undefined) {
        try {
          // Battery percentage in Matter is 0-200 representing 0-100%
          const batPercent = Math.floor((status.batteryLevel / 100) * 200);
          await vacuum.setAttribute('PowerSource', 'batPercentRemaining', batPercent);
          if (this.verbose) {
            this.log.info(`[${did}] Battery level: ${status.batteryLevel}% (Matter: ${batPercent}/200)`);
          } else {
            this.log.debug(`[${did}] Battery level updated: ${status.batteryLevel}%`);
          }
        } catch (error) {
          this.log.debug(`[${did}] Could not update battery level: ${error}`);
        }
      }

      // Update operational state based on vacuum state
      if (status.state !== undefined) {
        try {
          const operationalState = this.mapVacuumStateToMatter(status.state);
          await vacuum.setAttribute('RvcOperationalState', 'operationalState', operationalState);
          if (this.verbose) {
            this.log.info(`[${did}] Operational state: ${status.state} -> Matter 0x${operationalState.toString(16).padStart(2, '0').toUpperCase()}`);
          } else {
            this.log.debug(`[${did}] Operational state updated: ${operationalState}`);
          }
        } catch (error) {
          this.log.debug(`[${did}] Could not update operational state: ${error}`);
        }
      }

      // Detect mop pad changes
      const mopMissing = status.errorCode === VacuumErrorCode.MopPadMissing;
      const waterMissing = status.errorCode === VacuumErrorCode.WaterTankMissing || status.errorCode === VacuumErrorCode.WaterTankEmpty;
      const currentMopPresent = !mopMissing && !waterMissing;

      if (lastMopPresent !== null && lastMopPresent !== currentMopPresent) {
        if (currentMopPresent) {
          this.log.info(`[${did}] Mop pad detected - Reconfiguring available modes`);
        } else {
          this.log.info(`[${did}] Mop pad removed - Switching to vacuum-only mode`);
        }
        // Reconfigure mop capabilities
        await this.detectAndConfigureMopCapabilities(did, client, vacuum);
      }
      lastMopPresent = currentMopPresent;
    });

    // Listen for state changes
    client.on('stateChange', async (state) => {
      if (this.verbose) {
        this.log.info(`[${did}] State changed to: ${state.toUpperCase()}`);
      } else {
        this.log.info(`[${did}] State changed to: ${state}`);
      }

      // Update Matter operational state
      try {
        const operationalState = this.mapVacuumStateToMatter(state);
        await vacuum.setAttribute('RvcOperationalState', 'operationalState', operationalState);
        if (this.verbose) {
          this.log.info(`[${did}] Matter state synchronized: 0x${operationalState.toString(16).padStart(2, '0').toUpperCase()}`);
        } else {
          this.log.info(`[${did}] Matter state updated to: ${operationalState}`);
        }
      } catch (error) {
        this.log.error(`[${did}] Failed to update Matter state: ${error}`);
      }
    });

    // Listen for errors
    client.on('error', (error) => {
      this.log.error(`[${did}] Vacuum error: ${error}`);
    });

    // Log when connected
    client.on('connected', () => {
      this.log.info(`[${did}] Vacuum client connected`);
    });

    // Log when disconnected
    client.on('disconnected', () => {
      this.log.warn(`[${did}] Vacuum client disconnected`);
    });
  }

  // Map Xiaomi vacuum state to Matter operational state
  private mapVacuumStateToMatter(state: VacuumState): number {
    // Matter RVC Operational State values:
    // 0x00 = Stopped, 0x01 = Running, 0x02 = Paused, 0x03 = Error
    // 0x40 = SeekingCharger, 0x41 = Charging, 0x42 = Docked
    const stateMap: Record<VacuumState, number> = {
      [VacuumState.Idle]: 0x00, // Stopped
      [VacuumState.Cleaning]: 0x01, // Running
      [VacuumState.Mapping]: 0x01, // Running (mapping)
      [VacuumState.Returning]: 0x40, // SeekingCharger
      [VacuumState.Docked]: 0x42, // Docked
      [VacuumState.Paused]: 0x02, // Paused
      [VacuumState.Error]: 0x03, // Error
    };

    return stateMap[state] ?? 0x00;
  }

  // Detect mop pad and water tank presence to configure supported clean modes
  private async detectAndConfigureMopCapabilities(did: string, client: DreameVacuumClient, vacuum: RoboticVacuumCleaner) {
    try {
      const status = await client.getStatus();
      const supportedModes = await client.getSupportedCleanModes();

      // Check if mop pad or water tank is missing
      const mopMissing = status.errorCode === VacuumErrorCode.MopPadMissing;
      const waterMissing = status.errorCode === VacuumErrorCode.WaterTankMissing || status.errorCode === VacuumErrorCode.WaterTankEmpty;

      // Check water level to infer mop presence
      const hasMop = status.waterLevel && status.waterLevel !== 'off';

      let configuredModes: CleanMode[] = [];
      let modeDescription = '';

      if (mopMissing || waterMissing) {
        // Mop/Water tank missing: Only vacuum mode available
        configuredModes = [CleanMode.Vacuum];
        modeDescription = 'Vacuum only (serpillière non détectée)';
        this.log.info(`[${did}] Mop pad or water tank not detected - Vacuum mode only`);
      } else if (hasMop || supportedModes.includes(CleanMode.Mop)) {
        // Mop present: All modes available
        configuredModes = supportedModes;
        modeDescription = `Tous les modes (${supportedModes.length}): ${supportedModes.join(', ')}`;
        this.log.info(`[${did}] Mop pad detected - All modes available: ${supportedModes.join(', ')}`);
      } else {
        // Default: Use all supported modes
        configuredModes = supportedModes;
        modeDescription = `Modes par défaut (${supportedModes.length}): ${supportedModes.join(', ')}`;
        this.log.info(`[${did}] Using default supported modes: ${supportedModes.join(', ')}`);
      }

      // Create clean mode options for Matter
      const cleanModeOptions = configuredModes.map((mode, index) => {
        const modeLabels: Record<CleanMode, string> = {
          [CleanMode.Vacuum]: 'Vacuum',
          [CleanMode.Mop]: 'Mop',
          [CleanMode.VacuumThenMop]: 'Vacuum + Mop',
        };

        return {
          label: modeLabels[mode] || mode,
          mode: index,
          modeTags: [{ value: index + 1 }],
        };
      });

      // Update the vacuum's supported clean modes
      try {
        vacuum.createDefaultRvcCleanModeClusterServer(0, cleanModeOptions);
        this.log.info(`[${did}] Clean modes configured: ${modeDescription}`);
      } catch (error) {
        this.log.debug(`[${did}] Could not update clean modes (device may already be configured): ${error}`);
      }

      // Store configuration for verbose logging
      if (this.verbose) {
        this.log.info(`[${did}] Mop Detection Results:`);
        this.log.info(`     - Error Code: ${status.errorCode}`);
        this.log.info(`     - Water Level: ${status.waterLevel || 'off'}`);
        this.log.info(`     - Mop Present: ${!mopMissing && !waterMissing ? 'Yes' : 'No'}`);
        this.log.info(`     - Configured Modes: ${configuredModes.join(', ')}`);
      }
    } catch (error) {
      this.log.warn(`[${did}] Could not detect mop capabilities: ${error}`);
      this.log.info(`[${did}] Using default clean modes`);
    }
  }

  // Display detailed information in verbose mode
  private async displayVerboseInfo(device: DeviceInfo, client: DreameVacuumClient, maps: VacuumMap[], areas: Area[], supportedAreas: { areaId: number }[]) {
    this.log.info(`\n${'='.repeat(80)}`);
    this.log.info(`VERBOSE MODE - Detailed Information for ${device.name}`);
    this.log.info(`${'='.repeat(80)}\n`);

    // Device Info
    try {
      const info = await client.getInfo();
      this.log.info(`Device Information:`);
      this.log.info(`   Model:           ${info.model}`);
      this.log.info(`   Firmware:        ${info.firmwareVersion}`);
      this.log.info(`   Serial Number:   ${info.serialNumber}`);
      this.log.info(`   Device ID (DID): ${device.did}`);
      this.log.info(``);
    } catch (error) {
      this.log.warn(`   Could not retrieve device info: ${error}`);
    }

    // Status
    try {
      const status = await client.getStatus();
      this.log.info(`Current Status:`);
      this.log.info(`   State:           ${status.state}`);
      this.log.info(`   Run Mode:        ${status.runMode}`);
      this.log.info(`   Clean Mode:      ${status.cleanMode}`);
      this.log.info(`   Battery Level:   ${status.batteryLevel}%`);
      if (status.waterLevel) {
        this.log.info(`   Water Level:     ${status.waterLevel}`);
      }
      if (status.errorCode && status.errorCode !== 'none') {
        this.log.info(`   Error:           ${status.errorCode}`);
      }
      if (status.currentAreaId) {
        this.log.info(`   Current Area:    ${status.currentAreaId}`);
      }
      this.log.info(``);
    } catch (error) {
      this.log.warn(`   Could not retrieve status: ${error}`);
    }

    // Maps
    this.log.info(`Maps (${maps.length}):`);
    if (maps.length > 0) {
      maps.forEach((map, index) => {
        this.log.info(`   ${index + 1}. "${map.name}" (ID: ${map.id})`);
        this.log.info(`      - Areas: ${map.areas?.length || 0}`);
      });
    } else {
      this.log.info(`   No maps found. Create a map in Xiaomi Home app first.`);
    }
    this.log.info(``);

    // Areas/Rooms
    this.log.info(`Rooms/Areas (${areas.length}):`);
    if (areas.length > 0) {
      areas.forEach((area, index) => {
        this.log.info(`   ${index + 1}. "${area.name}"`);
        this.log.info(`      - Area ID: ${area.id}`);
        if (area.mapId) {
          this.log.info(`      - Map ID: ${area.mapId}`);
        }
      });
      this.log.info(``);
      this.log.info(`   These ${areas.length} room(s) are now available in HomeKit`);
    } else {
      this.log.info(`   No rooms/areas found.`);
      this.log.info(`   Create rooms in Xiaomi Home app to use zone cleaning.`);
    }
    this.log.info(``);

    // Supported Clean Modes
    try {
      const supportedCleanModes = await client.getSupportedCleanModes();
      this.log.info(`Supported Clean Modes (${supportedCleanModes.length}):`);
      supportedCleanModes.forEach((mode, index) => {
        const modeNames: Record<string, string> = {
          vacuum: 'Vacuum (Aspiration seule)',
          mop: 'Mop (Serpilliere seule)',
          vacuumThenMop: 'Vacuum + Mop (Aspiration puis serpilliere)',
        };
        this.log.info(`   ${index + 1}. ${modeNames[mode] || mode}`);
      });
      this.log.info(``);
    } catch (_error) {
      this.log.info(`Supported Clean Modes:`);
      this.log.info(`   Default: Vacuum, Mop, Vacuum+Mop`);
      this.log.info(``);
    }

    // Current settings
    try {
      const cleanMode = await client.getCleanMode();
      const runMode = await client.getRunMode();

      this.log.info(`Current Settings:`);
      this.log.info(`   Run Mode:   ${runMode}`);
      this.log.info(`   Clean Mode: ${cleanMode}`);
      this.log.info(``);
    } catch (_error) {
      // Ignore if can't get current settings
    }

    // Matter mapping
    this.log.info(`Matter Integration:`);
    this.log.info(
      `   Operational State: ${this.mapVacuumStateToMatter(VacuumState.Docked)} (0x${this.mapVacuumStateToMatter(VacuumState.Docked).toString(16).padStart(2, '0').toUpperCase()})`,
    );
    this.log.info(`   Service Areas:     ${supportedAreas.length} area(s) configured`);
    this.log.info(`   Commands:          goHome, resume, pause, selectAreas, changeToMode`);
    this.log.info(``);

    // Connection info
    this.log.info(`Connection:`);
    this.log.info(`   Xiaomi Cloud:  Connected`);
    this.log.info(`   Poll Interval: ${this.config.pollInterval || 5000}ms`);
    this.log.info(`   Region:        ${this.config.region || 'de'}`);
    this.log.info(``);

    this.log.info(`${'='.repeat(80)}\n`);
  }
}
