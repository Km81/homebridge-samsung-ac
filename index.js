// Version 1.7.1
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

        this.log.info(`[${this.name}] 플러그인 초기화 중... 버전 1.7.1`);

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

        this.aircoSamsung = new Service.HeaterCooler(this.name);
        this.informationService = new Service.AccessoryInformation()
            .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
            .setCharacteristic(Characteristic.Model, 'Air Conditioner')
            .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || 'DefaultSN');
    }

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
                    return reject(new Error(`Request failed with status code ${res.statusCode}`));
                }
                let body = [];
                res.on('data', (chunk) => body.push(chunk));
                res.on('end', () => {
                    try {
                        const responseBody = Buffer.concat(body).toString();
                        resolve(responseBody ? JSON.parse(responseBody) : {});
                    } catch (e) {
                        reject(e);
                    }
                });
            });
            req.on('error', (e) => reject(e));
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timed out'));
            });
            if (data) {
                req.write(JSON.stringify(data));
            }
            req.end();
        });
    }

    getCachedState() {
        const now = Date.now();
        if (this.deviceState && (now - this.lastStateUpdate < this.cacheDuration)) {
            return Promise.resolve(this.deviceState);
        }
        this.log.info(`[${this.name}] 기기에서 최신 상태를 가져옵니다...`);
        return this._request('GET', '/devices')
            .then(responseData => {
                this.deviceState = responseData.Devices[this.deviceIndex];
                this.lastStateUpdate = now;
                return this.deviceState;
            })
            .catch(error => {
                this.log.error(`[${this.name}] 기기 상태를 가져오는 데 실패했습니다: ${error.message}`);
                if (this.deviceState) {
                    this.log.warn(`[${this.name}] 오류가 발생했지만, 이전 캐시 데이터를 사용합니다.`);
                    return this.deviceState;
                }
                throw new Error('Could not fetch device state.');
            });
    }

    sendCommand(endpoint, data) {
        const fullEndpoint = `/devices/${this.setDeviceIndex}${endpoint}`;
        return this._request('PUT', fullEndpoint, data)
            .then(() => {
                this.log.info(`[${this.name}] [SET] 명령어 전송 성공: ${fullEndpoint}`);
                this.deviceState = null;
                return this.getCachedState();
            })
            .catch(error => {
                this.log.error(`[${this.name}] [SET] 명령어 전송 실패: ${endpoint}: ${error.message}`);
                throw error;
            });
    }

    identify(callback) {
        this.log.info("Identify requested!");
        callback();
    }

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

    getActive(callback) {
        this.log.info(`[${this.name}] [GET] '전원' 상태 요청`);
        this.getCachedState().then(state => {
            const isActive = state.Operation.power === "On" ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
            this.log.info(`[${this.name}] [GET] '전원' 상태 응답: ${isActive === 1 ? '켜짐' : '꺼짐'}`);
            callback(null, isActive);
        }).catch(error => {
            this.log.error(`[${this.name}] [GET] '전원' 상태 요청 실패:`, error);
            callback(error);
        });
    }

    setActive(value, callback) {
        const command = value === Characteristic.Active.ACTIVE ? 'On' : 'Off';
        this.log.info(`[${this.name}] [SET] '전원'을(를) ${command}(으)로 설정합니다.`);
        this.sendCommand('', { Operation: { power: command } })
            .then(() => {
                if (value === Characteristic.Active.ACTIVE) {
                    this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.COOLING);
                }
                callback(null);
            })
            .catch(error => callback(error));
    }

    getCurrentTemperature(callback) {
        this.log.info(`[${this.name}] [GET] '현재 온도' 요청`);
        this.getCachedState().then(state => {
            const temp = state.Temperatures[0].current;
            this.log.info(`[${this.name}] [GET] '현재 온도' 응답: ${temp}°C`);
            callback(null, temp);
        }).catch(error => {
            this.log.error(`[${this.name}] [GET] '현재 온도' 요청 실패:`, error);
            callback(error);
        });
    }

    getTargetTemperature(callback) {
        this.log.info(`[${this.name}] [GET] '목표 온도' 요청`);
        this.getCachedState().then(state => {
            const temp = state.Temperatures[0].desired;
            this.log.info(`[${this.name}] [GET] '목표 온도' 응답: ${temp}°C`);
            callback(null, temp);
        }).catch(error => {
            this.log.error(`[${this.name}] [GET] '목표 온도' 요청 실패:`, error);
            callback(error);
        });
    }

    setTargetTemperature(value, callback) {
        this.log.info(`[${this.name}] [SET] '목표 온도'를(을) ${value}°C(으)로 설정합니다.`);
        this.sendCommand('/temperatures/0', { desired: value })
            .then(() => callback(null))
            .catch(error => callback(error));
    }

    getSwingMode(callback) {
        const modeName = this.swingModeType === 'wind' ? '스윙' : '무풍';
        this.log.info(`[${this.name}] [GET] '${modeName}' 상태 요청`);
        this.getCachedState().then(state => {
            const isEnabled = (this.swingModeType === 'wind')
                ? state.Wind.direction === "Up_And_Low"
                : state.Mode.options.includes("Comode_Nano");
            this.log.info(`[${this.name}] [GET] '${modeName}' 상태 응답: ${isEnabled ? '켜짐' : '꺼짐'}`);
            callback(null, isEnabled ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED);
        }).catch(error => {
            this.log.error(`[${this.name}] [GET] '${modeName}' 상태 요청 실패:`, error);
            callback(error);
        });
    }

    setSwingMode(value, callback) {
        const modeName = this.swingModeType === 'wind' ? '스윙' : '무풍';
        const commandValue = value === Characteristic.SwingMode.SWING_ENABLED;
        this.log.info(`[${this.name}] [SET] '${modeName}'을(를) ${commandValue ? '켜짐' : '꺼짐'}(으)로 설정합니다.`);
        let promise;
        if (this.swingModeType === 'wind') {
            promise = this.sendCommand('/wind', { direction: commandValue ? "Up_And_Low" : "Fix" });
        } else {
            promise = this.sendCommand('/mode', { options: [commandValue ? "Comode_Nano" : "Comode_Off"] });
        }
        promise.then(() => callback(null)).catch(error => callback(error));
    }

    getLockPhysicalControls(callback) {
        this.log.info(`[${this.name}] [GET] '자동 청소' 상태 요청`);
        this.getCachedState().then(state => {
            const isEnabled = state.Mode.options.includes("Autoclean_On");
            this.log.info(`[${this.name}] [GET] '자동 청소' 상태 응답: ${isEnabled ? '켜짐' : '꺼짐'}`);
            callback(null, isEnabled ? Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED : Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED);
        }).catch(error => {
            this.log.error(`[${this.name}] [GET] '자동 청소' 상태 요청 실패:`, error);
            callback(error);
        });
    }

    setLockPhysicalControls(value, callback) {
        const commandValue = value === Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED;
        this.log.info(`[${this.name}] [SET] '자동 청소'를(을) ${commandValue ? '켜짐' : '꺼짐'}(으)로 설정합니다.`);
        this.sendCommand('/mode', { options: [commandValue ? 'Autoclean_On' : 'Autoclean_Off'] })
            .then(() => callback(null))
            .catch(error => callback(error));
    }

    getCurrentHeaterCoolerState(callback) {
        this.log.info(`[${this.name}] [GET] '현재 운전 모드' 요청`);
        this.getCachedState().then(state => {
            const coolModes = ["CoolClean", "Cool", "Dry", "DryClean", "Auto", "Wind"];
            const isCooling = state.Operation.power === 'On' && coolModes.includes(state.Mode.modes[0]);
            this.log.info(`[${this.name}] [GET] '현재 운전 모드' 응답: ${isCooling ? '냉방중' : '대기'}`);
            callback(null, isCooling ? Characteristic.CurrentHeaterCoolerState.COOLING : Characteristic.CurrentHeaterCoolerState.IDLE);
        }).catch(error => {
            this.log.error(`[${this.name}] [GET] '현재 운전 모드' 요청 실패:`, error);
            callback(error);
        });
    }

    getTargetHeaterCoolerState(callback) {
        this.getCurrentHeaterCoolerState(callback);
    }
    
    setTargetHeaterCoolerState(value, callback) {
        this.log.info(`[${this.name}] [SET] '목표 운전 모드'를(을) ${value}(으)로 설정합니다.`);
        if (value === Characteristic.TargetHeaterCoolerState.COOL) {
            this.sendCommand('/mode', { modes: ["DryClean"] })
                .then(() => {
                    this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.COOLING);
                    callback(null);
                })
                .catch(error => callback(error));
        } else {
            callback(null);
        }
    }
}
