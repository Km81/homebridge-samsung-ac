// Samsung Air Conditioner Homebridge Plugin
// Version 1.8.10
'use strict';

const https = require('https');
const fs = require('fs');

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
const PLUGIN_VERSION = '1.8.10';

module.exports = function(homebridge) {
  HAP = homebridge.hap;
  Service = HAP.Service;
  Characteristic = HAP.Characteristic;

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
      secureProtocol: 'TLSv1_method',
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
        this.getCachedState(true).catch(e => {
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

  async getCachedState(forceRefresh = false) {
    const now = Date.now();
    // 강제 새로고침이 아니고, 캐시가 유효하면 캐시된 상태를 반환
    if (!forceRefresh && this.deviceState && now - this.lastStateUpdate < this.cacheDuration) {
      this.log.info(`[${this.name}] 유효한 캐시 사용`);
      return this.deviceState;
    }
    
    this.log.info(`[${this.name}] 새 상태 요청`);
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
  }

  async sendCommand(endpoint, data) {
    this.log.info(`[${this.name}] [COMMAND] ${endpoint} -> ${JSON.stringify(data)}`);
    const fullPath = `/devices/${this.setDeviceIndex}${endpoint}`;
    await this._request('PUT', fullPath, data);
    this.log.info(`[${this.name}] [COMMAND] 전송 완료`);
    
    // v1.8.8과 동일한 방식: 명령 전송 후, 즉시 새로운 상태를 강제로 가져와 동기화합니다.
    this.deviceState = null;
    await this.getCachedState(true);
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

  // --- Characteristic Handlers (v1.8.8 callback 스타일 유지) ---

  async getActive(callback) {
    this.log.info(`[${this.name}] GET Active 요청`);
    try {
      const state = await this.getCachedState();
      const value = state.Operation?.power === 'On' ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE;
      this.log.info(`[${this.name}] GET Active 반환: ${value === 1 ? 'ACTIVE' : 'INACTIVE'}`);
      callback(null, value);
    } catch (e) {
      this.log.error(`[${this.name}] GET Active 오류:`, e.stack || e);
      callback(e);
    }
  }

  async setActive(value, callback) {
    const target = value === Characteristic.Active.ACTIVE ? 'On' : 'Off';
    this.log.info(`[${this.name}] SET Active 설정 요청: ${target}`);
    try {
      await this.sendCommand('', { Operation: { power: target } });
      this.log.info(`[${this.name}] SET Active 설정 완료`);
      callback(null);
    } catch (e) {
      this.log.error(`[${this.name}] SET Active 오류:`, e.stack || e);
      callback(e);
    }
  }

  async getCurrentHeaterCoolerState(callback) {
    this.log.info(`[${this.name}] GET CurrentHeaterCoolerState 요청`);
    try {
      const state = await this.getCachedState();
      const mode = state.Mode?.modes[0];
      const cooling = ['CoolClean', 'Cool', 'Dry', 'DryClean', 'Auto', 'Wind'].includes(mode);
      const value = cooling ? Characteristic.CurrentHeaterCoolerState.COOLING : Characteristic.CurrentHeaterCoolerState.IDLE;
      this.log.info(`[${this.name}] GET CurrentHeaterCoolerState 반환: ${value === 2 ? 'COOLING' : 'IDLE'}`);
      callback(null, value);
    } catch (e) {
      this.log.error(`[${this.name}] GET CurrentHeaterCoolerState 오류:`, e.stack || e);
      callback(e);
    }
  }
  
  getTargetHeaterCoolerState(callback) {
    this.log.info(`[${this.name}] GET TargetHeaterCoolerState 요청`);
    this.getCurrentHeaterCoolerState(callback);
  }
  
  async getCurrentTemperature(callback) {
    this.log.info(`[${this.name}] GET CurrentTemperature 요청`);
    try {
      const state = await this.getCachedState();
      const temp = state.Temperatures[0].current;
      this.log.info(`[${this.name}] GET CurrentTemperature 반환: ${temp}°C`);
      callback(null, temp);
    } catch (e) {
      this.log.error(`[${this.name}] GET CurrentTemperature 오류:`, e.stack || e);
      callback(e);
    }
  }

  async getTargetTemperature(callback) {
    this.log.info(`[${this.name}] GET TargetTemperature 요청`);
    try {
      const state = await this.getCachedState();
      const temp = state.Temperatures[0].desired;
      this.log.info(`[${this.name}] GET TargetTemperature 반환: ${temp}°C`);
      callback(null, temp);
    } catch (e) {
      this.log.error(`[${this.name}] GET TargetTemperature 오류:`, e.stack || e);
      callback(e);
    }
  }

  async setTargetTemperature(value, callback) {
    this.log.info(`[${this.name}] SET TargetTemperature 설정 요청: ${value}°C`);
    try {
      await this.sendCommand('/temperatures/0', { desired: value });
      this.log.info(`[${this.name}] SET TargetTemperature 설정 완료`);
      callback(null);
    } catch (e) {
      this.log.error(`[${this.name}] SET TargetTemperature 오류:`, e.stack || e);
      callback(e);
    }
  }
  
  async getSwingMode(callback) {
    this.log.info(`[${this.name}] GET SwingMode 요청`);
    try {
      const state = await this.getCachedState();
      const enabled = this.swingModeHandler.getValue(state);
      const value = enabled ? Characteristic.SwingMode.SWING_ENABLED : Characteristic.SwingMode.SWING_DISABLED;
      this.log.info(`[${this.name}] GET SwingMode 반환: ${enabled ? 'ENABLED' : 'DISABLED'}`);
      callback(null, value);
    } catch (e) {
      this.log.error(`[${this.name}] GET SwingMode 오류:`, e.stack || e);
      callback(e);
    }
  }

  async setSwingMode(value, callback) {
    const enable = value === Characteristic.SwingMode.SWING_ENABLED;
    this.log.info(`[${this.name}] SET SwingMode 설정 요청: ${enable ? 'ENABLED' : 'DISABLED'}`);
    try {
      const { endpoint, data } = this.swingModeHandler.getCommand(enable);
      await this.sendCommand(endpoint, data);
      this.log.info(`[${this.name}] SET SwingMode 설정 완료`);
      callback(null);
    } catch (e) {
      this.log.error(`[${this.name}] SET SwingMode 오류:`, e.stack || e);
      callback(e);
    }
  }

  async getLockPhysicalControls(callback) {
    this.log.info(`[${this.name}] GET LockPhysicalControls 요청`);
    try {
      const state = await this.getCachedState();
      const locked = state.Mode?.options?.includes('Autoclean_On');
      const value = locked ? Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED : Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED;
      this.log.info(`[${this.name}] GET LockPhysicalControls 반환: ${locked ? 'ENABLED' : 'DISABLED'}`);
      callback(null, value);
    } catch (e) {
      this.log.error(`[${this.name}] GET LockPhysicalControls 오류:`, e.stack || e);
      callback(e);
    }
  }

  async setLockPhysicalControls(value, callback) {
    const action = value === Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED ? 'Autoclean_On' : 'Autoclean_Off';
    this.log.info(`[${this.name}] SET LockPhysicalControls 설정 요청: ${action}`);
    try {
      await this.sendCommand('/mode', { options: [action] });
      this.log.info(`[${this.name}] SET LockPhysicalControls 설정 완료`);
      callback(null);
    } catch (e) {
      this.log.error(`[${this.name}] SET LockPhysicalControls 오류:`, e.stack || e);
      callback(e);
    }
  }
}
