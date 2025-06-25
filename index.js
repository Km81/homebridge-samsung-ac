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
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    Accessory = homebridge.hap.Accessory;
    homebridge.registerAccessory('homebridge-samsung-ac', 'SamsungAC', SamsungAirco);
}

// 삼성 에어컨 액세서리의 모든 로직을 담고 있는 메인 클래스입니다.
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
        // 캐시 유효 시간을 원래대로 3초로 되돌립니다.
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
        this.isFetching = false;
        this.statePromise = null;

        this.aircoSamsung = new Service.HeaterCooler(this.name);
        this.informationService = new Service.AccessoryInformation()
            .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
            .setCharacteristic(Characteristic.Model, 'Air Conditioner')
            .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || 'AF16K7970WFN');
    }

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

    /**
     * 배경에서 상태를 가져와서 홈킷에 스스로 업데이트하는 함수.
     * @param {string} caller - 어떤 기능이 상태를 요청했는지 식별하는 문자열
     */
    async getAndUpdateState(caller = '알 수 없는 요청') {
        if (this.isFetching) {
            this.log.debug(`'${caller}'(이)가 요청했으나, 이미 다른 업데이트가 진행 중입니다.`);
            return;
        }

        this.log.info(`'${caller}' 확인을 위해 배경에서 최신 상태를 가져옵니다...`);
        this.isFetching = true;

        try {
            const responseData = await this._request('GET', '/devices');
            this.deviceState = responseData.Devices[this.deviceIndex];
            this.lastStateUpdate = Date.now();
            this.log.info('상태를 성공적으로 가져와 홈킷 UI를 업데이트합니다.');
            this._updateAllCharacteristics();
        } catch (error) {
            this.log.error(`배경 상태 업데이트 실패: ${error.message}`);
        } finally {
            this.isFetching = false;
        }
    }
    
    /**
     * 기기로부터 받은 최신 상태를 모든 홈킷 특성에 반영(push)하는 내부 함수
     */
    _updateAllCharacteristics() {
        if (!this.deviceState) return;

        // Active
        this.aircoSamsung.getCharacteristic(Characteristic.Active).updateValue(this.deviceState.Operation.power === "On" ? 1 : 0);
        // CurrentTemperature
        this.aircoSamsung.getCharacteristic(Characteristic.CurrentTemperature).updateValue(this.deviceState.Temperatures[0].current);
        // CoolingThresholdTemperature
        this.aircoSamsung.getCharacteristic(Characteristic.CoolingThresholdTemperature).updateValue(this.deviceState.Temperatures[0].desired);
        // CurrentHeaterCoolerState
        const coolModes = ["CoolClean", "Cool", "Dry", "DryClean", "Auto", "Wind"];
        let currentState = (this.deviceState.Operation.power === 'On' && coolModes.includes(this.deviceState.Mode.modes[0])) ? 2 : 1;
        this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(currentState);
        // SwingMode
        let swingMode;
        if (this.swingModeType === 'wind') {
            swingMode = this.deviceState.Wind.direction === "Up_And_Low" ? 1 : 0;
        } else {
            swingMode = this.deviceState.Mode.options.includes("Comode_Nano") ? 1 : 0;
        }
        this.aircoSamsung.getCharacteristic(Characteristic.SwingMode).updateValue(swingMode);
        // LockPhysicalControls
        const isAutoCleanOn = this.deviceState.Mode.options.includes("Autoclean_On");
        this.aircoSamsung.getCharacteristic(Characteristic.LockPhysicalControls).updateValue(isAutoCleanOn ? 1 : 0);
    }
    
    /**
     * '응답 없음'을 막기 위해, 우선 캐시된 값을 즉시 반환하고,
     * 캐시가 만료되었으면 배경에서 상태를 업데이트하는 새로운 Get 핸들러
     * @param {Function} callback - 결과를 반환할 콜백 함수
     * @param {string} caller - 어떤 특성을 위한 호출인지 나타내는 문자열
     * @param {Function}- 값을 추출하는 함수
     */
    handleGet(callback, caller, valueExtractor) {
        // 만약 캐시된 상태가 아예 없다면, 첫 실행이므로 한번은 기다려야 함
        if (!this.deviceState) {
            this.log.info(`초기화: '${caller}' 상태를 기다립니다...`);
            this.getAndUpdateState(`초기화 (${caller})`).then(() => {
                if (this.deviceState) {
                    callback(null, valueExtractor());
                } else {
                    callback(new Error("초기 상태를 가져올 수 없습니다."));
                }
            });
            return;
        }

        // 캐시된 값이 있다면, 즉시 반환하여 '응답 없음'을 막음
        callback(null, valueExtractor());

        // 캐시가 만료되었다면, 배경에서 조용히 업데이트 실행
        if (Date.now() - this.lastStateUpdate > this.cacheDuration) {
            this.getAndUpdateState(caller);
        }
    }


    async sendCommand(endpoint, data) {
        const fullEndpoint = `/devices/${this.setDeviceIndex}${endpoint}`;
        try {
            await this._request('PUT', fullEndpoint, data);
            this.log.info(`명령어를 ${fullEndpoint}(으)로 성공적으로 보냈습니다.`);
            this.deviceState = null; // 캐시 무효화
            // 명령 전송 후에는 즉각적인 피드백을 위해 상태를 바로 업데이트
            setTimeout(() => this.getAndUpdateState(`명령 후 업데이트 (${endpoint})`), 1000);
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
        this.aircoSamsung.setPrimaryService(true);
        this.aircoSamsung.getCharacteristic(Characteristic.Active)
            .on('get', (cb) => this.handleGet(cb, '전원', () => this.deviceState.Operation.power === "On" ? 1 : 0))
            .on('set', this.setActive.bind(this));
        this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
            .on('get', (cb) => this.handleGet(cb, '현재 운전 모드', () => {
                const coolModes = ["CoolClean", "Cool", "Dry", "DryClean", "Auto", "Wind"];
                return (this.deviceState.Operation.power === 'On' && coolModes.includes(this.deviceState.Mode.modes[0])) ? 2 : 1;
            }));
        this.aircoSamsung.getCharacteristic(Characteristic.TargetHeaterCoolerState)
            .setProps({ validValues: [Characteristic.TargetHeaterCoolerState.COOL] })
            .on('get', (cb) => this.handleGet(cb, '목표 운전 모드', () => 2)) // COOL(2)로 고정
            .on('set', this.setTargetHeaterCoolerState.bind(this));
        this.aircoSamsung.getCharacteristic(Characteristic.CurrentTemperature)
            .on('get', (cb) => this.handleGet(cb, '현재 온도', () => this.deviceState.Temperatures[0].current));
        this.aircoSamsung.getCharacteristic(Characteristic.CoolingThresholdTemperature)
            .setProps({ minValue: 18, maxValue: 30, minStep: 1 })
            .on('get', (cb) => this.handleGet(cb, '목표 온도', () => this.deviceState.Temperatures[0].desired))
            .on('set', this.setTargetTemperature.bind(this));
        this.aircoSamsung.getCharacteristic(Characteristic.SwingMode)
            .on('get', (cb) => this.handleGet(cb, '스윙/무풍 모드', () => {
                if (this.swingModeType === 'wind') return this.deviceState.Wind.direction === "Up_And_Low" ? 1 : 0;
                return this.deviceState.Mode.options.includes("Comode_Nano") ? 1 : 0;
            }))
            .on('set', this.setSwingMode.bind(this));
        this.aircoSamsung.getCharacteristic(Characteristic.LockPhysicalControls)
            .on('get', (cb) => this.handleGet(cb, '자동 청소', () => this.deviceState.Mode.options.includes("Autoclean_On") ? 1 : 0))
            .on('set', this.setLockPhysicalControls.bind(this));
        return [this.informationService, this.aircoSamsung];
    }
    
    // --- Setters ---
    async setActive(value, callback) {
        try {
            await this.sendCommand('', { Operation: { power: value ? 'On' : 'Off' } });
            callback(null);
        } catch (error) {
            this.log.error('전원 상태 설정에 실패했습니다:', error);
            callback(error);
        }
    }
    async setTargetTemperature(value, callback) {
        try {
            await this.sendCommand('/temperatures/0', { desired: value });
            callback(null);
        } catch (error) { callback(error); }
    }
    async setSwingMode(value, callback) {
        try {
            if (this.swingModeType === 'wind') {
                await this.sendCommand('/wind', { direction: value ? "Up_And_Low" : "Fix" });
            } else {
                await this.sendCommand('/mode', { options: [value ? "Comode_Nano" : "Comode_Off"] });
            }
            callback(null);
        } catch (error) { callback(error); }
    }
    async setLockPhysicalControls(value, callback) {
        try {
            await this.sendCommand('/mode', { options: [value ? 'Autoclean_On' : 'Autoclean_Off'] });
            callback(null);
        } catch (error) { callback(error); }
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
