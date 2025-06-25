// Version 1.5.0
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

        this.log.info(`[${this.name}] 플러그인 초기화 중... 버전 1.5.0`);

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
        
        this.deviceState = null;
        this.lastStateUpdate = 0;
        this.isFetching = false;
        this.statePromise = null;

        this.aircoSamsung = new Service.HeaterCooler(this.name);
        this.informationService = new Service.AccessoryInformation()
            .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
            .setCharacteristic(Characteristic.Model, 'Air Conditioner')
            .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || 'AF16K7970WFN');
    }

    _request(method, path, data = null) {
        this.log.debug(`[${this.name}] [REQUEST] --> ${method} ${path}`);
        return new Promise((resolve, reject) => {
            const options = { hostname: this.ip, port: 8888, path: path, method: method, headers: { 'Authorization': `Bearer ${this.token}` }, agent: this.httpsAgent, timeout: 5000 };
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
                    try { 
                        const parsedBody = JSON.parse(Buffer.concat(body).toString() || '{}');
                        this.log.debug(`[${this.name}] [RESPONSE] <-- ${method} ${path} 성공`);
                        resolve(parsedBody);
                    } catch (e) { reject(e); }
                });
            });
            req.on('error', (e) => reject(e));
            req.on('timeout', () => { req.destroy(); reject(new Error('요청 시간 초과')); });
            if (data) req.write(JSON.stringify(data));
            req.end();
        });
    }

    async getCachedState(caller = '알 수 없는 요청') {
        const now = Date.now();
        if (this.deviceState && (now - this.lastStateUpdate < this.cacheDuration)) {
            return this.deviceState;
        }

        if (this.isFetching) {
            this.log.debug(`[${this.name}] '${caller}': 현재 다른 요청이 진행 중이므로 기다립니다.`);
            return this.statePromise;
        }

        this.log.info(`[${this.name}] '${caller}': 기기에서 최신 상태를 가져옵니다...`);
        this.statePromise = new Promise(async (resolve, reject) => {
            this.isFetching = true;
            try {
                const responseData = await this._request('GET', '/devices');
                this.deviceState = responseData.Devices[this.deviceIndex];
                this.lastStateUpdate = Date.now();
                this.log.debug(`[${this.name}] 상태 업데이트 완료.`);
                resolve(this.deviceState);
            } catch (error) {
                this.log.error(`[${this.name}] '${caller}' 상태 가져오기 실패: ${error.message}`);
                if (this.deviceState) {
                    this.log.warn(`[${this.name}] 오류가 발생했지만, 이전 캐시 데이터를 사용합니다.`);
                    resolve(this.deviceState);
                } else {
                    reject(new Error('기기 상태를 가져올 수 없습니다.'));
                }
            } finally {
                this.isFetching = false;
                this.statePromise = null;
            }
        });
        return this.statePromise;
    }

    async sendCommand(endpoint, data) {
        const fullEndpoint = `/devices/${this.setDeviceIndex}${endpoint}`;
        try {
            this.log.info(`[${this.name}] [SET] 명령어 전송: ${endpoint} 데이터: ${JSON.stringify(data)}`);
            await this._request('PUT', fullEndpoint, data);
            this.log.info(`[${this.name}] [SET] 명령어 전송 성공.`);
            this.deviceState = null;
        } catch (error) {
            this.log.error(`[${this.name}] [SET] 명령어 전송 실패: ${error.message}`);
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
            .on('get', this.getActive.bind(this))
            .on('set', this.setActive.bind(this));
        
        this.aircoSamsung.getCharacteristic(CurrentHeaterCoolerState)
            .on('get', this.getCurrentHeaterCoolerState.bind(this));
        
        this.aircoSamsung.getCharacteristic(TargetHeaterCoolerState)
            .setProps({ validValues: [TargetHeaterCoolerState.COOL] })
            .on('get', this.getTargetHeaterCoolerState.bind(this))
            .on('set', this.setTargetHeaterCoolerState.bind(this));
        
        this.aircoSamsung.getCharacteristic(CurrentTemperature)
            .on('get', this.getCurrentTemperature.bind(this));
        
        this.aircoSamsung.getCharacteristic(CoolingThresholdTemperature)
            .setProps({ minValue: 18, maxValue: 30, minStep: 1 })
            .on('get', this.getTargetTemperature.bind(this))
            .on('set', this.setTargetTemperature.bind(this));
        
        this.aircoSamsung.getCharacteristic(SwingMode)
            .on('get', this.getSwingMode.bind(this))
            .on('set', this.setSwingMode.bind(this));
        
        this.aircoSamsung.getCharacteristic(LockPhysicalControls)
            .on('get', this.getLockPhysicalControls.bind(this))
            .on('set', this.setLockPhysicalControls.bind(this));
        
        return [this.informationService, this.aircoSamsung];
    }
    
    // --- Getters & Setters ---
    async getActive(callback) {
        try {
            const state = await this.getCachedState('전원');
            callback(null, state.Operation.power === "On");
        } catch (error) { callback(error); }
    }

    async setActive(value, callback) {
        try {
            await this.sendCommand('', { Operation: { power: value ? 'On' : 'Off' } });
            callback(null);
        } catch (error) {
            this.log.error(`[${this.name}] [SET] '전원' 상태 설정 실패:`, error);
            callback(error);
        }
    }

    async getCurrentTemperature(callback) {
        try {
            const state = await this.getCachedState('현재 온도');
            callback(null, state.Temperatures[0].current);
        } catch (error) { callback(error); }
    }

    async getTargetTemperature(callback) {
        try {
            const state = await this.getCachedState('목표 온도');
            callback(null, state.Temperatures[0].desired);
        } catch (error) { callback(error); }
    }

    async setTargetTemperature(value, callback) {
        try {
            await this.sendCommand('/temperatures/0', { desired: value });
            callback(null);
        } catch (error) { callback(error); }
    }

    async getSwingMode(callback) {
        try {
            const state = await this.getCachedState('스윙/무풍 모드');
            const swingModeValue = (this.swingModeType === 'wind') ? state.Wind.direction === "Up_And_Low" : state.Mode.options.includes("Comode_Nano");
            callback(null, swingModeValue);
        } catch (error) { callback(error); }
    }

    async setSwingMode(value, callback) {
        try {
            const command = this.swingModeType === 'wind'
                ? { direction: value ? "Up_And_Low" : "Fix" }
                : { options: [value ? "Comode_Nano" : "Comode_Off"] };
            const endpoint = this.swingModeType === 'wind' ? '/wind' : '/mode';
            await this.sendCommand(endpoint, command);
            callback(null);
        } catch (error) { callback(error); }
    }

    async getLockPhysicalControls(callback) {
        try {
            const state = await this.getCachedState('자동 청소');
            callback(null, state.Mode.options.includes("Autoclean_On"));
        } catch (error) { callback(error); }
    }

    async setLockPhysicalControls(value, callback) {
        try {
            await this.sendCommand('/mode', { options: [value ? 'Autoclean_On' : 'Autoclean_Off'] });
            callback(null);
        } catch (error) { callback(error); }
    }

    async getCurrentHeaterCoolerState(callback) {
        try {
            const state = await this.getCachedState('현재 운전 모드');
            const coolModes = ["CoolClean", "Cool", "Dry", "DryClean", "Auto", "Wind"];
            if (state.Operation.power === 'On' && coolModes.includes(state.Mode.modes[0])) {
                callback(null, Characteristic.CurrentHeaterCoolerState.COOLING);
            } else {
                callback(null, Characteristic.CurrentHeaterCoolerState.IDLE);
            }
        } catch (error) { callback(error); }
    }

    getTargetHeaterCoolerState(callback) {
        this.getCurrentHeaterCoolerState(callback);
    }
    
    async setTargetHeaterCoolerState(value, callback) {
        try {
            if (value === Characteristic.TargetHeaterCoolerState.COOL) {
                await this.sendCommand('/mode', { modes: ["DryClean"] });
            }
            callback(null);
        } catch (error) { callback(error); }
    }
}
