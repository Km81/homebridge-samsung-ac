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

        if (!this.ip || !this.token || !this.patchCert) {
            this.log.error("IP, 토큰, 인증서 경로(patchCert)는 필수 설정 항목입니다.");
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

        // --- 서비스 생성 ---
        this.informationService = new Service.AccessoryInformation()
            .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
            .setCharacteristic(Characteristic.Model, 'Air Conditioner')
            .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || 'AF16K7970WFN');
        
        // 1. 메인 냉난방기 서비스 생성
        this.heaterCoolerService = new Service.HeaterCooler(this.name);
        
        // 2. 팬 기능(스윙, 속도)을 위한 별도의 팬 서비스 생성
        this.fanService = new Service.Fanv2(this.name + ' 팬');
        
        // 3. 자동 청소 기능을 위한 별도의 스위치 서비스 생성
        this.autoCleanService = new Service.Switch(this.name + ' 자동청소', 'autoClean');
    }

    // ... _request, getCachedState, sendCommand 함수는 이전과 동일 ...
    _request(method, path, data = null) {
        return new Promise((resolve, reject) => {
            const options = { hostname: this.ip, port: 8888, path: path, method: method, headers: { 'Authorization': `Bearer ${this.token}` }, agent: this.httpsAgent, timeout: 5000 };
            if (data) {
                const postData = JSON.stringify(data);
                options.headers['Content-Type'] = 'application/json';
                options.headers['Content-Length'] = Buffer.byteLength(postData);
            }
            const req = https.request(options, (res) => {
                if (res.statusCode < 200 || res.statusCode >= 300) { return reject(new Error(`요청 실패, 상태 코드: ${res.statusCode}`)); }
                let body = [];
                res.on('data', (chunk) => body.push(chunk));
                res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(body).toString() || '{}')); } catch (e) { reject(e); } });
            });
            req.on('error', (e) => reject(e));
            req.on('timeout', () => { req.destroy(); reject(new Error('요청 시간 초과')); });
            if (data) { req.write(JSON.stringify(data)); }
            req.end();
        });
    }
    async getCachedState() {
        const now = Date.now();
        if (this.deviceState && (now - this.lastStateUpdate < this.cacheDuration)) { return this.deviceState; }
        this.log.info('기기에서 최신 상태를 가져옵니다...');
        try {
            const responseData = await this._request('GET', '/devices');
            this.deviceState = responseData.Devices[this.deviceIndex];
            this.lastStateUpdate = now;
            return this.deviceState;
        } catch (error) {
            this.log.error(`기기 상태를 가져오는 데 실패했습니다: ${error.message}`);
            if (this.deviceState) { this.log.warn('가져오기 오류로 인해 오래된 캐시 데이터를 반환합니다.'); return this.deviceState; }
            throw new Error('기기 상태를 가져올 수 없습니다.');
        }
    }
    async sendCommand(endpoint, data) {
        const fullEndpoint = `/devices/${this.setDeviceIndex}${endpoint}`;
        try {
            await this._request('PUT', fullEndpoint, data);
            this.log.info(`명령어를 ${fullEndpoint}(으)로 성공적으로 보냈습니다.`);
            this.deviceState = null;
            await this.getCachedState();
        } catch (error) {
            this.log.error(`${endpoint}(으)로 명령을 보내는 데 실패했습니다: ${error.message}`);
            throw error;
        }
    }
    identify(callback) {
        this.log.info("장치 식별 요청이 들어왔습니다!");
        callback();
    }

    getServices() {
        // --- 1. 메인 냉난방기 서비스 설정 ---
        this.heaterCoolerService.setPrimaryService(true);

        this.heaterCoolerService.getCharacteristic(Characteristic.Active)
            .on('get', this.getActive.bind(this))
            .on('set', this.setActive.bind(this));

        this.heaterCoolerService.getCharacteristic(Characteristic.CurrentTemperature)
            .on('get', this.getCurrentTemperature.bind(this));

        this.heaterCoolerService.getCharacteristic(Characteristic.TargetHeaterCoolerState)
            .setProps({ validValues: [Characteristic.TargetHeaterCoolerState.AUTO, Characteristic.TargetHeaterCoolerState.COOL] })
            .on('get', this.getTargetHeaterCoolerState.bind(this))
            .on('set', this.setTargetHeaterCoolerState.bind(this));

        this.heaterCoolerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
            .on('get', this.getCurrentHeaterCoolerState.bind(this));

        this.heaterCoolerService.getCharacteristic(Characteristic.CoolingThresholdTemperature)
            .setProps({ minValue: 18, maxValue: 30, minStep: 1 })
            .on('get', this.getTargetTemperature.bind(this))
            .on('set', this.setTargetTemperature.bind(this));
        
        // --- 2. 팬 서비스 설정 ---
        this.fanService.getCharacteristic(Characteristic.Active)
            .on('get', this.getActive.bind(this))
            .on('set', this.setActive.bind(this));
            
        this.fanService.getCharacteristic(Characteristic.SwingMode)
            .on('get', this.getSwingMode.bind(this))
            .on('set', this.setSwingMode.bind(this));
        
        this.fanService.getCharacteristic(Characteristic.RotationSpeed)
            .setProps({ minValue: 1, maxValue: 4, minStep: 1 })
            .on('get', this.getRotationSpeed.bind(this))
            .on('set', this.setRotationSpeed.bind(this));

        // --- 3. 자동 청소 스위치 서비스 설정 ---
        this.autoCleanService.getCharacteristic(Characteristic.On)
            .on('get', this.getLockPhysicalControls.bind(this))
            .on('set', this.setLockPhysicalControls.bind(this));
        
        // --- 4. 서비스 연결 및 반환 ---
        this.heaterCoolerService.addLinkedService(this.fanService);
        this.heaterCoolerService.addLinkedService(this.autoCleanService);

        return [this.informationService, this.heaterCoolerService];
    }

    // ... Getters & Setters ...
    async getActive(callback) {
        try {
            const state = await this.getCachedState();
            const isActive = state.Operation.power === "On" ? 1 : 0; // On: 1, Off: 0
            callback(null, isActive);
        } catch (error) {
            callback(error);
        }
    }
    async setActive(value, callback) {
        try {
            const power = value ? 'On' : 'Off';
            if (value === 0) { // 끄기
                await this.sendCommand('', { Operation: { power: 'Off' } });
            } else { // 켜기
                this.log.info('전원을 켠 후, "청정 건조" 모드로 설정합니다...');
                await this.sendCommand('', { Operation: { power: 'On' } });
                this.log.info('전원 켜짐. 2초 후 모드를 설정합니다...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                await this.sendCommand('/mode', { modes: ['DryClean'] });
                this.log.info('성공적으로 전원을 켜고 운전 모드를 설정했습니다.');
                this.heaterCoolerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.COOLING);
            }
            callback(null);
        } catch(error) {
            this.log.error('전원 상태 설정에 실패했습니다:', error);
            callback(error);
        }
    }
    async getCurrentTemperature(callback) {
        try {
            const state = await this.getCachedState();
            callback(null, state.Temperatures[0].current);
        } catch (error) {
            callback(error);
        }
    }
    async getTargetTemperature(callback) {
        try {
            const state = await this.getCachedState();
            callback(null, state.Temperatures[0].desired);
        } catch (error) {
            callback(error);
        }
    }
    async setTargetTemperature(value, callback) {
        try {
            await this.sendCommand('/temperatures/0', { desired: value });
            callback(null);
        } catch (error) {
            callback(error);
        }
    }
    async getSwingMode(callback) {
        try {
            const state = await this.getCachedState();
            if (this.swingModeType === 'wind') {
                const mode = state.Wind.direction;
                callback(null, mode === "Up_And_Low" ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED);
            } else {
                const isNano = state.Mode.options.includes("Comode_Nano");
                callback(null, isNano ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED);
            }
        } catch (error) {
            callback(error);
        }
    }
    async setSwingMode(value, callback) {
        try {
            const state = await this.getCachedState();
            if (this.swingModeType === 'wind') {
                const direction = value === Characteristic.SwingMode.SWING_ENABLED ? "Up_And_Low" : "Fix";
                await this.sendCommand('/wind', { direction: direction, speedLevel: state.Wind.speedLevel });
            } else {
                let currentOptions = state.Mode.options.filter(opt => opt !== 'Comode_Nano' && opt !== 'Comode_Off');
                const newSwingState = value === Characteristic.SwingMode.SWING_ENABLED ? "Comode_Nano" : "Comode_Off";
                currentOptions.push(newSwingState);
                await this.sendCommand('/mode', { options: currentOptions });
            }
            callback(null);
        } catch (error) {
            callback(error);
        }
    }
    async getRotationSpeed(callback) {
        try {
            const state = await this.getCachedState();
            const speedLevel = state.Wind.speedLevel;
            const percentSpeed = speedLevel * 25;
            this.log.debug('팬 속도 가져오기:', speedLevel, '->', percentSpeed, '%');
            callback(null, percentSpeed);
        } catch (error) {
            callback(error);
        }
    }
    async setRotationSpeed(value, callback) {
        try {
            let speedLevel = Math.ceil(value / 25);
            if (speedLevel < 1) speedLevel = 1;
            this.log.info(`팬 속도 설정: ${value}% (API 레벨: ${speedLevel})`);
            const state = await this.getCachedState();
            await this.sendCommand('/wind', { speedLevel: speedLevel, direction: state.Wind.direction });
            callback(null);
        } catch (error) {
            callback(error);
        }
    }
    async getLockPhysicalControls(callback) {
        try {
            const state = await this.getCachedState();
            const isEnabled = state.Mode.options.includes("Autoclean_On");
            callback(null, isEnabled ? 1 : 0);
        } catch (error) {
            callback(error);
        }
    }
    async setLockPhysicalControls(value, callback) {
        try {
            const newAutocleanState = value ? 'Autoclean_On' : 'Autoclean_Off';
            this.log.info(`자동 청소 설정 변경: ${newAutocleanState}`);
            await this.sendCommand('/mode', { options: [newAutocleanState] });
            callback(null);
        } catch (error) {
            callback(error);
        }
    }
    async getCurrentHeaterCoolerState(callback) {
        try {
            const state = await this.getCachedState();
            const currentMode = state.Mode.modes[0];
            const windModes = ["Wind"];
            const coolModes = ["CoolClean", "Cool", "Dry", "DryClean", "Auto"];
            if (windModes.includes(currentMode)) {
                callback(null, Characteristic.CurrentHeaterCoolerState.IDLE);
            } else if (coolModes.includes(currentMode)) {
                callback(null, Characteristic.CurrentHeaterCoolerState.COOLING);
            } else {
                callback(null, Characteristic.CurrentHeaterCoolerState.IDLE);
            }
        } catch (error) {
            callback(error);
        }
    }
    getTargetHeaterCoolerState(callback) {
        this.getCurrentHeaterCoolerState(callback);
    }
    async setTargetHeaterCoolerState(value, callback) {
        try {
            if (value === Characteristic.TargetHeaterCoolerState.COOL) {
                await this.sendCommand('/mode', { modes: ["CoolClean"] });
                this.heaterCoolerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.COOLING);
            } else if (value === Characteristic.TargetHeaterCoolerState.AUTO) {
                await this.sendCommand('/mode', { modes: ["Wind"] });
                this.heaterCoolerService.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.IDLE);
            }
            callback(null);
        } catch (error) {
            callback(error);
        }
    }
}
