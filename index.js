// Samsung Air Conditioner Homebridge Plugin
// Version 1.7.3
//
// 'use strict'; 는 자바스크립트의 엄격 모드를 활성화하여, 잠재적인 오류를 줄여주는 좋은 습관입니다.
'use strict';

// Node.js에 내장된 https 모듈을 불러옵니다. axios 라이브러리를 대체하여 더 낮은 수준의 직접적인 통신을 담당합니다.
const https = require('https');
// Node.js에 내장된 fs (File System) 모듈로, 인증서 같은 파일을 읽기 위해 필요합니다.
const fs = require('fs');

// Homebridge 플러그인 개발에 필요한 핵심 클래스들을 담을 변수를 미리 선언합니다.
var Service, Characteristic, Accessory;

// 이 함수는 Homebridge가 플러그인을 로드할 때 최초로 실행되는 부분입니다.
module.exports = function(homebridge) {
    // Homebridge의 핵심 클래스들을 전역 변수에 할당하여 플러그인 전체에서 사용할 수 있게 합니다.
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    Accessory = homebridge.hap.Accessory;

    // 이 플러그인을 Homebridge에 공식적으로 등록합니다.
    homebridge.registerAccessory('homebridge-samsung-ac', 'SamsungAC', SamsungAirco);
}

// 삼성 에어컨 액세서리의 모든 로직을 담고 있는 메인 클래스입니다.
class SamsungAirco {
    // 생성자 함수: Homebridge가 config.json을 기반으로 이 액세서리를 초기화할 때 실행됩니다.
    constructor(log, config) {
        this.log = log;
        this.name = config.name;

        // --- config.json에서 가져온 주요 설정값들 ---
        this.ip = config.ip;
        this.token = config.token;
        this.patchCert = config.patchCert;

        // --- 다양한 에어컨 모델을 지원하기 위한 설정 ---
        this.deviceIndex = config.deviceIndex || 0;
        this.setDeviceIndex = config.setDeviceIndex ?? this.deviceIndex;
        this.swingModeType = config.swingModeType || 'comfort';
        this.cacheDuration = config.cacheDuration || 3000;

        if (!this.ip || !this.token || !this.patchCert) {
            this.log.error("IP, 토큰, 인증서 경로(patchCert)는 필수 설정 항목입니다.");
            return;
        }

        // --- 모든 SSL/TLS 통신 오류 해결을 위한 핵심 에이전트 설정 ---
        this.httpsAgent = new https.Agent({
            cert: fs.readFileSync(this.patchCert), // 클라이언트 '인증서'
            key: fs.readFileSync(this.patchCert),  // 클라이언트 '비공개 키' (상호 인증용)
            rejectUnauthorized: false,             // 자체 서명 인증서 허용
            ciphers: 'DEFAULT@SECLEVEL=1',         // 약한 암호화 방식(ca md too weak) 허용
            secureProtocol: 'TLSv1_method'         // 구형 프로토콜(unsupported protocol) 사용 강제
        });

        // --- 상태 캐싱을 위한 변수 초기화 ---
        this.deviceState = null;
        this.lastStateUpdate = 0;

        // --- 홈 앱에 표시될 서비스 생성 ---
        this.aircoSamsung = new Service.HeaterCooler(this.name);
        this.informationService = new Service.AccessoryInformation()
            .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
            .setCharacteristic(Characteristic.Model, 'Air Conditioner')
            .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || 'AF16K7970WFN');
        
        this.log.info(`Samsung AC Plugin v1.7.3 초기화 완료: ${this.name}`);
    }

    /**
     * 네이티브 https 모듈을 사용하여 "raw" HTTP 요청을 보내는 헬퍼 함수
     * @param {string} method - 'GET' 또는 'PUT'
     * @param {string} path - API 경로 (예: '/devices')
     * @param {object | null} data - PUT 요청 시 보낼 데이터
     * @returns {Promise<object>} - 성공 시 JSON 응답 객체를, 실패 시 에러를 포함한 Promise
     */
    _request(method, path, data = null) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: this.ip,
                port: 8888,
                path: path,
                method: method,
                headers: { 'Authorization': `Bearer ${this.token}` },
                agent: this.httpsAgent,
                timeout: 5000
            };

            if (data) {
                const postData = JSON.stringify(data);
                options.headers['Content-Type'] = 'application/json';
                options.headers['Content-Length'] = Buffer.byteLength(postData);
            }

            const req = https.request(options, (res) => {
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    return reject(new Error(`요청 실패, 상태 코드: ${res.statusCode}`));
                }
                let body = [];
                res.on('data', (chunk) => body.push(chunk));
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(Buffer.concat(body).toString() || '{}'));
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            req.on('error', (e) => reject(e));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('요청 시간 초과'));
            });

            if (data) {
                req.write(JSON.stringify(data));
            }
            req.end();
        });
    }

    /**
     * 불필요한 API 호출을 줄여 성능을 향상시키는 핵심 함수.
     * @returns {Promise<object>} - 에어컨의 현재 상태 객체를 포함한 Promise
     */
    async getCachedState() {
        const now = Date.now();
        if (this.deviceState && (now - this.lastStateUpdate < this.cacheDuration)) {
            this.log.info('[CACHE] 유효한 캐시된 상태를 반환합니다.');
            return this.deviceState;
        }

        this.log.info('[CACHE] 캐시 만료. 기기에서 최신 상태를 가져옵니다...');
        try {
            const responseData = await this._request('GET', '/devices');
            this.deviceState = responseData.Devices[this.deviceIndex];
            this.lastStateUpdate = now;
            this.log.info('[CACHE] 기기 상태를 성공적으로 가져와 캐시를 업데이트했습니다.');
            return this.deviceState;
        } catch (error) {
            this.log.error(`[CACHE] 기기 상태를 가져오는 데 실패했습니다: ${error.message}`);
            if (this.deviceState) {
                this.log.warn('[CACHE] 가져오기 오류로 인해 오래된 캐시 데이터를 반환합니다.');
                return this.deviceState;
            }
            throw new Error('기기 상태를 가져올 수 없습니다.');
        }
    }

    /**
     * 에어컨에 제어 명령을 보내는 헬퍼 함수.
     * @param {string} endpoint - API 엔드포인트 (예: '/mode')
     * @param {object} data - 전송할 JSON 데이터
     */
    async sendCommand(endpoint, data) {
        const fullEndpoint = `/devices/${this.setDeviceIndex}${endpoint}`;
        this.log.info(`[COMMAND] 명령어 전송 시도 -> Endpoint: ${fullEndpoint}, Data: ${JSON.stringify(data)}`);
        try {
            await this._request('PUT', fullEndpoint, data);
            this.log.info(`[COMMAND] ${fullEndpoint}(으)로 명령어를 성공적으로 보냈습니다.`);
            this.deviceState = null; // 상태가 변경되었으므로 캐시를 무효화합니다.
            await this.getCachedState(); // 새로운 상태를 즉시 가져옵니다.
        } catch (error) {
            this.log.error(`[COMMAND] ${fullEndpoint}(으)로 명령을 보내는 데 실패했습니다: ${error.message}`);
            throw error;
        }
    }

    identify(callback) {
        this.log.info("장치 식별 요청이 들어왔습니다!");
        callback();
    }

    /**
     * 이 액세서리가 홈 앱에 제공할 모든 서비스와 특성(기능)을 정의하고 반환하는 함수.
     * @returns {Service[]} - 서비스 목록 배열
     */
    getServices() {
        this.aircoSamsung.setPrimaryService(true);

        this.aircoSamsung.getCharacteristic(Characteristic.Active)
            .on('get', this.getActive.bind(this))
            .on('set', this.setActive.bind(this));

        this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
            .on('get', this.getCurrentHeaterCoolerState.bind(this));

        this.aircoSamsung.getCharacteristic(Characteristic.TargetHeaterCoolerState)
            .setProps({ validValues: [Characteristic.TargetHeaterCoolerState.COOL] })
            .on('get', this.getTargetHeaterCoolerState.bind(this))
            .on('set', this.setTargetHeaterCoolerState.bind(this));

        this.aircoSamsung.getCharacteristic(Characteristic.CurrentTemperature)
            .on('get', this.getCurrentTemperature.bind(this));

        this.aircoSamsung.getCharacteristic(Characteristic.CoolingThresholdTemperature)
            .setProps({ minValue: 18, maxValue: 30, minStep: 1 })
            .on('get', this.getTargetTemperature.bind(this))
            .on('set', this.setTargetTemperature.bind(this));
            
        this.aircoSamsung.getCharacteristic(Characteristic.SwingMode)
            .on('get', this.getSwingMode.bind(this))
            .on('set', this.setSwingMode.bind(this));

        this.aircoSamsung.getCharacteristic(Characteristic.LockPhysicalControls)
            .on('get', this.getLockPhysicalControls.bind(this))
            .on('set', this.setLockPhysicalControls.bind(this));

        return [this.informationService, this.aircoSamsung];
    }
    
    // --- Getters & Setters ---

    async getActive(callback) {
        this.log.info('[GET] Active (전원) 상태 요청을 받았습니다.');
        try {
            const state = await this.getCachedState();
            const isActive = state.Operation.power === "On" ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
            this.log.info(`[GET] Active 상태 반환: ${isActive === 1 ? 'ACTIVE' : 'INACTIVE'}`);
            callback(null, isActive);
        } catch (error) {
            this.log.error('[GET] Active 상태 가져오기 실패:', error.message);
            callback(error);
        }
    }

    async setActive(value, callback) {
        const targetState = value === Characteristic.Active.ACTIVE ? 'On' : 'Off';
        this.log.info(`[SET] Active (전원) 상태를 '${targetState}'(으)로 설정 요청을 받았습니다.`);
        try {
            if (value === Characteristic.Active.INACTIVE) {
                await this.sendCommand('', { Operation: { power: 'Off' } });
            } else {
                await this.sendCommand('', { Operation: { power: 'On' } });
                await this.sendCommand('/mode', { modes: ['DryClean'] });
                this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.COOLING);
            }
            this.log.info(`[SET] Active (전원) 상태를 '${targetState}'(으)로 성공적으로 변경했습니다.`);
            callback(null);
        } catch(error) {
            this.log.error(`[SET] Active (전원) 상태 설정 실패:`, error.message);
            callback(error);
        }
    }

    async getCurrentTemperature(callback) {
        this.log.info('[GET] CurrentTemperature (현재 온도) 요청을 받았습니다.');
        try {
            const state = await this.getCachedState();
            const temp = state.Temperatures[0].current;
            this.log.info(`[GET] CurrentTemperature 반환: ${temp}°C`);
            callback(null, temp);
        } catch (error) {
            this.log.error('[GET] CurrentTemperature 가져오기 실패:', error.message);
            callback(error);
        }
    }

    async getTargetTemperature(callback) {
        this.log.info('[GET] TargetTemperature (목표 온도) 요청을 받았습니다.');
        try {
            const state = await this.getCachedState();
            const temp = state.Temperatures[0].desired;
            this.log.info(`[GET] TargetTemperature 반환: ${temp}°C`);
            callback(null, temp);
        } catch (error) {
            this.log.error('[GET] TargetTemperature 가져오기 실패:', error.message);
            callback(error);
        }
    }

    async setTargetTemperature(value, callback) {
        this.log.info(`[SET] TargetTemperature (목표 온도)를 ${value}°C로 설정 요청을 받았습니다.`);
        try {
            await this.sendCommand('/temperatures/0', { desired: value });
            this.log.info(`[SET] TargetTemperature를 ${value}°C로 성공적으로 변경했습니다.`);
            callback(null);
        } catch (error) {
            this.log.error(`[SET] TargetTemperature 설정 실패:`, error.message);
            callback(error);
        }
    }

    async getSwingMode(callback) {
        this.log.info('[GET] SwingMode (바람 방향/무풍) 요청을 받았습니다.');
        try {
            const state = await this.getCachedState();
            let swingEnabled;
            if (this.swingModeType === 'wind') {
                const mode = state.Wind.direction;
                swingEnabled = mode === "Up_And_Low";
                this.log.info(`[GET] SwingMode (바람 방향) 상태 반환: ${swingEnabled ? 'ENABLED' : 'DISABLED'}`);
            } else {
                swingEnabled = state.Mode.options.includes("Comode_Nano");
                this.log.info(`[GET] SwingMode (무풍) 상태 반환: ${swingEnabled ? 'ENABLED' : 'DISABLED'}`);
            }
            callback(null, swingEnabled ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED);
        } catch (error) {
            this.log.error('[GET] SwingMode 가져오기 실패:', error.message);
            callback(error);
        }
    }

    async setSwingMode(value, callback) {
        const targetState = value === Characteristic.SwingMode.SWING_ENABLED ? 'ENABLED' : 'DISABLED';
        this.log.info(`[SET] SwingMode (바람 방향/무풍)를 '${targetState}'(으)로 설정 요청을 받았습니다.`);
        try {
            if (this.swingModeType === 'wind') {
                const direction = value === Characteristic.SwingMode.SWING_ENABLED ? "Up_And_Low" : "Fix";
                await this.sendCommand('/wind', { direction: direction });
            } else {
                const newSwingState = value === Characteristic.SwingMode.SWING_ENABLED ? "Comode_Nano" : "Comode_Off";
                await this.sendCommand('/mode', { options: [newSwingState] });
            }
            this.log.info(`[SET] SwingMode를 '${targetState}'(으)로 성공적으로 변경했습니다.`);
            callback(null);
        } catch (error) {
            this.log.error(`[SET] SwingMode 설정 실패:`, error.message);
            callback(error);
        }
    }

    async getLockPhysicalControls(callback) {
        this.log.info('[GET] LockPhysicalControls (자동 청소) 상태 요청을 받았습니다.');
        try {
            const state = await this.getCachedState();
            const isEnabled = state.Mode.options.includes("Autoclean_On");
            this.log.info(`[GET] LockPhysicalControls (자동 청소) 상태 반환: ${isEnabled ? 'ENABLED' : 'DISABLED'}`);
            callback(null, isEnabled ? Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED : Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED);
        } catch (error) {
            this.log.error('[GET] LockPhysicalControls 가져오기 실패:', error.message);
            callback(error);
        }
    }

    async setLockPhysicalControls(value, callback) {
        const targetState = value === Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED ? 'Autoclean_On' : 'Autoclean_Off';
        this.log.info(`[SET] LockPhysicalControls (자동 청소)를 '${targetState}'(으)로 설정 요청을 받았습니다.`);
        try {
            await this.sendCommand('/mode', { options: [targetState] });
            this.log.info(`[SET] LockPhysicalControls (자동 청소)를 '${targetState}'(으)로 성공적으로 변경했습니다.`);
            callback(null);
        } catch (error) {
            this.log.error(`[SET] LockPhysicalControls 설정 실패:`, error.message);
            callback(error);
        }
    }

    async getCurrentHeaterCoolerState(callback) {
        this.log.info('[GET] CurrentHeaterCoolerState (현재 운전 상태) 요청을 받았습니다.');
        try {
            const state = await this.getCachedState();
            const currentMode = state.Mode.modes[0];
            const coolModes = ["CoolClean", "Cool", "Dry", "DryClean", "Auto", "Wind"];

            if (coolModes.includes(currentMode)) {
                this.log.info(`[GET] CurrentHeaterCoolerState 반환: COOLING (현재 모드: ${currentMode})`);
                callback(null, Characteristic.CurrentHeaterCoolerState.COOLING);
            } else {
                this.log.info(`[GET] CurrentHeaterCoolerState 반환: IDLE (현재 모드: ${currentMode})`);
                callback(null, Characteristic.CurrentHeaterCoolerState.IDLE);
            }
        } catch (error) {
            this.log.error('[GET] CurrentHeaterCoolerState 가져오기 실패:', error.message);
            callback(error);
        }
    }

    getTargetHeaterCoolerState(callback) {
        this.log.info('[GET] TargetHeaterCoolerState (목표 운전 상태) 요청을 받았습니다.');
        // 목표 상태는 현재 상태를 그대로 따라가도록 설정합니다.
        this.getCurrentHeaterCoolerState(callback);
    }
    
    async setTargetHeaterCoolerState(value, callback) {
        this.log.info(`[SET] TargetHeaterCoolerState (목표 운전 상태)를 'COOL'로 설정 요청을 받았습니다.`);
        try {
            if (value === Characteristic.TargetHeaterCoolerState.COOL) {
                await this.sendCommand('/mode', { modes: ["DryClean"] });
                this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.COOLING);
                this.log.info(`[SET] TargetHeaterCoolerState를 'COOL'로 성공적으로 변경했습니다. (실제 전송 모드: DryClean)`);
            }
            callback(null);
        } catch (error) {
            this.log.error(`[SET] TargetHeaterCoolerState 설정 실패:`, error.message);
            callback(error);
        }
    }
}
