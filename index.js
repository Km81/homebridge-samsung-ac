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
            key: fs.readFileSync(this.patchCert),  // 클라이언트 '비공개 키'
            rejectUnauthorized: false,             // 자체 서명 인증서 허용
            ciphers: 'DEFAULT@SECLEVEL=1',         // 약한 암호화 방식 허용
            secureProtocol: 'TLSv1_method'         // 구형 프로토콜 사용 강제
        });

        // --- 상태 캐싱을 위한 변수 초기화 ---
        this.deviceState = null;
        this.lastStateUpdate = 0;

        // --- 홈 앱에 표시될 서비스 생성 ---
        this.aircoSamsung = new Service.HeaterCooler(this.name, 'SamsungAircon-Primary');
        this.informationService = new Service.AccessoryInformation()
            .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
            .setCharacteristic(Characteristic.Model, 'Air Conditioner')
            .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || 'AF16K7970WFN');
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
            return this.deviceState;
        }

        this.log.info('기기에서 최신 상태를 가져옵니다...');
        try {
            const responseData = await this._request('GET', '/devices');
            this.deviceState = responseData.Devices[this.deviceIndex];
            this.lastStateUpdate = now;
            return this.deviceState;
        } catch (error) {
            this.log.error(`기기 상태를 가져오는 데 실패했습니다: ${error.message}`);
            if (this.deviceState) {
                this.log.warn('가져오기 오류로 인해 오래된 캐시 데이터를 반환합니다.');
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

    /**
     * 이 액세서리가 홈 앱에 제공할 모든 서비스와 특성(기능)을 정의하고 반환하는 함수.
     * @returns {Service[]} - 서비스 목록 배열
     */
    getServices() {
        const svc = this.aircoSamsung;
        svc.setPrimaryService(true);

        // 1) 기본 Active 제거
        svc.removeCharacteristic(svc.getCharacteristic(Characteristic.Active));
        // 2) subtype 'power'로 새 Active 생성 및 추가
        const powerChar = new Characteristic(
            'Active',
            Characteristic.Active.UUID,
            'power'
        );
        powerChar
            .on('get', this.getActive.bind(this))
            .on('set', this.setActive.bind(this));
        svc.addCharacteristic(powerChar);

        // 3) Boolean 특성들
        // '물리 제어 잠금' 특성을 '자동 청소' 스위치로 활용
        svc.getCharacteristic(Characteristic.LockPhysicalControls, 'lockControls')
            .on('get', this.getLockPhysicalControls.bind(this))
            .on('set', this.setLockPhysicalControls.bind(this));

         // '스윙 모드' 특성           
        svc.getCharacteristic(Characteristic.SwingMode, 'swingMode')
            .on('get', this.getSwingMode.bind(this))
            .on('set', this.setSwingMode.bind(this));

        // 4) 비-Boolean 특성들
        // '현재 온도' 특성
        svc.getCharacteristic(Characteristic.CurrentTemperature)
            .on('get', this.getCurrentTemperature.bind(this));

        // '목표 냉난방기 상태' 특성 (냉방 모드만)
        svc.getCharacteristic(Characteristic.TargetHeaterCoolerState)
            .setProps({ validValues: [Characteristic.TargetHeaterCoolerState.COOL] })
            .on('get', this.getTargetHeaterCoolerState.bind(this))
            .on('set', this.setTargetHeaterCoolerState.bind(this));

        // '현재 냉난방기 상태' 특성
        svc.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
            .on('get', this.getCurrentHeaterCoolerState.bind(this));

        // '냉방 설정 온도' 특성
        svc.getCharacteristic(Characteristic.CoolingThresholdTemperature)
            .setProps({ minValue: 18, maxValue: 30, minStep: 1 })
            .on('get', this.getTargetTemperature.bind(this))
            .on('set', this.setTargetTemperature.bind(this));

// getServices() 끝, return [ ... ]; 직전
this.aircoSamsung.characteristics.forEach(c => {
  this.log.info(`🔍 Characteristic: ${c.displayName} / UUID=${c.UUID} / iid=${c.iid} / subtype=${c.subtype || '-'}`);
});  
        return [this.informationService, this.aircoSamsung];
    }
    
    // --- Getters & Setters ---
    // 각 특성의 상태를 가져오거나(get) 설정(set)하는 함수들.
    // async/await를 사용하여 비동기 로직을 더 읽기 쉽게 작성했습니다.

    async getActive(callback) {
        try {
            const state = await this.getCachedState();
            const isActive = state.Operation.power === "On" ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
            callback(null, isActive);
        } catch (error) {
            callback(error);
        }
    }

    async setActive(value, callback) {
        try {
            if (value === Characteristic.Active.INACTIVE) {
                await this.sendCommand('', { Operation: { power: 'Off' } });
            } else {
                this.log.info('전원을 켠 후, "청정 건조" 모드로 설정합니다...');
                await this.sendCommand('', { Operation: { power: 'On' } });
                this.log.info('전원 켜짐. 6초 후 모드를 설정합니다...');
                await new Promise(resolve => setTimeout(resolve, 6000));
                await this.sendCommand('/mode', { modes: ['DryClean'] });
                this.log.info('성공적으로 전원을 켜고 운전 모드를 설정했습니다.');
                this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.COOLING);
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
            // '400 Bad Request' 오류를 피하기 위해, 변경하려는 옵션만 단독으로 전송합니다.
            if (this.swingModeType === 'wind') {
                const direction = value === Characteristic.SwingMode.SWING_ENABLED ? "Up_And_Low" : "Fix";
                await this.sendCommand('/wind', { direction: direction });
            } else {
                const newSwingState = value === Characteristic.SwingMode.SWING_ENABLED ? "Comode_Nano" : "Comode_Off";
                this.log.info(`무풍 모드 설정 변경: ${newSwingState}`);
                await this.sendCommand('/mode', { options: [newSwingState] });
            }
            callback(null);
        } catch (error) {
            callback(error);
        }
    }

    async getLockPhysicalControls(callback) {
        try {
            const state = await this.getCachedState();
            const isEnabled = state.Mode.options.includes("Autoclean_On");
            this.log.info(`자동 청소 상태: ${isEnabled ? '켜짐' : '꺼짐'}`);
            callback(null, isEnabled ? Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED : Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED);
        } catch (error) {
            callback(error);
        }
    }

    async setLockPhysicalControls(value, callback) {
        try {
            const newAutocleanState = value === Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED ? 'Autoclean_On' : 'Autoclean_Off';
            
            this.log.info(`자동 청소 설정 변경: ${newAutocleanState}`);
            // 다른 옵션을 덮어쓰지 않기 위해 시도했던 '읽고-수정-쓰기' 방식이 400 오류를 유발.
            // 따라서 단일 옵션만 보내는 간결한 방식으로 최종 수정.
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
            const coolModes = ["CoolClean", "Cool", "Dry", "DryClean", "Auto", "Wind"];

            if (coolModes.includes(currentMode)) {
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
                await this.sendCommand('/mode', { modes: ["DryClean"] });
                this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.COOLING);
            }
            callback(null);
        } catch (error) {
            callback(error);
        }
    }
}
