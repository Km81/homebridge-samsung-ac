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
            this.log.error("IP, token, and patchCert must be configured.");
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

        this.log.info('Fetching latest state from device...');
        return this._request('GET', '/devices')
            .then(responseData => {
                this.deviceState = responseData.Devices[this.deviceIndex];
                this.lastStateUpdate = now;
                return this.deviceState;
            })
            .catch(error => {
                this.log.error(`Failed to fetch device state: ${error.message}`);
                if (this.deviceState) {
                    this.log.warn('Returning stale data due to fetch error.');
                    return this.deviceState;
                }
                throw new Error('Could not fetch device state.');
            });
    }

    sendCommand(endpoint, data) {
        const fullEndpoint = `/devices/${this.setDeviceIndex}${endpoint}`;
        return this._request('PUT', fullEndpoint, data)
            .then(() => {
                this.log.info(`Command sent to ${fullEndpoint} successfully.`);
                this.deviceState = null;
                return this.getCachedState();
            })
            .catch(error => {
                this.log.error(`Failed to send command to ${endpoint}: ${error.message}`);
                throw error;
            });
    }

    identify(callback) {
        this.log.info("Identify requested!");
        callback();
    }

    getServices() {
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
    
    // --- Getters & Setters (콜백 방식으로 전면 수정) ---

    getActive(callback) {
        this.getCachedState().then(state => {
            const isActive = state.Operation.power === "On" ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
            callback(null, isActive);
        }).catch(error => {
            callback(error);
        });
    }

    setActive(value, callback) {
        const power = value === Characteristic.Active.ACTIVE ? "On" : "Off";
        this.sendCommand('', { Operation: { power: power } })
            .then(() => callback(null))
            .catch(error => callback(error));
    }

    getCurrentTemperature(callback) {
        this.getCachedState().then(state => {
            callback(null, state.Temperatures[0].current);
        }).catch(error => {
            callback(error);
        });
    }

    getTargetTemperature(callback) {
        this.getCachedState().then(state => {
            callback(null, state.Temperatures[0].desired);
        }).catch(error => {
            callback(error);
        });
    }

    setTargetTemperature(value, callback) {
        this.sendCommand('/temperatures/0', { desired: value })
            .then(() => callback(null))
            .catch(error => callback(error));
    }

    getSwingMode(callback) {
        this.getCachedState().then(state => {
            if (this.swingModeType === 'wind') {
                const mode = state.Wind.direction;
                callback(null, mode === "Up_And_Low" ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED);
            } else {
                const isNano = state.Mode.options.includes("Comode_Nano");
                callback(null, isNano ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED);
            }
        }).catch(error => {
            callback(error);
        });
    }

    setSwingMode(value, callback) {
        let promise;
        if (this.swingModeType === 'wind') {
            const direction = value === Characteristic.SwingMode.SWING_ENABLED ? "Up_And_Low" : "Fix";
            promise = this.sendCommand('/wind', { direction: direction });
        } else {
            const mode = value === Characteristic.SwingMode.SWING_ENABLED ? "Comode_Nano" : "Comode_Off";
            promise = this.sendCommand('/mode', { options: [mode] });
        }
        promise.then(() => callback(null)).catch(error => callback(error));
    }

    getCurrentHeaterCoolerState(callback) {
        this.getCachedState().then(state => {
            const coolModes = ["CoolClean", "Cool", "Dry", "DryClean", "Auto", "Wind"];
            const isCooling = coolModes.includes(state.Mode.modes[0]);
            callback(null, isCooling ? Characteristic.CurrentHeaterCoolerState.COOLING : Characteristic.CurrentHeaterCoolerState.IDLE);
        }).catch(error => {
            callback(error);
        });
    }

    getTargetHeaterCoolerState(callback) {
        this.getCurrentHeaterCoolerState(callback);
    }
    
    setTargetHeaterCoolerState(value, callback) {
        if (value === Characteristic.TargetHeaterCoolerState.COOL) {
            this.sendCommand('/mode', { modes: ["Cool"] })
                .then(() => {
                    this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.COOLING);
                    callback(null);
                })
                .catch(error => callback(error));
        } else {
            callback(null); // 다른 상태는 지원하지 않으므로 그냥 성공 처리
        }
    }
}
