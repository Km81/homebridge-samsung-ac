// Version 1.5.2
// 'use strict'; 는 자바스크립트의 엄격 모드를 활성화하여, 잠재적인 오류를 줄여주는 좋은 습관입니다.
'use strict';

const https = require('https');
const fs = require('fs');

var Service, Characteristic, Accessory;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    Accessory = homebridge.hap.Accessory;
    homebridge.registerAccessory('homebridge-samsung-ac', 'SamsungAC', SamsungAirco);
}

class SamsungAirco {
    constructor(log, config) {
        this.log = log;
        this.name = config.name;
        this.ip = config.ip;
        this.token = config.token;
        this.patchCert = config.patchCert;
        this.deviceIndex = config.deviceIndex || 0;
        this.setDeviceIndex = config.setDeviceIndex ?? this.deviceIndex;
        this.swingModeType = config.swingModeType || 'comfort';
        this.cacheDuration = config.cacheDuration || 3000;

        this.log.info(`[${this.name}] 플러그인 초기화 중... 버전 1.5.2`);

        if (!this.ip || !this.token || !this.patchCert) {
            this.log.error(`[${this.name}] IP, 토큰, 인증서 경로는 필수 설정 항목입니다.`);
            return;
        }

        this.httpsAgent = new https.Agent({
            cert: fs.readFileSync(this.patchCert),
            key: fs.readFileSync(this.patchCert),
            rejectUnauthorized: false,
            ciphers: 'DEFAULT@SECLEVEL=1',
            secureProtocol: 'TLSv1_method'
        });
        
        this.deviceState = {
            Operation: { power: 'Off' },
            Temperatures: [{ current: 25, desired: 25 }],
            Mode: { modes: ['Cool'], options: [] },
            Wind: { direction: 'Fix' }
        };
        this.lastStateUpdate = 0;
        this.isFetching = false;

        this.aircoSamsung = new Service.HeaterCooler(this.name);
        this.informationService = new Service.AccessoryInformation()
            .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
            .setCharacteristic(Characteristic.Model, 'Air Conditioner')
            .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || 'AF16K7970WFN');
        
        this.getAndUpdateStateInBackground('초기화');
    }

    _request(method, path, data = null) {
        return new Promise((resolve, reject) => {
            const options = { hostname: this.ip, port: 8888, path, method, headers: { 'Authorization': `Bearer ${this.token}` }, agent: this.httpsAgent, timeout: 5000 };
            if (data) {
                const postData = JSON.stringify(data);
                options.headers['Content-Type'] = 'application/json';
                options.headers['Content-Length'] = Buffer.byteLength(postData);
            }
            const req = https.request(options, (res) => {
                if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`요청 실패, 상태 코드: ${res.statusCode}`));
                let body = [];
                res.on('data', (chunk) => body.push(chunk));
                res.on('end', () => {
                    try { resolve(JSON.parse(Buffer.concat(body).toString() || '{}')); } 
                    catch (e) { reject(e); }
                });
            });
            req.on('error', (e) => reject(e));
            req.on('timeout', () => { req.destroy(); reject(new Error('요청 시간 초과')); });
            if (data) req.write(JSON.stringify(data));
            req.end();
        });
    }

    async getAndUpdateStateInBackground(caller = '배경 업데이트') {
        if (this.isFetching) return;
        this.log.info(`[${this.name}] [${caller}] 배경에서 실제 기기 상태를 가져옵니다...`);
        this.isFetching = true;
        try {
            const responseData = await this._request('GET', '/devices');
            if (responseData && responseData.Devices && responseData.Devices[this.deviceIndex]) {
                this.deviceState = responseData.Devices[this.deviceIndex];
                this.lastStateUpdate = Date.now();
                this.log.info(`[${this.name}] 배경 업데이트 성공. 홈킷 UI에 상태를 푸시합니다.`);
                this.pushStateToHomeKit();
            }
        } catch (error) {
            this.log.error(`[${this.name}] 배경 상태 업데이트 실패: ${error.message}`);
        } finally {
            this.isFetching = false;
        }
    }
    
    pushStateToHomeKit() {
        if (!this.deviceState) return;
        this.log.info(`[${this.name}] --- 홈킷 UI 푸시 업데이트 시작 ---`);
        const { Active, CurrentTemperature, CoolingThresholdTemperature, CurrentHeaterCoolerState, SwingMode, LockPhysicalControls } = Characteristic;

        const powerState = this.deviceState.Operation.power === "On";
        this.log.info(`[${this.name}] [PUSH] 전원: ${powerState ? '켜짐' : '꺼짐'}`);
        this.aircoSamsung.updateCharacteristic(Active, powerState);

        const currentTemp = this.deviceState.Temperatures[0].current;
        this.log.info(`[${this.name}] [PUSH] 현재 온도: ${currentTemp}°C`);
        this.aircoSamsung.updateCharacteristic(CurrentTemperature, currentTemp);
        
        const desiredTemp = this.deviceState.Temperatures[0].desired;
        this.log.info(`[${this.name}] [PUSH] 목표 온도: ${desiredTemp}°C`);
        this.aircoSamsung.updateCharacteristic(CoolingThresholdTemperature, desiredTemp);

        const coolModes = ["CoolClean", "Cool", "Dry", "DryClean", "Auto", "Wind"];
        const currentState = (this.deviceState.Operation.power === 'On' && coolModes.includes(this.deviceState.Mode.modes[0])) ? CurrentHeaterCoolerState.COOLING : CurrentHeaterCoolerState.IDLE;
        this.log.info(`[${this.name}] [PUSH] 현재 상태: ${currentState === 2 ? '냉방중' : '대기'}`);
        this.aircoSamsung.updateCharacteristic(CurrentHeaterCoolerState, currentState);
        
        const swingModeValue = (this.swingModeType === 'wind') ? this.deviceState.Wind.direction === "Up_And_Low" : this.deviceState.Mode.options.includes("Comode_Nano");
        this.log.info(`[${this.name}] [PUSH] ${this.swingModeType === 'wind' ? '스윙' : '무풍'}: ${swingModeValue ? '켜짐' : '꺼짐'}`);
        this.aircoSamsung.updateCharacteristic(SwingMode, swingModeValue);

        const isAutoCleanOn = this.deviceState.Mode.options.includes("Autoclean_On");
        this.log.info(`[${this.name}] [PUSH] 자동 청소: ${isAutoCleanOn ? '켜짐' : '꺼짐'}`);
        this.aircoSamsung.updateCharacteristic(LockPhysicalControls, isAutoCleanOn);
        
        this.log.info(`[${this.name}] --- 홈킷 UI 푸시 업데이트 완료 ---`);
    }
    
    handleGet(callback, caller, valueExtractor) {
        const value = valueExtractor(this.deviceState);
        this.log.info(`[${this.name}] [GET] '${caller}' 요청 받음. 캐시된 값 (${value}) (으)로 즉시 응답합니다.`);
        callback(null, value);

        if (Date.now() - this.lastStateUpdate > this.cacheDuration) {
            this.getAndUpdateStateInBackground(caller);
        }
    }

    async sendCommand(endpoint, data) {
        const fullEndpoint = `/devices/${this.setDeviceIndex}${endpoint}`;
        try {
            this.log.info(`[${this.name}] [SET] 명령어 전송: ${endpoint} 데이터: ${JSON.stringify(data)}`);
            await this._request('PUT', fullEndpoint, data);
            this.lastStateUpdate = 0;
            setTimeout(() => this.getAndUpdateStateInBackground(`명령 후 업데이트 (${endpoint})`), 1500);
        } catch (error) {
            this.log.error(`[${this.name}] 명령어 전송 실패: ${error.message}`);
            throw error;
        }
    }

    identify(callback) {
        this.log.info(`[${this.name}] 장치 식별 요청!`);
        callback();
    }

    getServices() {
        this.aircoSamsung.setPrimaryService(true);
        const { Active, CurrentHeaterCoolerState, TargetHeaterCoolerState, CurrentTemperature, CoolingThresholdTemperature, SwingMode, LockPhysicalControls } = Characteristic;

        this.aircoSamsung.getCharacteristic(Active)
            .on('get', cb => this.handleGet(cb, '전원', s => s.Operation.power === "On"))
            .on('set', this.setActive.bind(this));
        
        this.aircoSamsung.getCharacteristic(CurrentHeaterCoolerState)
            .on('get', cb => this.handleGet(cb, '현재 운전 모드', s => {
                const coolModes = ["CoolClean", "Cool", "Dry", "DryClean", "Auto", "Wind"];
                return (s.Operation.power === 'On' && coolModes.includes(s.Mode.modes[0])) ? CurrentHeaterCoolerState.COOLING : CurrentHeaterCoolerState.IDLE;
            }));
        
        this.aircoSamsung.getCharacteristic(TargetHeaterCoolerState)
            .setProps({ validValues: [TargetHeaterCoolerState.COOL] })
            .on('get', cb => this.handleGet(cb, '목표 운전 모드', () => TargetHeaterCoolerState.COOL))
            .on('set', this.setTargetHeaterCoolerState.bind(this));
        
        this.aircoSamsung.getCharacteristic(CurrentTemperature)
            .on('get', cb => this.handleGet(cb, '현재 온도', s => s.Temperatures[0].current));
        
        this.aircoSamsung.getCharacteristic(CoolingThresholdTemperature)
            .setProps({ minValue: 18, maxValue: 30, minStep: 1 })
            .on('get', cb => this.handleGet(cb, '목표 온도', s => s.Temperatures[0].desired))
            .on('set', this.setTargetTemperature.bind(this));
        
        this.aircoSamsung.getCharacteristic(SwingMode)
            .on('get', cb => this.handleGet(cb, '스윙/무풍 모드', s => (this.swingModeType === 'wind') ? s.Wind.direction === "Up_And_Low" : s.Mode.options.includes("Comode_Nano")))
            .on('set', this.setSwingMode.bind(this));
        
        this.aircoSamsung.getCharacteristic(LockPhysicalControls)
            .on('get', cb => this.handleGet(cb, '자동 청소', s => s.Mode.options.includes("Autoclean_On")))
            .on('set', this.setLockPhysicalControls.bind(this));
        
        return [this.informationService, this.aircoSamsung];
    }
    
    // --- Setters ---
    async setActive(value, callback) {
        this.log.info(`[${this.name}] [SET] '전원'을(를) ${value ? '켜짐' : '꺼짐'}(으)로 설정합니다.`);
        try {
            await this.sendCommand('', { Operation: { power: value ? 'On' : 'Off' } });
            callback(null);
        } catch (error) {
            this.log.error(`[${this.name}] '전원' 상태 설정 실패:`, error);
            callback(error);
        }
    }
    async setTargetTemperature(value, callback) {
        this.log.info(`[${this.name}] [SET] '목표 온도'를(을) ${value}°C(으)로 설정합니다.`);
        try {
            await this.sendCommand('/temperatures/0', { desired: value });
            callback(null);
        } catch (error) { callback(error); }
    }
    async setSwingMode(value, callback) {
        const mode = this.swingModeType === 'wind' ? '스윙' : '무풍';
        this.log.info(`[${this.name}] [SET] '${mode}'을(를) ${value ? '켜짐' : '꺼짐'}(으)로 설정합니다.`);
        try {
            const command = (this.swingModeType === 'wind')
                ? { direction: value ? "Up_And_Low" : "Fix" }
                : { options: [value ? "Comode_Nano" : "Comode_Off"] };
            const endpoint = this.swingModeType === 'wind' ? '/wind' : '/mode';
            await this.sendCommand(endpoint, command);
            callback(null);
        } catch (error) { callback(error); }
    }
    async setLockPhysicalControls(value, callback) {
        this.log.info(`[${this.name}] [SET] '자동 청소'를(을) ${value ? '켜짐' : '꺼짐'}(으)로 설정합니다.`);
        try {
            await this.sendCommand('/mode', { options: [value ? 'Autoclean_On' : 'Autoclean_Off'] });
            callback(null);
        } catch (error) { callback(error); }
    }
    async setTargetHeaterCoolerState(value, callback) {
        this.log.info(`[${this.name}] [SET] '목표 운전 모드'를(을) ${value}(으)로 설정합니다.`);
        try {
            if (value === Characteristic.TargetHeaterCoolerState.COOL) {
                await this.sendCommand('/mode', { modes: ["DryClean"] });
            }
            callback(null);
        } catch (error) { callback(error); }
    }
}
