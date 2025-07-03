// Samsung Air Conditioner Homebridge Plugin
// Version 2.0.1 (Refactored & Stabilized with Request Coalescing)
'use strict';

const tls = require('tls');
const fs = require('fs');
const { constants } = require('crypto');

let HAP;
let Service, Characteristic;

// --- 상수 관리 ---
const CONSTANTS = {
    API_PORT: 8888,
    API_DEVICES_PATH: '/devices',
    PLUGIN_VERSION: '2.0.1', // 버전 업데이트
    DEFAULT_RETRY_ATTEMPTS: 3,
    DEFAULT_CACHE_DURATION_MS: 30000,
    DEFAULT_TIMEOUT_MS: 5000,
    // AC Commands
    POWER: { ON: 'On', OFF: 'Off' },
    SWING: { UP_DOWN: 'Up_And_Low', FIX: 'Fix' },
    COMFORT: { NANO_ON: 'Comode_Nano', NANO_OFF: 'Comode_Off' },
    AUTOCLEAN: { ON: 'Autoclean_On', OFF: 'Autoclean_Off' },
    // AC Modes
    MODE: {
        COOL: 'Cool',
        DRY: 'Dry',
        WIND: 'Wind',
        AUTO: 'Auto'
    }
};

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

module.exports = function(homebridge) {
    HAP = homebridge.hap;
    Service = HAP.Service;
    Characteristic = HAP.Characteristic;
    homebridge.registerAccessory('homebridge-samsung-ac', 'SamsungAC', SamsungAirco);
};

class SamsungAirco {
    constructor(log, config) {
        this.log = log;

        // --- 설정(Configuration) 처리 강화 ---
        this.name = config.name;
        this.ip = config.ip;
        this.token = config.token;
        this.deviceIndex = config.deviceIndex ?? 0;
        this.setDeviceIndex = config.setDeviceIndex ?? this.deviceIndex;
        this.swingModeType = config.swingModeType ?? 'comfort';

        // 기본값 할당 단순화
        this.cacheDuration = config.cacheDuration ?? CONSTANTS.DEFAULT_CACHE_DURATION_MS;
        this.timeout = config.timeout ?? CONSTANTS.DEFAULT_TIMEOUT_MS;
        this.pollingInterval = config.pollingInterval; // 0 or undefined will disable polling

        // 인증서 경로 처리
        const defaultCertPath = `${__dirname}/cert/cert.pem`;
        this.certPath = config.certPath || config.patchCert || defaultCertPath;
        this.keyPath = config.keyPath || this.certPath;

        this.swingModeHandler = new SwingModeHandler(this.swingModeType);

        if (!this.ip || !this.token) {
            throw new Error(`[${this.name}] 필수 설정(ip, token)이 누락되었습니다.`);
        }

        try {
            fs.accessSync(this.certPath, fs.constants.R_OK);
            fs.accessSync(this.keyPath, fs.constants.R_OK);
        } catch (e) {
            throw new Error(`[${this.name}] 인증서/키 파일 접근 오류: ${e.message}`);
        }

        this.tlsOptions = {
            host: this.ip,
            port: CONSTANTS.API_PORT,
            cert: fs.readFileSync(this.certPath),
            key: fs.readFileSync(this.keyPath),
            rejectUnauthorized: false,
            honorCipherOrder: true,
            ciphers: 'DEFAULT@SECLEVEL=0',
            minVersion: 'TLSv1',
            maxVersion: 'TLSv1',
            secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT,
        };

        this.deviceState = null;
        this.lastStateUpdate = 0;
        this.stateRequestPromise = null; // ✨ API 요청 병합을 위한 Promise 저장 변수

        this.aircoSamsung = new Service.HeaterCooler(this.name);
        this.informationService = new Service.AccessoryInformation()
            .setCharacteristic(Characteristic.Manufacturer, config.manufacturer || 'Samsung')
            .setCharacteristic(Characteristic.Model, config.model || 'AC-Model-01')
            .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || 'A1-SERIAL-01')
            .setCharacteristic(Characteristic.FirmwareRevision, CONSTANTS.PLUGIN_VERSION);

        this.startPolling();
        this.log.info(`[${this.name}] Samsung AC Plugin v${CONSTANTS.PLUGIN_VERSION} 초기화 완료.`);
    }

    startPolling() {
        if (this.pollingInterval > 0) {
            this.log.info(`[${this.name}] ${this.pollingInterval}초 간격으로 상태 폴링을 시작합니다.`);
            setInterval(() => {
                this.log.debug(`[${this.name}] 주기적인 상태 업데이트 실행...`);
                this.getCachedState(true).catch(e => this.log.error(`[${this.name}] 폴링 실패:`, e.message));
            }, this.pollingInterval * 1000);
        }
    }

    // --- 통신 로직 (✨ _rawRequest 함수 개선 적용) ---
    _rawRequest(path, method, data) {
        return new Promise((resolve, reject) => {
            const jsonData = data ? JSON.stringify(data) : '';
            const requestData = [
                `${method} ${path} HTTP/1.1`,
                `Host: ${this.ip}`,
                `Authorization: Bearer ${this.token}`,
                'Content-Type: application/json',
                `Content-Length: ${Buffer.byteLength(jsonData)}`,
                'Connection: close',
                '',
                jsonData
            ].join('\r\n');

            const socket = tls.connect(this.tlsOptions, () => {
                socket.write(requestData);
            });

            let responseChunks = '';
            socket.setEncoding('utf8');
            socket.on('data', chunk => { responseChunks += chunk; });

            socket.on('end', () => {
                try {
                    const statusLine = responseChunks.split('\r\n')[0];
                    const statusMatch = statusLine.match(/^HTTP\/\d\.\d\s+(\d+)/);
                    const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : null;
                    
                    if (statusCode === 204) {
                        return resolve({});
                    }

                    // [개선 1] HTTP 헤더와 본문을 정확히 분리
                    const bodySeparator = '\r\n\r\n';
                    const bodyIndex = responseChunks.indexOf(bodySeparator);

                    if (bodyIndex === -1) {
                        return reject(new Error(`HTTP 본문 구분자(\\r\\n\\r\\n)를 찾을 수 없습니다.`));
                    }
                    
                    const body = responseChunks.slice(bodyIndex + bodySeparator.length).trim();

                    if (!body) { // 본문이 비어있는 경우
                        return resolve({});
                    }

                    try {
                        const jsonResponse = JSON.parse(body);
                        resolve(jsonResponse);
                    } catch (e) {
                        reject(new Error(`JSON 파싱에 실패했습니다. Body: "${body}", Error: ${e.message}`));
                    }
                } catch (e) {
                    reject(e); // 처리 중 발생한 예외
                } finally {
                    // [개선 2] 소켓 리소스 확실히 정리
                    if (!socket.destroyed) {
                        socket.destroy();
                    }
                }
            });
            
            socket.setTimeout(this.timeout); // Promise 외부에서 타임아웃 설정
            
            socket.on('timeout', () => {
                socket.destroy();
                reject(new Error(`요청 시간 초과 (${this.timeout}ms)`));
            });

            socket.on('error', (err) => {
                if (!socket.destroyed) {
                    socket.destroy();
                }
                reject(new Error(`TLS 소켓 오류: ${err.message}`));
            });
        });
    }

    async _request(method, path, data = null, retries = CONSTANTS.DEFAULT_RETRY_ATTEMPTS) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await this._rawRequest(path, method, data);
            } catch (e) {
                if (attempt === retries) {
                    this.log.error(`[${this.name}] 최종 요청 실패 (${attempt}회 시도): ${e.message}`);
                    throw e;
                }
                this.log.warn(`[${this.name}] 요청 실패, 재시도 ${attempt}/${retries}... (${e.message})`);
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }

    // ✨✨✨ API 호출 병합 로직이 적용된 getCachedState 함수 ✨✨✨
    async getCachedState(force = false) {
        const now = Date.now();
        // 1. 캐시가 유효하면 즉시 반환
        if (!force && this.deviceState && (now - this.lastStateUpdate < this.cacheDuration)) {
            this.log.debug(`[${this.name}] 캐시된 상태 사용`);
            return this.deviceState;
        }

        // 2. 이미 진행 중인 요청이 있는지 확인 (핵심 개선점)
        if (this.stateRequestPromise) {
            this.log.debug(`[${this.name}] 진행 중인 상태 업데이트 요청에 합류합니다.`);
            return await this.stateRequestPromise;
        }

        // 3. 새로운 요청 시작 및 Promise 저장
        this.log.debug(`[${this.name}] 장치에서 새 상태를 가져옵니다 (강제갱신: ${force}).`);
        this.stateRequestPromise = (async () => {
            try {
                const response = await this._request('GET', CONSTANTS.API_DEVICES_PATH);
                if (!response?.Devices?.[this.deviceIndex]) {
                    throw new Error(`API 응답에서 장치(index: ${this.deviceIndex})를 찾을 수 없습니다.`);
                }
                this.deviceState = response.Devices[this.deviceIndex];
                this.lastStateUpdate = Date.now();
                return this.deviceState;
            } catch (e) {
                this.log.error(`[${this.name}] 상태를 가져오는 중 오류 발생: ${e.message}`);
                throw e;
            } finally {
                // 4. 요청이 완료되면 Promise 참조를 제거
                this.stateRequestPromise = null;
            }
        })();

        return await this.stateRequestPromise;
    }

    async sendCommand(endpoint, data) {
        this.log.info(`[${this.name}] 명령 전송: ${endpoint} -> ${JSON.stringify(data)}`);
        await this._request('PUT', `/devices/${this.setDeviceIndex}${endpoint}`, data);
        this.log.info(`[${this.name}] 명령 전송 완료.`);
        
        // 상태 즉시 갱신
        this.deviceState = null;
        await new Promise(resolve => setTimeout(resolve, 500)); // 기기 반영 시간 대기
        await this.getCachedState(true);
    }

    identify(callback) {
        this.log.info(`[${this.name}] Identify 호출됨.`);
        callback();
    }

    // --- 코드 중복 제거 및 추상화 ---
    _createGetter(name, extractor) {
        return async () => {
            this.log.debug(`[${this.name}] GET ${name}`);
            try {
                const state = await this.getCachedState();
                const value = extractor(state);
                this.log.debug(`[${this.name}] > ${name}: ${value}`);
                return value;
            } catch (e) {
                this.log.error(`[${this.name}] GET ${name} 오류:`, e.message);
                throw e; // HomeKit에 오류 전파
            }
        };
    }

    _createSetter(name, commandBuilder) {
        return async (value) => {
            this.log.info(`[${this.name}] SET ${name} -> ${value}`);
            try {
                const { endpoint, data } = commandBuilder(value);
                await this.sendCommand(endpoint, data);
            } catch (e) {
                this.log.error(`[${this.name}] SET ${name} 오류:`, e.message);
                throw e;
            }
        };
    }

    getServices() {
        this.aircoSamsung.setPrimaryService(true);

        this.aircoSamsung.getCharacteristic(Characteristic.Active)
            .onGet(this._createGetter('Active', state => state.Operation.power === CONSTANTS.POWER.ON ? 1 : 0))
            .onSet(this._createSetter('Active', value => ({
                endpoint: '',
                data: { Operation: { power: value ? CONSTANTS.POWER.ON : CONSTANTS.POWER.OFF } }
            })));

        this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
            .onGet(this._createGetter('CurrentState', state => {
                if (state.Operation.power !== CONSTANTS.POWER.ON) {
                    return Characteristic.CurrentHeaterCoolerState.INACTIVE;
                }
                const currentMode = state.Mode.modes[0];
                const coolingModes = [CONSTANTS.MODE.COOL, CONSTANTS.MODE.DRY, CONSTANTS.MODE.AUTO, CONSTANTS.MODE.WIND, 'CoolClean', 'DryClean'];
                return coolingModes.includes(currentMode)
                    ? Characteristic.CurrentHeaterCoolerState.COOLING
                    : Characteristic.CurrentHeaterCoolerState.IDLE;
            }));

        this.aircoSamsung.getCharacteristic(Characteristic.TargetHeaterCoolerState)
            .setProps({ validValues: [Characteristic.TargetHeaterCoolerState.COOL] })
            .onGet(this._createGetter('TargetState', () => Characteristic.TargetHeaterCoolerState.COOL))
            .onSet(value => {
                this.log.info(`[${this.name}] SET TargetState -> ${value} (COOL 모드만 지원하여 변경 없음)`);
            });

        this.aircoSamsung.getCharacteristic(Characteristic.CurrentTemperature)
            .onGet(this._createGetter('CurrentTemp', state => state.Temperatures[0].current));
            
        this.aircoSamsung.getCharacteristic(Characteristic.CoolingThresholdTemperature)
            .setProps({ minValue: 18, maxValue: 30, minStep: 1 })
            .onGet(this._createGetter('TargetTemp', state => state.Temperatures[0].desired))
            .onSet(this._createSetter('TargetTemp', value => ({
                endpoint: '/temperatures/0',
                data: { desired: value }
            })));

        this.aircoSamsung.getCharacteristic(Characteristic.SwingMode)
            .onGet(this._createGetter('SwingMode', state => this.swingModeHandler.getValue(state) ? 1 : 0))
            .onSet(this._createSetter('SwingMode', value => {
                const enabled = value === 1;
                return this.swingModeHandler.getCommand(enabled);
            }));

        this.aircoSamsung.getCharacteristic(Characteristic.LockPhysicalControls)
            .onGet(this._createGetter('LockControls', state => state.Mode.options.includes(CONSTANTS.AUTOCLEAN.ON) ? 1 : 0))
            .onSet(this._createSetter('LockControls', value => ({
                endpoint: '/mode',
                data: { options: [value ? CONSTANTS.AUTOCLEAN.ON : CONSTANTS.AUTOCLEAN.OFF] }
            })));

        return [this.informationService, this.aircoSamsung];
    }
}
