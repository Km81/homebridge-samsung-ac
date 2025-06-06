'use strict';

const axios = require('axios');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto'); // <-- 이 줄을 추가해주세요!

var Service, Characteristic, Accessory;

module.exports = function(homebridge) {
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    Accessory = homebridge.hap.Accessory;
    // 플러그인 식별자와 Accessory 이름을 요청하신 내용에 맞게 변경
    homebridge.registerAccessory('homebridge-samsung-ac', 'SamsungAC', SamsungAirco);
}

class SamsungAirco {
    constructor(log, config) {
        this.log = log;
        this.name = config.name;

        // --- 통합 및 강화된 설정 ---
        this.ip = config.ip;
        this.token = config.token;
        this.patchCert = config.patchCert;
        
        this.deviceIndex = config.deviceIndex || 0; 
        this.setDeviceIndex = config.setDeviceIndex ?? this.deviceIndex;
        this.swingModeType = config.swingModeType || 'comfort'; // 'comfort' for Comode_Nano, 'wind' for Up_And_Low

        this.cacheDuration = config.cacheDuration || 3000; // 3초 캐시

        if (!this.ip || !this.token || !this.patchCert) {
            this.log.error("IP, token, and patchCert must be configured.");
            return;
        }

        // --- Axios 인스턴스 생성 ---
        this.api = axios.create({
            baseURL: `https://${this.ip}:8888`,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`
            },
            httpsAgent: new https.Agent({
                cert: fs.readFileSync(this.patchCert),
                rejectUnauthorized: false,
                ciphers: 'DEFAULT@SECLEVEL=1', // 약한 인증서 서명(SHA1) 허용
                secureProtocol: 'TLSv1_method'  // 결정적 해결책: TLSv1.0 프로토콜 사용 강제
            }),
            timeout: 5000
        });

        // --- 상태 캐싱 변수 ---
        this.deviceState = null;
        this.lastStateUpdate = 0;

        // --- 서비스 생성 ---
        this.aircoSamsung = new Service.HeaterCooler(this.name);
        this.informationService = new Service.AccessoryInformation()
            .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
            .setCharacteristic(Characteristic.Model, 'Air Conditioner')
            .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || 'DefaultSN');
    }

    // --- 상태 캐싱 헬퍼 ---
    async getCachedState() {
        const now = Date.now();
        if (this.deviceState && (now - this.lastStateUpdate < this.cacheDuration)) {
            return this.deviceState;
        }

        this.log.info('Fetching latest state from device...');
        try {
            const response = await this.api.get('/devices');
            this.deviceState = response.data.Devices[this.deviceIndex];
            this.lastStateUpdate = now;
            return this.deviceState;
        } catch (error) {
            this.log.error(`Failed to fetch device state: ${error.message}`);
            if (this.deviceState) {
                this.log.warn('Returning stale data due to fetch error.');
                return this.deviceState;
            }
            throw new Error('Could not fetch device state.');
        }
    }

    // --- API 제어 헬퍼 ---
    async sendCommand(endpoint, data) {
        try {
            const fullEndpoint = `/devices/${this.setDeviceIndex}${endpoint}`;
            await this.api.put(fullEndpoint, data);
            this.log.info(`Command sent to ${fullEndpoint} successfully.`);
            this.deviceState = null; // 캐시 무효화
            await this.getCachedState();
        } catch (error) {
            this.log.error(`Failed to send command to ${endpoint}: ${error.message}`);
            throw error;
        }
    }

    identify(callback) {
        this.log.info("Identify requested!");
        callback();
    }

    getServices() {
        // --- .onGet -> .on('get', ...) 으로, .onSet -> .on('set', ...) 으로 수정 ---

        this.aircoSamsung.getCharacteristic(Characteristic.Active)
            .on('get', this.getActive.bind(this))
            .on('set', this.setActive.bind(this));

        this.aircoSamsung.getCharacteristic(Characteristic.CurrentTemperature)
            .on('get', this.getCurrentTemperature.bind(this));

        this.aircoSamsung.getCharacteristic(Characteristic.TargetHeaterCoolerState)
            .setProps({ validValues: [Characteristic.TargetHeaterCoolerState.COOL] })
            .on('get', this.getTargetHeaterCoolerState.bind(this))
            .on('set', this.setTargetHeaterCoolerState.bind(this));

        this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
            .on('get', this.getCurrentHeaterCoolerState.bind(this));

        this.aircoSamsung.getCharacteristic(Characteristic.CoolingThresholdTemperature)
            .setProps({ minValue: 18, maxValue: 30, minStep: 1 })
            .on('get', this.getTargetTemperature.bind(this))
            .on('set', this.setTargetTemperature.bind(this));

        this.aircoSamsung.getCharacteristic(Characteristic.SwingMode)
            .on('get', this.getSwingMode.bind(this))
            .on('set', this.setSwingMode.bind(this));

        return [this.informationService, this.aircoSamsung];
    }
    
    // --- Getters & Setters ---

    async getActive() {
        const state = await this.getCachedState();
        return state.Operation.power === "On" ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
    }

    async setActive(value) {
        const power = value === Characteristic.Active.ACTIVE ? "On" : "Off";
        await this.sendCommand('', { Operation: { power: power } });
    }

    async getCurrentTemperature() {
        const state = await this.getCachedState();
        return state.Temperatures[0].current;
    }

    async getTargetTemperature() {
        const state = await this.getCachedState();
        return state.Temperatures[0].desired;
    }

    async setTargetTemperature(value) {
        await this.sendCommand('/temperatures/0', { desired: value });
    }

    // --- 설정 기반으로 분기하는 스윙 모드 로직 ---
    async getSwingMode() {
        const state = await this.getCachedState();
        if (this.swingModeType === 'wind') {
            const mode = state.Wind.direction;
            return mode === "Up_And_Low" ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED;
        } else {
            const isNano = state.Mode.options.includes("Comode_Nano");
            return isNano ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED;
        }
    }

    async setSwingMode(value) {
        if (this.swingModeType === 'wind') {
            const direction = value === Characteristic.SwingMode.SWING_ENABLED ? "Up_And_Low" : "Fix";
            await this.sendCommand('/wind', { direction: direction });
        } else {
            const mode = value === Characteristic.SwingMode.SWING_ENABLED ? "Comode_Nano" : "Comode_Off";
            await this.sendCommand('/mode', { options: [mode] });
        }
    }

    async getCurrentHeaterCoolerState() {
        const state = await this.getCachedState();
        const coolModes = ["CoolClean", "Cool", "Dry", "DryClean", "Auto", "Wind"];
        const isCooling = coolModes.includes(state.Mode.modes[0]);
        return isCooling ? Characteristic.CurrentHeaterCoolerState.COOLING : Characteristic.CurrentHeaterCoolerState.IDLE;
    }

    async getTargetHeaterCoolerState() {
        return this.getCurrentHeaterCoolerState();
    }
    
    async setTargetHeaterCoolerState(value) {
        if (value === Characteristic.TargetHeaterCoolerState.COOL) {
            await this.sendCommand('/mode', { modes: ["Cool"] });
            this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.COOLING);
        }
    }
}
