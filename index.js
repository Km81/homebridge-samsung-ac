// Samsung Air Conditioner Homebridge Plugin
// Version 1.7.8
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

        // --- 명령어 충돌 방지를 위한 Debounce 변수 ---
        this.lastCommandTime = 0;
        this.debounceDelay = 1000; // 1초 이내의 중복 명령 무시

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
        
        this.log.info(`Samsung AC Plugin v1.7.8 초기화 완료: ${this.name}`);
    }

    /**
     * 네이티브 https 모듈을 사용하여 "raw" HTTP 요청을 보내는 헬퍼 함수
     */
    _request(method, path, data = null) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: this.ip, port: 8888, path: path, method: method,
                headers: { 'Authorization': `Bearer ${this.token}` },
                agent: this.httpsAgent, timeout: 5000
            };
            if (data) {
                const postData = JSON.stringify(data);
                options.headers['Content-Type'] = 'application/json';
                options.headers['Content-Length'] = Buffer.byteLength(postData);
            }
            const req = https.request(options, (res) => {
                if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`요청 실패, 상태 코드: ${res.statusCode}`));
                let body = [];
                res.on('data', (chunk) => body.push(chunk));
                res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(body).toString() || '{}')); } catch (e) { reject(e); } });
            });
            req.on('error', (e) => reject(e));
            req.on('timeout', () => { req.destroy(); reject(new Error('요청 시간 초과')); });
            if (data) req.write(JSON.stringify(data));
            req.end();
        });
    }

    /**
     * 불필요한 API 호출을 줄이기 위한 상태 캐싱 함수.
     */
    async getCachedState() {
        const now = Date.now();
        if (this.deviceState && (now - this.lastStateUpdate < this.cacheDuration)) {
            return this.deviceState;
        }
        this.log.info('[CACHE] 기기에서 최신 상태를 가져옵니다...');
        const responseData = await this._request('GET', '/devices');
        if (!responseData || !responseData.Devices || !responseData.Devices[this.deviceIndex]) {
            throw new Error('API 응답에서 유효한 기기 정보를 찾을 수 없습니다.');
        }
        this.deviceState = responseData.Devices[this.deviceIndex];
        this.lastStateUpdate = now;
        return this.deviceState;
    }

    /**
     * 에어컨에 제어 명령을 보내는 헬퍼 함수.
     */
    async sendCommand(endpoint, data) {
        const fullEndpoint = `/devices/${this.setDeviceIndex}${endpoint}`;
        this.log.info(`[COMMAND] 명령어 전송 -> Endpoint: ${fullEndpoint}, Data: ${JSON.stringify(data)}`);
        await this._request('PUT', fullEndpoint, data);
        this.log.info(`[COMMAND] 명령어를 성공적으로 보냈습니다.`);
        this.deviceState = null; // 캐시 무효화
    }

    identify(callback) { this.log.info("장치 식별 요청!"); callback(); }

    getServices() {
        this.aircoSamsung.setPrimaryService(true);
        this.aircoSamsung.getCharacteristic(Characteristic.Active).on('get', this.getActive.bind(this)).on('set', this.setActive.bind(this));
        this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState).on('get', this.getCurrentHeaterCoolerState.bind(this));
        this.aircoSamsung.getCharacteristic(Characteristic.TargetHeaterCoolerState).setProps({ validValues: [Characteristic.TargetHeaterCoolerState.COOL] }).on('get', this.getTargetHeaterCoolerState.bind(this)).on('set', this.setTargetHeaterCoolerState.bind(this));
        this.aircoSamsung.getCharacteristic(Characteristic.CurrentTemperature).on('get', this.getCurrentTemperature.bind(this));
        this.aircoSamsung.getCharacteristic(Characteristic.CoolingThresholdTemperature).setProps({ minValue: 18, maxValue: 30, minStep: 1 }).on('get', this.getTargetTemperature.bind(this)).on('set', this.setTargetTemperature.bind(this));
        this.aircoSamsung.getCharacteristic(Characteristic.SwingMode).on('get', this.getSwingMode.bind(this)).on('set', this.setSwingMode.bind(this));
        this.aircoSamsung.getCharacteristic(Characteristic.LockPhysicalControls).on('get', this.getLockPhysicalControls.bind(this)).on('set', this.setLockPhysicalControls.bind(this));
        return [this.informationService, this.aircoSamsung];
    }
    
    // --- Getters & Setters ---

    async getActive(callback) {
        try {
            const state = await this.getCachedState();
            const isActive = state.Operation.power === "On";
            this.log.info(`[GET] Active: ${isActive ? 'ON' : 'OFF'}`);
            callback(null, isActive ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE);
        } catch (error) { 
            this.log.error(`[GET] Active 실패: ${error.message}. 기본값 OFF 반환.`);
            callback(null, Characteristic.Active.INACTIVE);
        }
    }

    async setActive(value, callback) {
        const targetState = value === Characteristic.Active.ACTIVE ? 'On' : 'Off';
        this.log.info(`[SET] Active -> ${targetState}`);
        
        const now = Date.now();
        if (now - this.lastCommandTime < this.debounceDelay) {
            this.log.warn(`[SET] Debounce: 중복 Active 명령 무시.`);
            return callback(null);
        }
        this.lastCommandTime = now;

        try {
            await this.sendCommand('', { Operation: { power: targetState } });
            // UI 즉시 업데이트
            this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(
                value === Characteristic.Active.ACTIVE ? Characteristic.CurrentHeaterCoolerState.COOLING : Characteristic.CurrentHeaterCoolerState.IDLE
            );
            callback(null);
        } catch (error) {
            this.log.error(`[SET] Active 실패: ${error.message}`);
            callback(error);
        }
    }

    async getCurrentHeaterCoolerState(callback) {
        try {
            const state = await this.getCachedState();
            if (state.Operation.power === 'Off') {
                this.log.info('[GET] CurrentState: IDLE (Power Off)');
                return callback(null, Characteristic.CurrentHeaterCoolerState.IDLE);
            }
            const coolModes = ["CoolClean", "Cool", "Dry", "DryClean", "Auto", "Wind"];
            const currentMode = state.Mode.modes[0];
            const isCooling = coolModes.includes(currentMode);
            this.log.info(`[GET] CurrentState: ${isCooling ? 'COOLING' : 'IDLE'} (Mode: ${currentMode})`);
            callback(null, isCooling ? Characteristic.CurrentHeaterCoolerState.COOLING : Characteristic.CurrentHeaterCoolerState.IDLE);
        } catch (error) { 
            this.log.error(`[GET] CurrentState 실패: ${error.message}. 기본값 IDLE 반환.`);
            callback(null, Characteristic.CurrentHeaterCoolerState.IDLE);
        }
    }

    getTargetHeaterCoolerState(callback) { this.getCurrentHeaterCoolerState(callback); }

    async setTargetHeaterCoolerState(value, callback) {
        this.log.info(`[SET] TargetState -> COOL`);
        const now = Date.now();
        if (now - this.lastCommandTime < this.debounceDelay) {
            this.log.warn(`[SET] Debounce: 중복 TargetState 명령 무시.`);
            return callback(null);
        }
        this.lastCommandTime = now;

        try {
            if (value === Characteristic.TargetHeaterCoolerState.COOL) {
                await this.sendCommand('/mode', { modes: ["DryClean"] });
                // UI 즉시 업데이트
                this.aircoSamsung.getCharacteristic(Characteristic.Active).updateValue(Characteristic.Active.ACTIVE);
            }
            callback(null);
        } catch (error) {
            this.log.error(`[SET] TargetState 실패: ${error.message}`);
            callback(error);
        }
    }

    async getCurrentTemperature(callback) {
        try {
            const state = await this.getCachedState();
            this.log.info(`[GET] CurrentTemp: ${state.Temperatures[0].current}°C`);
            callback(null, state.Temperatures[0].current);
        } catch (error) { 
            this.log.error(`[GET] CurrentTemp 실패: ${error.message}. 기본값 22°C 반환.`);
            callback(null, 22);
        }
    }

    async getTargetTemperature(callback) {
        try {
            const state = await this.getCachedState();
            this.log.info(`[GET] TargetTemp: ${state.Temperatures[0].desired}°C`);
            callback(null, state.Temperatures[0].desired);
        } catch (error) { 
            this.log.error(`[GET] TargetTemp 실패: ${error.message}. 기본값 22°C 반환.`);
            callback(null, 22);
        }
    }

    async setTargetTemperature(value, callback) {
        this.log.info(`[SET] TargetTemp -> ${value}°C`);
        try {
            await this.sendCommand('/temperatures/0', { desired: value });
            callback(null);
        } catch (error) {
            this.log.error(`[SET] TargetTemp 실패: ${error.message}`);
            callback(error);
        }
    }

    async getSwingMode(callback) {
        try {
            const state = await this.getCachedState();
            let isEnabled;
            if (this.swingModeType === 'wind') {
                isEnabled = state.Wind.direction === "Up_And_Low";
            } else {
                isEnabled = state.Mode.options.includes("Comode_Nano");
            }
            this.log.info(`[GET] SwingMode: ${isEnabled ? 'ENABLED' : 'DISABLED'}`);
            callback(null, isEnabled ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED);
        } catch (error) {
            this.log.error(`[GET] SwingMode 실패: ${error.message}. 기본값 DISABLED 반환.`);
            callback(null, Characteristic.SwingMode.SWING_DISABLED);
        }
    }

    async setSwingMode(value, callback) {
        const targetState = value === Characteristic.SwingMode.SWING_ENABLED ? 'ENABLED' : 'DISABLED';
        this.log.info(`[SET] SwingMode -> ${targetState}`);
        try {
            if (this.swingModeType === 'wind') {
                await this.sendCommand('/wind', { direction: value === Characteristic.SwingMode.SWING_ENABLED ? "Up_And_Low" : "Fix" });
            } else {
                await this.sendCommand('/mode', { options: [value === Characteristic.SwingMode.SWING_ENABLED ? "Comode_Nano" : "Comode_Off"] });
            }
            callback(null);
        } catch (error) {
            this.log.error(`[SET] SwingMode 실패: ${error.message}`);
            callback(error);
        }
    }

    async getLockPhysicalControls(callback) {
        try {
            const state = await this.getCachedState();
            const isEnabled = state.Mode.options.includes("Autoclean_On");
            this.log.info(`[GET] AutoClean: ${isEnabled ? 'ENABLED' : 'DISABLED'}`);
            callback(null, isEnabled ? Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED : Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED);
        } catch (error) {
            this.log.error(`[GET] AutoClean 실패: ${error.message}. 기본값 DISABLED 반환.`);
            callback(null, Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED);
        }
    }

    async setLockPhysicalControls(value, callback) {
        const targetState = value === Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED ? 'Autoclean_On' : 'Autoclean_Off';
        this.log.info(`[SET] AutoClean -> ${targetState}`);
        try {
            await this.sendCommand('/mode', { options: [targetState] });
            callback(null);
        } catch (error) {
            this.log.error(`[SET] AutoClean 실패: ${error.message}`);
            callback(error);
        }
    }
}
