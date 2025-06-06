// 'use strict'; 는 자바스크립트의 엄격 모드를 활성화하여, 잠재적인 오류를 줄여주는 좋은 습관입니다.
'use strict';

// axios는 HTTP 통신을 쉽게 만들어주는 라이브러리입니다.
const axios = require('axios');
// https는 Node.js에 내장된 모듈로, SSL/TLS 통신을 위한 고급 설정을 위해 필요합니다. (예: 인증서 처리)
const https = require('https');
// fs (File System)는 Node.js 내장 모듈로, 파일(예: 인증서 파일)을 읽기 위해 필요합니다.
const fs = require('fs');
// crypto는 Node.js 내장 암호화 모듈입니다. 이전 SSL 오류 해결 과정에서 사용했으나, 현재 코드에서는 직접 사용되지 않습니다.
// 하지만 다른 호환성을 위해 남겨두어도 무방합니다.
const crypto = require('crypto');

// Homebridge 플러그인 개발에 필요한 핵심 클래스들을 담을 변수를 선언합니다.
var Service, Characteristic, Accessory;

// 이 함수는 Homebridge가 플러그인을 로드할 때 최초로 실행되는 부분입니다.
module.exports = function(homebridge) {
    // Homebridge의 핵심 클래스들을 전역 변수에 할당하여 플러그인 전체에서 사용할 수 있게 합니다.
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    Accessory = homebridge.hap.Accessory;

    // 이 플러그인을 Homebridge에 등록합니다.
    // 첫 번째 인자('homebridge-samsung-ac')는 npm 패키지 이름과 일치시키는 것이 좋습니다. (플러그인 ID)
    // 두 번째 인자('SamsungAC')는 config.json에서 "accessory" 값으로 사용될 이름입니다.
    homebridge.registerAccessory('homebridge-samsung-ac', 'SamsungAC', SamsungAirco);
}

// 삼성 에어컨 액세서리의 모든 로직을 담고 있는 메인 클래스입니다.
class SamsungAirco {
    // 생성자 함수: 이 액세서리가 초기화될 때 실행됩니다.
    constructor(log, config) {
        this.log = log;      // 로그 출력을 위한 객체
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

        // --- 재사용 가능한 Axios 인스턴스 생성 ---
        // 매번 요청을 새로 만드는 대신, 기본 설정을 담은 인스턴스를 만들어 효율성을 높입니다.
        this.api = axios.create({
            baseURL: `https://${this.ip}:8888`, // 기본 API 주소
            headers: {
                // 'Content-Type'은 GET 요청 시 400 오류를 유발하여 제거. PUT 요청 시에는 자동으로 추가됨.
                'Authorization': `Bearer ${this.token}` // 모든 요청에 인증 토큰을 포함
            },
            // --- SSL/TLS 통신 오류 해결을 위한 핵심 설정 ---
            httpsAgent: new https.Agent({
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
            }),
            timeout: 5000 // 5초 이상 응답이 없으면 요청을 중단
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

    // --- 상태 캐싱 헬퍼 함수 ---
    // 불필요한 API 호출을 줄여 성능을 향상시키는 핵심 함수.
    async getCachedState() {
        const now = Date.now();
        // 캐시가 유효하면 (마지막 업데이트 후 3초가 지나지 않았으면) 저장된 상태를 즉시 반환.
        if (this.deviceState && (now - this.lastStateUpdate < this.cacheDuration)) {
            return this.deviceState;
        }

        this.log.info('Fetching latest state from device...'); // 캐시가 만료되면 새로운 상태를 가져옴
        try {
            const response = await this.api.get('/devices'); // API에 GET 요청
            // 설정된 deviceIndex에 따라 특정 기기의 정보만 저장
            this.deviceState = response.data.Devices[this.deviceIndex];
            this.lastStateUpdate = now; // 마지막 업데이트 시간 갱신
            return this.deviceState;
        } catch (error) {
            // 에러 발생 시 로그를 남기고, Homebridge가 멈추지 않도록 에러를 던짐
            this.log.error(`Failed to fetch device state: ${error.message}`);
            if (this.deviceState) { // 만약 이전에 성공한 캐시가 있다면, 오래된 데이터라도 우선 반환
                this.log.warn('Returning stale data due to fetch error.');
                return this.deviceState;
            }
            throw new Error('Could not fetch device state.');
        }
    }

    // --- API 제어 헬퍼 함수 ---
    // 에어컨 상태를 변경하는 명령(PUT 요청)을 보내는 함수.
    async sendCommand(endpoint, data) {
        try {
            // 설정된 setDeviceIndex에 따라 제어할 기기의 경로를 완성
            const fullEndpoint = `/devices/${this.setDeviceIndex}${endpoint}`;
            await this.api.put(fullEndpoint, data); // API에 PUT 요청
            this.log.info(`Command sent to ${fullEndpoint} successfully.`);
            // 명령 성공 후, UI에 변경사항이 빠르게 반영되도록 캐시를 즉시 무효화하고
            this.deviceState = null;
            // 새로운 상태를 다시 가져옴
            await this.getCachedState();
        } catch (error) {
            this.log.error(`Failed to send command to ${endpoint}: ${error.message}`);
            throw error;
        }
    }

    // HomeKit이 액세서리를 식별할 때 호출되는 함수 (예: 홈 앱에서 '액세서리 식별' 누르기)
    identify(callback) {
        this.log.info("Identify requested!");
        callback(); // 성공 콜백 호출
    }

    // 이 액세서리가 제공하는 서비스와 각 서비스의 특성(기능)을 정의하는 함수.
    getServices() {
        // Homebridge API 버전 호환성 오류를 해결하기 위해 최신 문법(.onGet) 대신 이전 문법(.on) 사용.
        this.aircoSamsung.getCharacteristic(Characteristic.Active) // '활성' 특성 (전원 On/Off)
            // 홈 앱이 상태를 물어볼 때('get') getActive 함수를 호출. .bind(this)는 함수 안에서 'this'가 SamsungAirco 클래스를 가리키도록 보장.
            .on('get', this.getActive.bind(this))
            // 홈 앱에서 스위치를 조작할 때('set') setActive 함수를 호출.
            .on('set', this.setActive.bind(this));

        this.aircoSamsung.getCharacteristic(Characteristic.CurrentTemperature) // '현재 온도' 특성
            .on('get', this.getCurrentTemperature.bind(this));

        this.aircoSamsung.getCharacteristic(Characteristic.TargetHeaterCoolerState) // '목표 냉난방기 상태' 특성 (냉방/난방/자동)
            .setProps({ validValues: [Characteristic.TargetHeaterCoolerState.COOL] }) // 이 플러그인은 '냉방'만 지원하도록 설정
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

        // Homebridge에 이 액세서리가 제공하는 서비스 목록을 반환.
        return [this.informationService, this.aircoSamsung];
    }
     
    // --- 각 특성(기능)의 실제 동작을 정의하는 Getters & Setters ---

    // 전원 상태를 가져옴
    async getActive() {
        const state = await this.getCachedState();
        return state.Operation.power === "On" ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
    }

    // 전원 상태를 설정함
    async setActive(value) {
        const power = value === Characteristic.Active.ACTIVE ? "On" : "Off";
        await this.sendCommand('', { Operation: { power: power } });
    }

    // 현재 온도를 가져옴
    async getCurrentTemperature() {
        const state = await this.getCachedState();
        return state.Temperatures[0].current;
    }

    // 목표 온도를 가져옴
    async getTargetTemperature() {
        const state = await this.getCachedState();
        return state.Temperatures[0].desired;
    }

    // 목표 온도를 설정함
    async setTargetTemperature(value) {
        await this.sendCommand('/temperatures/0', { desired: value });
    }

    // 스윙 모드 상태를 가져옴
    async getSwingMode() {
        const state = await this.getCachedState();
        // config의 swingModeType 값에 따라 다른 로직 실행
        if (this.swingModeType === 'wind') { // 상하회전 모델
            const mode = state.Wind.direction;
            return mode === "Up_And_Low" ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED;
        } else { // 무풍 모델
            const isNano = state.Mode.options.includes("Comode_Nano");
            return isNano ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED;
        }
    }

    // 스윙 모드 상태를 설정함
    async setSwingMode(value) {
        if (this.swingModeType === 'wind') {
            const direction = value === Characteristic.SwingMode.SWING_ENABLED ? "Up_And_Low" : "Fix";
            await this.sendCommand('/wind', { direction: direction });
        } else {
            const mode = value === Characteristic.SwingMode.SWING_ENABLED ? "Comode_Nano" : "Comode_Off";
            await this.sendCommand('/mode', { options: [mode] });
        }
    }

    // 현재 운전 모드를 가져옴 (냉방/송풍 등)
    async getCurrentHeaterCoolerState() {
        const state = await this.getCachedState();
        const coolModes = ["CoolClean", "Cool", "Dry", "DryClean", "Auto", "Wind"];
        const isCooling = coolModes.includes(state.Mode.modes[0]);
        // 냉방 관련 모드이면 'COOLING'으로, 아니면 'IDLE'(대기)로 반환
        return isCooling ? Characteristic.CurrentHeaterCoolerState.COOLING : Characteristic.CurrentHeaterCoolerState.IDLE;
    }

    // 목표 운전 모드를 가져옴 (현재 상태와 동일하게 설정)
    async getTargetHeaterCoolerState() {
        return this.getCurrentHeaterCoolerState();
    }
     
    // 목표 운전 모드를 설정함 (냉방 모드로만 설정 가능)
    async setTargetHeaterCoolerState(value) {
        if (value === Characteristic.TargetHeaterCoolerState.COOL) {
            await this.sendCommand('/mode', { modes: ["Cool"] });
            // UI에 즉시 반영되도록 홈킷 상태를 강제로 업데이트
            this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState).updateValue(Characteristic.CurrentHeaterCoolerState.COOLING);
        }
    }
}
