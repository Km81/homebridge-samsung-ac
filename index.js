// Samsung Air Conditioner Homebridge Plugin
// Version 1.8.2
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
        // 캐시 기간을 30초로 늘려 순간 off 리포트 방지
        this.cacheDuration = config.cacheDuration || 30000;

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

        this.aircoSamsung = new Service.HeaterCooler(this.name);
        this.informationService = new Service.AccessoryInformation()
            .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
            .setCharacteristic(Characteristic.Model, 'Air Conditioner')
            .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || 'AF16K7970WFN');

        this.log.info(`Samsung AC Plugin v1.8.2 초기화 완료: ${this.name}`);
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

            if (data) req.write(JSON.stringify(data));
            req.end();
        });
    }

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

    async sendCommand(endpoint, data) {
        const fullEndpoint = `/devices/${this.setDeviceIndex}${endpoint}`;
        this.log.info(`[COMMAND] 명령어 전송 시도 -> Endpoint: ${fullEndpoint}, Data: ${JSON.stringify(data)}`);
        try {
            await this._request('PUT', fullEndpoint, data);
            this.log.info(`[COMMAND] ${fullEndpoint}(으)로 명령어를 성공적으로 보냈습니다.`);
            this.deviceState = null;
            await this.getCachedState();
        } catch (error) {
            this.log.error(`[COMMAND] ${fullEndpoint}(으)로 명령을 보내는 데 실패했습니다: ${error.message}`);
            throw error;
        }
    }

    identify(callback) {
        this.log.info('장치 식별 요청이 들어왔습니다!');
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
            .on('get', this.getTargetHeaterCoolerState.bind(this));

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

    async getActive(callback) {
        this.log.info('[GET] Active (전원) 요청을 받았습니다.');
        try {
            const state = await this.getCachedState();
            const isActive = state.Operation.power === 'On' ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
            this.log.info(`[GET] Active 반환: ${isActive === Characteristic.Active.ACTIVE ? 'ACTIVE' : 'INACTIVE'}`);
            callback(null, isActive);
        } catch (error) {
            this.log.error('[GET] Active 가져오기 실패:', error.message);
            callback(error);
        }
    }

    async setActive(value, callback) {
        const target = value === Characteristic.Active.ACTIVE ? 'On' : 'Off';
        this.log.info(`[SET] Active를 '${target}'로 설정 요청`);
        try {
            await this.sendCommand('', { Operation: { power: target } });
            // 캐시와 UI 강제 업데이트
            if (this.deviceState) this.deviceState.Operation.power = target;
            this.aircoSamsung.getCharacteristic(Characteristic.Active).updateValue(value);

            this.log.info(`[SET] Active를 '${target}'로 성공적으로 변경`);
            callback(null);
        } catch (error) {
            this.log.error('[SET] Active 설정 실패:', error.message);
            callback(error);
        }
    }

    async getCurrentTemperature(callback) {
        this.log.info('[GET] CurrentTemperature 요청');
        try {
            const state = await this.getCachedState();
            callback(null, state.Temperatures[0].current);
        } catch (error) {
            this.log.error('[GET] CurrentTemperature 실패:', error.message);
            callback(error);
        }
    }

    async getTargetTemperature(callback) {
        this.log.info('[GET] TargetTemperature 요청');
        try {
            const state = await this.getCachedState();
            callback(null, state.Temperatures[0].desired);
        } catch (error) {
            this.log.error('[GET] TargetTemperature 실패:', error.message);
            callback(error);
        }
    }

    async setTargetTemperature(value, callback) {
        this.log.info(`[SET] TargetTemperature를 ${value}°C로`);
        try {
            await this.sendCommand('/temperatures/0', { desired: value });
            callback(null);
        } catch (error) {
            this.log.error('[SET] TargetTemperature 실패:', error.message);
            callback(error);
        }
    }
