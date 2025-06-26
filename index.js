// Samsung Air Conditioner Homebridge Plugin
// Version 1.8.7 (최종 리뷰 기반 개선 버전)
//
// 추천: 사용자 경험 향상을 위해 이 플러그인의 config.schema.json 파일을 생성하여
// ip, token, certPath 등의 필수 항목을 정의하는 것을 권장합니다.
'use strict';

const https = require('https');
const fs = require('fs');
const AsyncLock = require('async-lock');

// --- 개선점: 전역 변수 명시적 선언 (사용하지 않는 Accessory 제거) ---
let HAP;
let Service, Characteristic;

class SwingModeHandler {
  constructor(type) { this.type = type; }
  getValue(state) {
    if (!state) return false;
    if (this.type === 'wind') return state.Wind?.direction === 'Up_And_Low';
    return state.Mode?.options?.includes('Comode_Nano');
  }
  getCommand(enable) {
    if (this.type === 'wind') {
      const dir = enable ? 'Up_And_Low' : 'Fix';
      return { endpoint: '/wind', data: { direction: dir } };
    }
    const opt = enable ? 'Comode_Nano' : 'Comode_Off';
    return { endpoint: '/mode', data: { options: [opt] } };
  }
}

const API_PORT = 8888;
const API_DEVICES_PATH = '/devices';
const PLUGIN_VERSION = '1.8.7';

module.exports = function(homebridge) {
  HAP = homebridge.hap;
  Service = HAP.Service;
  Characteristic = HAP.Characteristic;

  // --- 개선점: HAP 네임스페이스 검증 (호환성 수정) ---
  // Homebridge v1.1.7과 같은 구버전과의 호환성을 위해 HAP.HapStatusError의 존재 여부를
  // 시작 시점에 강하게 검증하지 않습니다. HAP 객체와 핵심 서비스/특성 객체만 확인합니다.
  if (!HAP || !Service || !Characteristic) {
    throw new Error('Homebridge HAP API가 올바르게 로드되지 않았습니다. Homebridge 버전을 확인해주세요.');
  }

  homebridge.registerAccessory('homebridge-samsung-ac', 'SamsungAC', SamsungAirco);
};

class SamsungAirco {
  constructor(log, config) {
    this.log = log;

    this.name = config.name;
    this.ip = config.ip;
    this.token = config.token;

    this.certPath = config.certPath || config.patchCert;
    this.keyPath = config.keyPath || this.certPath;

    this.deviceIndex = config.deviceIndex || 0;
    this.setDeviceIndex = config.setDeviceIndex ?? this.deviceIndex;
    this.swingModeType = config.swingModeType || 'comfort';
    this.cacheDuration = config.cacheDuration || 30000;
    this.timeout = config.timeout || 5000;
    this.pollingInterval = config.pollingInterval;

    this.lock = new AsyncLock();
    this.swingModeHandler = new SwingModeHandler(this.swingModeType);

    if (!this.ip || !this.token || !this.certPath) {
      throw new Error(`[${this.name}] IP, 토큰, 인증서 경로는 필수 설정 항목입니다. 플러그인 로딩을 중단합니다.`);
    }

    try {
      fs.accessSync(this.certPath, fs.constants.R_OK);
      fs.accessSync(this.keyPath, fs.constants.R_OK);
    } catch (e) {
      throw new Error(`[${this.name}] 인증서 또는 키 파일을 찾을 수 없습니다 (오류: ${e.message}). 플러그인 로딩을 중단합니다.`);
    }

    this.httpsAgent = new https.Agent({
      cert: fs.readFileSync(this.certPath),
      key: fs.readFileSync(this.keyPath),
      rejectUnauthorized: false,
      ciphers: 'DEFAULT@SECLEVEL=1',
      minVersion: 'TLSv1',
    });

    this.deviceState = null;
    this.lastStateUpdate = 0;

    this.aircoSamsung = new Service.HeaterCooler(this.name);
    this.informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
      .setCharacteristic(Characteristic.Model, 'Air Conditioner')
      .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || 'AF16K7970WFN');

    this.startPolling();
    
    this.log.info(`[${this.name}] Samsung AC Plugin v${PLUGIN_VERSION} 초기화 완료`);
  }

  startPolling() {
    if (this.pollingInterval > 0) {
      this.log.info(`[${this.name}] ${this.pollingInterval}초 간격으로 상태 폴링을 시작합니다.`);
      setInterval(() => {
        this.log.debug(`[${this.name}] 주기적인 상태 업데이트 실행...`);
        this.getCachedState().catch(e => {
          this.log.error(`[${this.name}] 폴링 실패:`, e.stack || e);
        });
      }, this.pollingInterval * 1000);
    }
  }

  async _request(method, path, data = null, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await new Promise((resolve, reject) => {
          const options = {
            hostname: this.ip, port: API_PORT, path, method,
            headers: { Authorization: `Bearer ${this.token}` },
            agent: this.httpsAgent, timeout: this.timeout,
          };
          if (data) {
            const postData = JSON.stringify(data);
            options.headers['Content-Type'] = 'application/json';
            options.headers['Content-Length'] = Buffer.byteLength(postData);
          }
          const req = https.request(options, (res) => {
            if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`요청 실패, 상태 코드: ${res.statusCode}`));
            const body = [];
            res.on('data', (chunk) => body.push(chunk));
            res.on('end', () => {
              try { resolve(JSON.parse(Buffer.concat(body).toString() || '{}')); } catch (e) { reject(e); }
            });
          });
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('요청 시간 초과')); });
          if (data) req.write(JSON.stringify(data));
          req.end();
        });
      } catch (e) {
        if (attempt === retries) {
          this.log.error(`[${this.name}] 최종 요청 실패 (${attempt}회 시도):`, e.stack || e);
          throw e;
        }
        this.log.warn(`[${this.name}] 요청 실패, 재시도 ${attempt}/${retries}... (${e.message})`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  async getCachedState() {
    return this.lock.acquire('state-update', async () => {
      const now = Date.now();
      if (this.deviceState && now - this.lastStateUpdate < this.cacheDuration) {
        this.log.debug(`[${this.name}] 유효한 캐시 사용`);
        return this.deviceState;
      }
      this.log.info(`[${this.name}] 캐시 만료, 새 상태 요청`);
      try {
        const { Devices } = await this._request('GET', API_DEVICES_PATH);
        if (!Devices || !Array.isArray(Devices) || !Devices[this.deviceIndex]) {
          this.log.error(`[${this.name}] API 응답에서 유효한 장치를 찾을 수 없습니다 (Index: ${this.deviceIndex}). 응답: ${JSON.stringify(Devices)}`);
          throw new Error(`Device at index ${this.deviceIndex} not found in API response.`);
        }
        this.deviceState = Devices[this.deviceIndex];
        this.lastStateUpdate = now;
        this.log.info(`[${this.name}] 캐시 업데이트 완료`);
        return this.deviceState;
      } catch (e) {
        this.log.error(`[${this.name}] 상태 조회 실패:`, e.stack || e);
        if (this.deviceState) {
          this.log.warn(`[${this.name}] API 오류 발생. 오래된 캐시 데이터 반환`);
          return this.deviceState;
        }
        throw e;
      }
    });
  }

  async sendCommand(endpoint, data) {
    return this.lock.acquire('state-update', async () => {
      this.log.info(`[${this.name}] [COMMAND] ${endpoint} -> ${JSON.stringify(data)}`);
      const fullPath = `/devices/${this.setDeviceIndex}${endpoint}`;
      await this._request('PUT', fullPath, data);
      this.log.info(`[${this.name}] [COMMAND] 전송 완료`);
      this.deviceState = null;
    });
  }
  
  identify(callback) {
    this.log.info(`[${this.name}] IDENTIFY 호출됨`);
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
      .setProps({
        validValues: [Characteristic.TargetHeaterCoolerState.COOL],
        perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
      })
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

  // --- Characteristic Handlers ---

  async getActive() {
    try {
      const state = await this.getCachedState();
      return state.Operation?.power === 'On' ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
    } catch (e) {
      this.log.error(`[${this.name}] Active 상태 조회 오류:`, e.stack || e);
      throw new HAP.HapStatusError(HAP.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async setActive(value) {
    const target = value === Characteristic.Active.ACTIVE ? 'On' : 'Off';
    try {
      await this.sendCommand('', { Operation: { power: target } });
      this.log.info(`[${this.name}] Active 설정 완료: ${target}`);
    } catch (e) {
      this.log.error(`[${this.name}] Active 설정 오류:`, e.stack || e);
      throw new HAP.HapStatusError(HAP.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getCurrentHeaterCoolerState() {
    try {
      const state = await this.getCachedState();
      const mode = state.Mode?.modes[0];
      const cooling = ['CoolClean', 'Cool', 'Dry', 'DryClean', 'Auto', 'Wind'].includes(mode);
      return cooling ? Characteristic.CurrentHeaterCoolerState.COOLING : Characteristic.CurrentHeaterCoolerState.IDLE;
    } catch (e) {
      this.log.error(`[${this.name}] CurrentHeaterCoolerState 조회 오류:`, e.stack || e);
      throw new HAP.HapStatusError(HAP.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
  
  getTargetHeaterCoolerState() {
    return this.getCurrentHeaterCoolerState();
  }
  
  async getCurrentTemperature() {
    try {
      const state = await this.getCachedState();
      return state.Temperatures[0].current;
    } catch (e) {
      this.log.error(`[${this.name}] CurrentTemperature 조회 오류:`, e.stack || e);
      throw new HAP.HapStatusError(HAP.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getTargetTemperature() {
    try {
      const state = await this.getCachedState();
      return state.Temperatures[0].desired;
    } catch (e) {
      this.log.error(`[${this.name}] TargetTemperature 조회 오류:`, e.stack || e);
      throw new HAP.HapStatusError(HAP.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async setTargetTemperature(value) {
    try {
      await this.sendCommand('/temperatures/0', { desired: value });
      this.log.info(`[${this.name}] TargetTemperature 설정 완료: ${value}°C`);
    } catch (e) {
      this.log.error(`[${this.name}] TargetTemperature 설정 오류:`, e.stack || e);
      throw new HAP.HapStatusError(HAP.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
  
  async getSwingMode() {
    try {
      const state = await this.getCachedState();
      const enabled = this.swingModeHandler.getValue(state);
      return enabled ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED;
    } catch (e) {
      this.log.error(`[${this.name}] SwingMode 조회 오류:`, e.stack || e);
      throw new HAP.HapStatusError(HAP.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async setSwingMode(value) {
    const enable = value === Characteristic.SwingMode.SWING_ENABLED;
    try {
      const { endpoint, data } = this.swingModeHandler.getCommand(enable);
      await this.sendCommand(endpoint, data);
      this.log.info(`[${this.name}] SwingMode 설정 완료: ${enable ? 'ENABLED' : 'DISABLED'}`);
    } catch (e) {
      this.log.error(`[${this.name}] SwingMode 설정 오류:`, e.stack || e);
      throw new HAP.HapStatusError(HAP.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async getLockPhysicalControls() {
    try {
      const state = await this.getCachedState();
      const locked = state.Mode?.options?.includes('Autoclean_On');
      return locked ? Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED : Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED;
    } catch (e) {
      this.log.error(`[${this.name}] LockPhysicalControls 조회 오류:`, e.stack || e);
      throw new HAP.HapStatusError(HAP.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  async setLockPhysicalControls(value) {
    const action = value === Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED ? 'Autoclean_On' : 'Autoclean_Off';
    try {
      await this.sendCommand('/mode', { options: [action] });
      this.log.info(`[${this.name}] LockPhysicalControls 설정 완료: ${action}`);
    } catch (e) {
      this.log.error(`[${this.name}] LockPhysicalControls 설정 오류:`, e.stack || e);
      throw new HAP.HapStatusError(HAP.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
}
