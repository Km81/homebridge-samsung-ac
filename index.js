// 'use strict'; 는 자바스크립트의 엄격 모드를 활성화하여, 잠재적인 오류를 줄여주는 좋은 습관입니다.
'use strict';

// Node.js에 내장된 https 모듈을 불러옵니다. axios 라이브러리를 대체하여 더 낮은 수준의 직접적인 통신을 담당합니다.
const https = require('https);
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
    // 첫 번째 인자('homebridge-samsung-ac')는 플러그인의 고유 ID이며, 보통 npm 패키지 이름과 일치시킵니다.
    // 두 번째 인자('SamsungAC')는 config.json 파일의 "accessory" 항목에 사용될 이름입니다.
    homebridge.registerAccessory('homebridge-samsung-ac', 'SamsungAC', SamsungAirco);
}

// 삼성 에어컨 액세서리의 모든 로직을 담고 있는 메인 클래스입니다.
class SamsungAirco {
    // 생성자 함수: Homebridge가 config.json을 기반으로 이 액세서리를 초기화할 때 실행됩니다.
    constructor(log, config) {
        this.log = log;      // 로그 출력을 위한 Homebridge 로거 객체
        this.name = config.name; // config.json에 설정된 액세서리 이름 (예: "거실 에어컨")

        // --- config.json에서 가져온 주요 설정값들 ---
        this.ip = config.ip;                 // 에어컨의 IP 주소
        this.token = config.token;             // API 인증 토큰
        this.patchCert = config.patchCert;   // 인증서 파일의 경로

        // --- 다양한 에어컨 모델을 지원하기 위한 설정 (값이 없으면 기본값 사용) ---
        // API 응답에서 몇 번째 기기의 정보를 읽을지 결정 (0부터 시작)
        this.deviceIndex = config.deviceIndex || 0; 
        // API로 명령을 보낼 때 몇 번째 기기에 보낼지 결정 (기본적으로 deviceIndex와 동일)
        this.setDeviceIndex = config.setDeviceIndex ?? this.deviceIndex;
        // 스윙 모드의 종류를 결정 ('comfort': 무풍, 'wind': 상하회전)
        this.swingModeType = config.swingModeType || 'comfort';

        // API 상태를 몇 초 동안 캐시할지 결정 (밀리초 단위)
        this.cacheDuration = config.cacheDuration || 3000;

        // 필수 설정값이 없으면 에러를 출력하고 중단합니다.
        if (!this.ip || !this.token || !this.patchCert) {
            this.log.error("IP, token, and patchCert must be configured.");
            return;
        }

        // --- 모든 SSL/TLS 통신 오류 해결을 위한 핵심 에이전트 설정 ---
        // 이 에이전트는 앞으로 모든 https 통신에 적용될 규칙을 정의합니다.
        this.httpsAgent = new https.Agent({
            // 클라이언트 인증서와 비공개 키를 로드. .pem 파일에 두 정보가 모두 포함되어 있음.
            // '400 Bad Request' 오류(상호 인증 요구)를 해결.
            cert: fs.readFileSync(this.patchCert),
            key: fs.readFileSync(this.patchCert),
            // 에어컨이 자체 서명된 인증서를 사용하므로, 인증서 검증 과정을 건너뛰도록 설정.
            rejectUnauthorized: false,
            // 'ca md too weak' 오류 해결. 구형 SHA1 서명 알고리즘을 허용하도록 보안 레벨을 낮춤.
            ciphers: 'DEFAULT@SECLEVEL=1',
            // 'unsupported protocol' 오류 해결. nmap 진단 결과에 따라 구형 TLSv1.0 프로토콜을 강제로 사용.
            secureProtocol: 'TLSv1_method'
        });

        // --- 상태 캐싱을 위한 변수 초기화 ---
        this.deviceState = null;     // API로부터 받은 에어컨 상태를 저장할 변수
        this.lastStateUpdate = 0;    // 마지막으로 상태를 업데이트한 시간을 저장할 변수

        // --- 홈 앱에 표시될 서비스 생성 ---
        this.aircoSamsung = new Service.HeaterCooler(this.name); // 냉난방기 서비스
        this.informationService = new Service.AccessoryInformation() // 기기 정보 서비스
            .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
            .setCharacteristic(Characteristic.Model, 'Air Conditioner')
            .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || 'DefaultSN');
    }

    // --- 네이티브 https 모듈을 사용하여 "raw" HTTP 요청을 보내는 헬퍼 함수 ---
    // axios 라이브러리를 대체하여, 우리가 통제의 모든 측면을 직접 관리.
    _request(method, path, data = null) {
        // 비동기 작업을 처리하기 위해 Promise로 전체 로직을 감쌉니다.
        return new Promise((resolve, reject) => {
            // https.request에 필요한 모든 옵션을 정의합니다.
            const options = {
                hostname: this.ip,
                port: 8888,
                path: path,
                method: method,
                headers: { 'Authorization': `Bearer ${this.token}` },
                agent: this.httpsAgent, // 생성자에서 만든 모든 SSL/TLS 규칙이 담긴 에이전트를 적용.
                timeout: 5000
            };

            // 만약 보내야 할 데이터(body)가 있다면(PUT 요청 등), 헤더를 추가합니다.
            if (data) {
                const postData = JSON.stringify(data);
                options.headers['Content-Type'] = 'application/json';
                options.headers['Content-Length'] = Buffer.byteLength(postData);
            }

            // https 요청을 생성합니다.
            const req = https.request(options, (res) => {
                // 성공적인 HTTP 상태 코드(2xx)가 아니면 에러로 처리.
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    return reject(new Error(`Request failed with status code ${res.statusCode}`));
                }
                // 응답 데이터를 조각(chunk)별로 받아서 배열에 저장합니다.
                let body = [];
                res.on('data', (chunk) => body.push(chunk));
                // 응답이 모두 끝나면,
                res.on('end', () => {
                    try {
                        // 조각난 데이터들을 하나로 합쳐 문자열로 만듭니다.
                        const responseBody = Buffer.concat(body).toString();
                        // 응답 본문이 있으면 JSON으로 파싱하고, 없으면 빈 객체를 반환하여 Promise를 성공 상태로 만듭니다.
                        resolve(responseBody ? JSON.parse(responseBody) : {});
                    } catch (e) {
                        // JSON 파싱 중 에러가 나면 Promise를 실패 상태로 만듭니다.
                        reject(e);
                    }
                });
            });

            // 요청 과정에서 네트워크 오류가 발생하면 Promise를 실패 상태로 만듭니다.
            req.on('error', (e) => reject(e));
            // 타임아웃 발생 시 요청을 파괴하고 Promise를 실패 상태로 만듭니다.
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Request timed out'));
            });

            // 보낼 데이터가 있다면 요청에 씁니다.
            if (data) {
                req.write(JSON.stringify(data));
            }
            // 모든 요청 내용 전송을 마치고, 실제 요청을 보냅니다.
            req.end();
        });
    }

    // 불필요한 API 호출을 줄여 성능을 향상시키는 핵심 함수.
    getCachedState() {
        const now = Date.now();
        // 캐시가 유효하면 (마지막 업데이트 후 3초가 지나지 않았으면) 저장된 상태를 즉시 반환.
        if (this.deviceState && (now - this.lastStateUpdate < this.cacheDuration)) {
            // Promise.resolve를 사용하여 즉시 성공 상태의 Promise를 반환.
            return Promise.resolve(this.deviceState);
        }

        this.log.info('Fetching latest state from device...');
        // 캐시가 만료되면 새로운 상태를 가져옴.
        return this._request('GET', '/devices')
            .then(responseData => {
                // 성공적으로 데이터를 받으면, 상태와 업데이트 시간을 저장하고 반환.
                this.deviceState = responseData.Devices[this.deviceIndex];
                this.lastStateUpdate = now;
                return this.deviceState;
            })
            .catch(error => {
                // 에러 발생 시 로그를 남김.
                this.log.error(`Failed to fetch device state: ${error.message}`);
                // 만약 이전에 성공한 캐시가 있다면, 오래된 데이터라도 우선 반환하여 앱의 '응답 없음'을 최소화.
                if (this.deviceState) {
                    this.log.warn('Returning stale data due to fetch error.');
                    return this.deviceState;
                }
                // 캐시조차 없으면 에러를 던져서 상위로 전파.
                throw new Error('Could not fetch device state.');
            });
    }

    // 에어컨 상태를 변경하는 명령(PUT 요청)을 보내는 함수.
    sendCommand(endpoint, data) {
        const fullEndpoint = `/devices/${this.setDeviceIndex}${endpoint}`;
        return this._request('PUT', fullEndpoint, data)
            .then(() => {
                // 명령 성공 후 로그를 남기고, UI에 변경사항이 빠르게 반영되도록 캐시를 즉시 무효화.
                this.log.info(`Command sent to ${fullEndpoint} successfully.`);
                this.deviceState = null;
                // 새로운 상태를 다시 가져옴.
                return this.getCachedState();
            })
            .catch(error => {
                this.log.error(`Failed to send command to ${endpoint}: ${error.message}`);
                throw error;
            });
    }

    // HomeKit이 액세서리를 식별할 때 호출되는 함수
    identify(callback) {
        this.log.info("Identify requested!");
        callback();
    }

    // 이 액세서리가 제공하는 서비스와 각 서비스의 특성(기능)을 정의하는 함수.
    getServices() {
        // Homebridge API 버전 호환성 오류를 해결하기 위해 이전 문법(.on) 사용.
        this.aircoSamsung.getCharacteristic(Characteristic.Active) // '활성' 특성 (전원 On/Off)
            .on('get', this.getActive.bind(this))
            .on('set', this.setActive.bind(this));
        this.aircoSamsung.getCharacteristic(Characteristic.CurrentTemperature) // '현재 온도' 특성
            .on('get', this.getCurrentTemperature.bind(this));
        this.aircoSamsung.getCharacteristic(Characteristic.TargetHeaterCoolerState) // '목표 냉난방기 상태' 특성
            .setProps({ validValues: [Characteristic.TargetHeaterCoolerState.COOL] }) // '냉방'만 지원
            .on('get', this.getTargetHeaterCoolerState.bind(this))
            .on('set', this.setTargetHeaterCoolerState.bind(this));
        this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState) // '현재 냉난방기 상태' 특성
            .on('get', this.getCurrentHeaterCoolerState.bind(this));
        this.aircoSamsung.getCharacteristic(Characteristic.CoolingThresholdTemperature) // '냉방 설정 온도' 특성
            .setProps({ minValue: 18, maxValue: 30, minStep: 1 }) // 온도 범위 및 단계 설정
            .on('get', this.getTargetTemperature.bind(this))
            .on('set', this.setTargetTemperature.bind(this));
        this.aircoSamsung.getCharacteristic(Characteristic.SwingMode) // '스윙 모드' 특성
            .on('get', this.getSwingMode.bind(this))
            .on('set', this.setSwingMode.bind(this));
        return [this.informationService, this.aircoSamsung];
    }
    
    // --- Getters & Setters (Homebridge의 요청에 응답하는 콜백 방식으로 전면 수정) ---

    // 전원 상태를 가져와서 Homebridge에 전달
    getActive(callback) {
        // getCachedState는 Promise를 반환하므로 .then()으로 성공 시, .catch()로 실패 시를 처리.
        this.getCachedState().then(state => {
            const isActive = state.Operation.power === "On" ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
            // callback의 첫 번째 인자는 에러, 두 번째 인자는 값. 에러가 없으므로 null 전달.
            callback(null, isActive);
        }).catch(error => {
            // 에러 발생 시 에러 객체를 callback에 전달.
            callback(error);
        });
    }

    // 홈 앱에서 받은 값으로 전원 상태를 설정
    setActive(value, callback) {
        const power = value === Characteristic.Active.ACTIVE ? "On" : "Off";
        this.sendCommand('', { Operation: { power: power } })
            // 성공하면 에러 없이(null) callback 호출.
            .then(() => callback(null))
            // 실패하면 에러를 callback에 전달.
            .catch(error => callback(error));
    }

    // 현재 온도를 가져와서 전달
    getCurrentTemperature(callback) {
        this.getCachedState().then(state => {
            callback(null, state.Temperatures[0].current);
        }).catch(error => {
            callback(error);
        });
    }

    // 목표 온도를 가져와서 전달
    getTargetTemperature(callback) {
        this.getCachedState().then(state => {
            callback(null, state.Temperatures[0].desired);
        }).catch(error => {
            callback(error);
        });
    }

    // 목표 온도를 설정
    setTargetTemperature(value, callback) {
        this.sendCommand('/temperatures/0', { desired: value })
            .then(() => callback(null))
            .catch(error => callback(error));
    }

    // 스윙 모드를 가져와서 전달
    getSwingMode(callback) {
        this.getCachedState().then(state => {
            // config.json의 설정에 따라 다른 로직으로 상태를 판단.
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

    // 스윙 모드를 설정
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

    // 현재 운전 상태를 가져와서 전달
    getCurrentHeaterCoolerState(callback) {
        this.getCachedState().then(state => {
            const coolModes = ["CoolClean", "Cool", "Dry", "DryClean", "Auto", "Wind"];
            const isCooling = coolModes.includes(state.Mode.modes[0]);
            callback(null, isCooling ? Characteristic.CurrentHeaterCoolerState.COOLING : Characteristic.CurrentHeaterCoolerState.IDLE);
        }).catch(error => {
            callback(error);
        });
    }

    // 목표 운전 상태를 가져와서 전달
    getTargetHeaterCoolerState(callback) {
        // 현재 상태와 동일하게 동작하도록 구현
        this.getCurrentHeaterCoolerState(callback);
    }
    
    // 목표 운전 상태를 설정
    setTargetHeaterCoolerState(value, callback) {
        if (value === Characteristic.TargetHeaterCoolerState.COOL) {
            this.sendCommand('/mode', { modes: ["CoolClean"] })
                .then(() => {
                    // UI에 즉시 반영되도록 홈킷 상태를 강제로 업데이트
                    this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.COOLING);
                    callback(null);
                })
                .catch(error => callback(error));
        } else {
            // 냉방 외 다른 상태 설정은 지원하지 않으므로, 에러 없이 그냥 종료.
            callback(null); 
        }
    }
}
