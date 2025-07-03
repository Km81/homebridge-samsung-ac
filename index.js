// Samsung Air Conditioner Homebridge Plugin
// Version 2.0.3 (Converted to Platform with Feature Enhancements)
'use strict';

const tls = require('tls');
const fs = require('fs');
const { constants } = require('crypto');

let HAP;

const PLUGIN_NAME = 'homebridge-samsung-ac';
const PLATFORM_NAME = 'SamsungACPlatform';

const CONSTANTS = {
    API_PORT: 8888,
    API_DEVICES_PATH: '/devices',
    PLUGIN_VERSION: '2.0.3',
    DEFAULT_RETRY_ATTEMPTS: 3,
    DEFAULT_CACHE_DURATION_MS: 30000,
    DEFAULT_TIMEOUT_MS: 5000,
    POWER: { ON: 'On', OFF: 'Off' },
    SWING: { UP_DOWN: 'Up_And_Low', FIX: 'Fix' },
    COMFORT: { NANO_ON: 'Comode_Nano', NANO_OFF: 'Comode_Off' },
    AUTOCLEAN: { ON: 'Autoclean_On', OFF: 'Autoclean_Off' },
    MODE: { COOL: 'Cool', DRY: 'Dry', WIND: 'Wind', AUTO: 'Auto' }
};

// =========================================================================
// === 클래스 정의 (오류 수정을 위해 순서 조정) ===
// =========================================================================

class SwingModeHandler {
    constructor(type) {
        this.type = type;
    }
    getValue(state) {
        if (!state) return false;
        if (this.type === 'wind') {
            return state.Wind?.direction === CONSTANTS.SWING.UP_DOWN;
        }
        return state.Mode?.options?.includes(CONSTANTS.COMFORT.NANO_ON);
    }
    getCommand(enable) {
        if (this.type === 'wind') {
            const dir = enable ? CONSTANTS.SWING.UP_DOWN : CONSTANTS.SWING.FIX;
            return { endpoint: '/wind', data: { direction: dir } };
        }
        const opt = enable ? CONSTANTS.COMFORT.NANO_ON : CONSTANTS.COMFORT.NANO_OFF;
        return { endpoint: '/mode', data: { options: [opt] } };
    }
}

class ApiClient {
    constructor(ip, token, log, options) {
        this.ip = ip;
        this.token = token;
        this.log = log;
        this.timeout = options.timeout;

        this.tlsOptions = {
            host: this.ip,
            port: CONSTANTS.API_PORT,
            cert: fs.readFileSync(options.certPath),
            key: fs.readFileSync(options.keyPath),
            rejectUnauthorized: false,
            honorCipherOrder: true,
            ciphers: 'DEFAULT@SECLEVEL=0',
            minVersion: 'TLSv1',
            maxVersion: 'TLSv1',
            secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT,
        };
    }

    async getDeviceStatus() {
        return await this._request('GET', CONSTANTS.API_DEVICES_PATH);
    }

    async sendCommand(index, endpoint, data) {
        await this._request('PUT', `/devices/${index}${endpoint}`, data);
    }

    async _request(method, path, data = null, retries = CONSTANTS.DEFAULT_RETRY_ATTEMPTS) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await this._rawRequest(path, method, data);
            } catch (e) {
                if (attempt === retries) {
                    this.log.error(`[ApiClient] 최종 요청 실패 (${attempt}회 시도): ${e.message}`);
                    throw e;
                }
                this.log.warn(`[ApiClient] 요청 실패, 재시도 ${attempt}/${retries}... (${e.message})`);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }

    _rawRequest(path, method, data) {
        return new Promise((resolve, reject) => {
            const jsonData = data ? JSON.stringify(data) : '';
            const requestData = [
                `${method} ${path} HTTP/1.1`, `Host: ${this.ip}`, `Authorization: Bearer ${this.token}`,
                'Content-Type: application/json', `Content-Length: ${Buffer.byteLength(jsonData)}`,
                'Connection: close', '', jsonData
            ].join('\r\n');

            const socket = tls.connect(this.tlsOptions, () => socket.write(requestData));

            let responseChunks = '';
            socket.setEncoding('utf8');
            socket.on('data', chunk => { responseChunks += chunk; });

            socket.on('end', () => {
                try {
                    if (responseChunks.includes('HTTP/1.1 204 No Content')) return resolve({});
                    const bodySeparator = '\r\n\r\n';
                    const bodyIndex = responseChunks.indexOf(bodySeparator);
                    if (bodyIndex === -1) return reject(new Error('HTTP 본문 구분자를 찾을 수 없습니다.'));

                    const body = responseChunks.slice(bodyIndex + bodySeparator.length).trim();
                    if (!body) return resolve({});

                    resolve(JSON.parse(body));
                } catch (e) {
                    reject(new Error(`응답 처리 실패: ${e.message}, 응답: "${responseChunks}"`));
                } finally {
                    if (!socket.destroyed) socket.destroy();
                }
            });

            socket.setTimeout(this.timeout, () => {
                socket.destroy();
                reject(new Error(`요청 시간 초과 (${this.timeout}ms)`));
            });

            socket.on('error', err => {
                if (!socket.destroyed) socket.destroy();
                reject(new Error(`TLS 소켓 오류: ${err.message}`));
            });
        });
    }
}

class SamsungACLogic {
    constructor(log, config, api, accessory) {
        this.log = log;
        this.config = config;
        this.accessory = accessory;
        this.Service = api.hap.Service;
        this.Characteristic = api.hap.Characteristic;

        this.name = this.config.name;
        this.deviceIndex = this.config.deviceIndex ?? 0;
        this.setDeviceIndex = this.config.setDeviceIndex ?? this.deviceIndex;
        this.swingModeType = this.config.swingModeType ?? 'comfort';
        this.cacheDuration = this.config.cacheDuration ?? CONSTANTS.DEFAULT_CACHE_DURATION_MS;
        this.timeout = this.config.timeout ?? CONSTANTS.DEFAULT_TIMEOUT_MS;
        this.pollingInterval = this.config.pollingInterval;
        this.minTemp = this.config.minTemp ?? 18;
        this.maxTemp = this.config.maxTemp ?? 30;
        this.debugMode = this.config.debug === true;

        const defaultCertPath = `${api.user.storagePath()}/cert.pem`;
        const certPath = this.config.certPath || defaultCertPath;
        const keyPath = this.config.keyPath || certPath;
        
        // 이 부분에서 오류가 발생했었습니다. SwingModeHandler가 먼저 정의되어야 합니다.
        this.swingModeHandler = new SwingModeHandler(this.swingModeType);

        this.client = new ApiClient(this.config.ip, this.config.token, this.log, {
            timeout: this.timeout, certPath, keyPath
        });

        this.deviceState = null;
        this.lastStateUpdate = 0;
        this.stateRequestPromise = null;

        this.aircoService = this.accessory.getService(this.Service.HeaterCooler) || this.accessory.addService(this.Service.HeaterCooler, this.name);
        this.accessory.getService(this.Service.AccessoryInformation)
            .setCharacteristic(this.Characteristic.Manufacturer, this.config.manufacturer || 'Samsung')
            .setCharacteristic(this.Characteristic.Model, this.config.model || 'AC-Model')
            .setCharacteristic(this.Characteristic.SerialNumber, this.config.serialNumber || this.name)
            .setCharacteristic(this.Characteristic.FirmwareRevision, CONSTANTS.PLUGIN_VERSION);

        this.setupCharacteristics();
        this.startPolling();
        this.log.info(`[${this.name}] 초기화 완료.`);
    }

    debugLog(message) { if (this.debugMode) this.log.info(message); }

    startPolling() {
        if (this.pollingInterval > 0) {
            this.log.info(`[${this.name}] ${this.pollingInterval}초 간격으로 상태 폴링을 시작합니다.`);
            setInterval(() => {
                this.debugLog(`[${this.name}] 주기적인 상태 업데이트 실행...`);
                this.getCachedState(true).catch(e => this.log.error(`[${this.name}] 폴링 실패:`, e.message));
            }, this.pollingInterval * 1000);
        }
    }

    async getCachedState(force = false) {
        const now = Date.now();
        if (!force && this.deviceState && (now - this.lastStateUpdate < this.cacheDuration)) {
            this.debugLog(`[${this.name}] 캐시된 상태 사용`);
            return this.deviceState;
        }
        if (this.stateRequestPromise) {
            this.debugLog(`[${this.name}] 진행 중인 요청에 합류합니다.`);
            return await this.stateRequestPromise;
        }
        this.debugLog(`[${this.name}] 장치에서 새 상태를 가져옵니다.`);
        this.stateRequestPromise = (async () => {
            try {
                const response = await this.client.getDeviceStatus();
                if (!response?.Devices?.[this.deviceIndex]) throw new Error(`API 응답에 장치(index: ${this.deviceIndex})가 없습니다.`);
                this.deviceState = response.Devices[this.deviceIndex];
                this.lastStateUpdate = Date.now();
                return this.deviceState;
            } catch (e) {
                this.log.error(`[${this.name}] 상태 가져오기 오류: ${e.message}`); throw e;
            } finally { this.stateRequestPromise = null; }
        })();
        return await this.stateRequestPromise;
    }

    async sendCommand(endpoint, data) {
        this.log.info(`[${this.name}] 명령 전송: ${endpoint} -> ${JSON.stringify(data)}`);
        await this.client.sendCommand(this.setDeviceIndex, endpoint, data);
        await new Promise(resolve => setTimeout(resolve, 500));
        await this.getCachedState(true);
    }

    _createGetter(name, extractor) {
        return async () => {
            this.debugLog(`[${this.name}] GET ${name}`);
            try {
                const state = await this.getCachedState();
                const value = extractor(state);
                this.debugLog(`[${this.name}] > ${name}: ${value}`);
                return value;
            } catch (e) { this.log.error(`[${this.name}] GET ${name} 오류:`, e.message); throw e; }
        };
    }

    _createSetter(name, commandBuilder) {
        return async (value) => {
            this.log.info(`[${this.name}] SET ${name} -> ${value}`);
            try {
                const { endpoint, data } = commandBuilder(value);
                await this.sendCommand(endpoint, data);
            } catch (e) { this.log.error(`[${this.name}] SET ${name} 오류:`, e.message); throw e; }
        };
    }

    setupCharacteristics() {
        this.aircoService.getCharacteristic(this.Characteristic.Active)
            .onGet(this._createGetter('Active', state => state.Operation.power === CONSTANTS.POWER.ON ? 1 : 0))
            .onSet(this._createSetter('Active', value => ({ endpoint: '', data: { Operation: { power: value ? CONSTANTS.POWER.ON : CONSTANTS.POWER.OFF } } })));

        this.aircoService.getCharacteristic(this.Characteristic.CurrentHeaterCoolerState)
            .onGet(this._createGetter('CurrentState', state => {
                if (state.Operation.power !== CONSTANTS.POWER.ON) return this.Characteristic.CurrentHeaterCoolerState.INACTIVE;
                return this.Characteristic.CurrentHeaterCoolerState.COOLING;
            }));

        this.aircoService.getCharacteristic(this.Characteristic.TargetHeaterCoolerState)
            .setProps({ validValues: [this.Characteristic.TargetHeaterCoolerState.COOL] })
            .onGet(this._createGetter('TargetState', () => this.Characteristic.TargetHeaterCoolerState.COOL))
            .onSet(value => this.log.info(`[${this.name}] SET TargetState -> ${value} (COOL 모드만 지원)`));

        this.aircoService.getCharacteristic(this.Characteristic.CurrentTemperature)
            .onGet(this._createGetter('CurrentTemp', state => state.Temperatures[0].current));

        this.aircoService.getCharacteristic(this.Characteristic.CoolingThresholdTemperature)
            .setProps({ minValue: this.minTemp, maxValue: this.maxTemp, minStep: 1 })
            .onGet(this._createGetter('TargetTemp', state => state.Temperatures[0].desired))
            .onSet(this._createSetter('TargetTemp', value => ({ endpoint: '/temperatures/0', data: { desired: value } })));

        this.aircoService.getCharacteristic(this.Characteristic.SwingMode)
            .onGet(this._createGetter('SwingMode', state => this.swingModeHandler.getValue(state) ? 1 : 0))
            .onSet(this._createSetter('SwingMode', value => this.swingModeHandler.getCommand(value === 1)));

        this.aircoService.getCharacteristic(this.Characteristic.LockPhysicalControls)
            .onGet(this._createGetter('LockControls', state => state.Mode.options.includes(CONSTANTS.AUTOCLEAN.ON) ? 1 : 0))
            .onSet(this._createSetter('LockControls', value => ({ endpoint: '/mode', data: { options: [value ? CONSTANTS.AUTOCLEAN.ON : CONSTANTS.AUTOCLEAN.OFF] } })));
    }
}

class SamsungACPlatform {
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.accessories = [];

        this.log.info("삼성 AC 플랫폼을 초기화합니다...");
        this.api.on('didFinishLaunching', () => this.discoverDevices());
    }

    configureAccessory(accessory) {
        this.log.info(`캐시에서 '${accessory.displayName}' 액세서리를 불러옵니다.`);
        this.accessories.push(accessory);
    }

    discoverDevices() {
        const platformAccessories = this.config.accessories || [];
        this.log.info(`${platformAccessories.length}개의 에어컨 장치를 설정에서 찾았습니다.`);

        for (const accessoryConfig of platformAccessories) {
            if (!accessoryConfig.name || !accessoryConfig.ip || !accessoryConfig.token) {
                this.log.warn('잘못된 에어컨 설정이 있어 건너뜁니다. (name, ip, token 필요)', accessoryConfig);
                continue;
            }

            const uuid = HAP.uuid.generate(accessoryConfig.ip + accessoryConfig.name);
            const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

            if (existingAccessory) {
                this.log.info(`'${accessoryConfig.name}' 액세서리를 복원하고 로직을 연결합니다.`);
                existingAccessory.context.config = accessoryConfig;
                new SamsungACLogic(this.log, accessoryConfig, this.api, existingAccessory);
            } else {
                this.log.info(`'${accessoryConfig.name}'를 새로운 액세서리로 등록합니다.`);
                const accessory = new this.api.platformAccessory(accessoryConfig.name, uuid);
                accessory.context.config = accessoryConfig;
                new SamsungACLogic(this.log, accessoryConfig, this.api, accessory);
                this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            }
        }
    }
}

module.exports = (homebridge) => {
    HAP = homebridge.hap;
    homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, SamsungACPlatform);
};
