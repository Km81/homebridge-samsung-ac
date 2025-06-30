// Samsung Air Conditioner Homebridge Plugin
// Final Version 1.9.3 (TLS & HTTP Parser Compatibility Patch)
'use strict';

const https = require('https');
const fs = require('fs');
const { constants } = require('crypto');

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
const PLUGIN_VERSION = '1.9.3';

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
      throw new Error(`[${this.name}] IP, 토큰, 인증서 경로는 필수 설정 항목입니다.`);
    }

    try {
      fs.accessSync(this.certPath, fs.constants.R_OK);
      fs.accessSync(this.keyPath, fs.constants.R_OK);
    } catch (e) {
      throw new Error(`[${this.name}] 인증서 또는 키 파일을 찾을 수 없습니다: ${e.message}`);
    }

    this.httpsAgent = new https.Agent({
      cert: fs.readFileSync(this.certPath),
      key: fs.readFileSync(this.keyPath),
      rejectUnauthorized: false,
      honorCipherOrder: true,
      ciphers: 'DEFAULT@SECLEVEL=0',
      minVersion: 'TLSv1',
      maxVersion: 'TLSv1',
      secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT,
      ALPNProtocols: ['http/1.1'],
    });

    this.deviceState = null;
    this.lastStateUpdate = 0;

    this.aircoSamsung = new Service.HeaterCooler(this.name);

    this.informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
      .setCharacteristic(Characteristic.Model, 'AF16K7970WFN')
      .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || 'B5VNP3EH701769Y')
      .setCharacteristic(Characteristic.FirmwareRevision, PLUGIN_VERSION);

    this.startPolling();
    this.log.info(`[${this.name}] Samsung AC Plugin v${PLUGIN_VERSION} 초기화 완료 (TLS & HTTP 호환성 패치 적용)`);
  }

  startPolling() {
    if (this.pollingInterval > 0) {
      this.log.info(`[${this.name}] ${this.pollingInterval}초 간격으로 상태 폴링을 시작합니다.`);
      setInterval(() => {
        this.getCachedState(true).catch(e => this.log.error(`[${this.name}] 폴링 실패:`, e.message));
      }, this.pollingInterval * 1000);
    }
  }

  async _request(method, path, data = null, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await new Promise((resolve, reject) => {
          const options = {
            hostname: this.ip,
            port: API_PORT,
            path,
            method,
            agent: this.httpsAgent,
            timeout: this.timeout,
            headers: {
              'Authorization': `Bearer ${this.token}`,
              'Connection': 'close', // 매 요청마다 연결을 종료하여 파싱 오류 방지
            }
          };
          if (data) {
            const postData = JSON.stringify(data);
            options.headers['Content-Type'] = 'application/json';
            options.headers['Content-Length'] = Buffer.byteLength(postData);
          }
          const req = https.request(options, res => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
              return reject(new Error(`요청 실패, 상태 코드: ${res.statusCode}`));
            }
            const body = [];
            res.on('data', chunk => body.push(chunk));
            res.on('end', () => {
              try { resolve(JSON.parse(Buffer.concat(body).toString() || '{}')); } 
              catch (e) { reject(new Error(`응답 JSON 파싱 오류: ${e.message}`)); }
            });
          });
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('요청 시간 초과')); });
          if (data) req.write(JSON.stringify(data));
          req.end();
        });
      } catch (e) {
        if (attempt === retries) {
          this.log.error(`[${this.name}] 최종 요청 실패 (${attempt}회):`, e.message);
          throw e;
        }
        this.log.warn(`[${this.name}] 요청 실패, 재시도 ${attempt}/${retries}... (${e.message})`);
        await new Promise(res => setTimeout(res, 1000 * attempt));
      }
    }
  }

  async getCachedState(force = false) {
    const now = Date.now();
    if (!force && this.deviceState && now - this.lastStateUpdate < this.cacheDuration) {
      return this.deviceState;
    }
    const { Devices } = await this._request('GET', API_DEVICES_PATH);
    if (!Devices || !Array.isArray(Devices) || !Devices[this.deviceIndex]) {
        this.log.error(`[${this.name}] API 응답에서 유효한 장치를 찾을 수 없습니다 (Index: ${this.deviceIndex}).`);
        return this.deviceState; // 이전 상태가 있으면 반환하여 앱 충돌 방지
    }
    this.deviceState = Devices[this.deviceIndex];
    this.lastStateUpdate = now;
    return this.deviceState;
  }

  async sendCommand(endpoint, data) {
    await this._request('PUT', `/devices/${this.setDeviceIndex}${endpoint}`, data);
    this.deviceState = null;
    await this.getCachedState(true);
  }

  identify(callback) { this.log.info(`${this.name} identify`); callback(); }

  getServices() {
    this.aircoSamsung.setPrimaryService(true);
    
    // ... 이하 getServices 내용은 동일 ...
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

  // --- Characteristic Handlers ---
  async getActive(callback) { 
      try { 
          const state = await this.getCachedState();
          callback(null, state?.Operation?.power === 'On' ? 1 : 0); 
      } catch(e) { 
          callback(e); 
      } 
  }

  async setActive(value, callback) {
      try {
          await this.sendCommand('', { Operation: { power: value ? 'On' : 'Off' } });
          callback(null);
      } catch(e) {
          callback(e);
      }
  }

  async getCurrentHeaterCoolerState(callback) {
      try {
          const state = await this.getCachedState();
          const mode = state?.Mode?.modes[0];
          const isCooling = ['CoolClean', 'Cool', 'Dry', 'DryClean', 'Auto', 'Wind'].includes(mode);
          callback(null, isCooling ? Characteristic.CurrentHeaterCoolerState.COOLING : Characteristic.CurrentHeaterCoolerState.IDLE);
      } catch(e) {
          callback(e);
      }
  }
  
  getTargetHeaterCoolerState(callback) {
      this.getCurrentHeaterCoolerState(callback);
  }
  
  async getCurrentTemperature(callback) {
      try {
          const state = await this.getCachedState();
          callback(null, state?.Temperatures[0].current);
      } catch(e) {
          callback(e);
      }
  }

  async getTargetTemperature(callback) {
      try {
          const state = await this.getCachedState();
          callback(null, state?.Temperatures[0].desired);
      } catch(e) {
          callback(e);
      }
  }
  
  async setTargetTemperature(value, callback) {
      try {
          await this.sendCommand('/temperatures/0', { desired: value });
          callback(null);
      } catch(e) {
          callback(e);
      }
  }
  
  async getSwingMode(callback) {
      try {
          const state = await this.getCachedState();
          callback(null, this.swingModeHandler.getValue(state) ? 1 : 0);
      } catch(e) {
          callback(e);
      }
  }

  async setSwingMode(value, callback) {
      try {
          const { endpoint, data } = this.swingModeHandler.getCommand(!!value);
          await this.sendCommand(endpoint, data);
          callback(null);
      } catch(e) {
          callback(e);
      }
  }

  async getLockPhysicalControls(callback) {
      try {
          const state = await this.getCachedState();
          callback(null, state?.Mode?.options.includes('Autoclean_On') ? 1 : 0);
      } catch(e) {
          callback(e);
      }
  }

  async setLockPhysicalControls(value, callback) {
      try {
          await this.sendCommand('/mode', { options: [value ? 'Autoclean_On' : 'Autoclean_Off'] });
          callback(null);
      } catch(e) {
          callback(e);
      }
  }
}
