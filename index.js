// Samsung Air Conditioner Homebridge Plugin
// Version 1.9.26 (Fixed cert path: cert/cert.pem, HTTP/1.1 + Header Fix)
'use strict';

const tls = require('tls');
const fs = require('fs');
const path = require('path');
const { constants } = require('crypto');

let HAP;
let Service, Characteristic;

const API_PORT = 8888;
const API_DEVICES_PATH = '/devices';
const PLUGIN_VERSION = '1.9.26';

class SwingModeHandler {
  constructor(type) {
    this.type = type;
  }
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

module.exports = function (homebridge) {
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

    const defaultCertPath = path.join(__dirname, 'cert', 'cert.pem');
    this.certPath = defaultCertPath;
    this.keyPath = defaultCertPath;

    this.deviceIndex = config.deviceIndex || 0;
    this.setDeviceIndex = config.setDeviceIndex ?? this.deviceIndex;
    this.swingModeType = config.swingModeType || 'comfort';
    this.cacheDuration = config.cacheDuration || 30000;
    this.timeout = config.timeout || 5000;
    this.pollingInterval = config.pollingInterval;
    this.swingModeHandler = new SwingModeHandler(this.swingModeType);

    try {
      fs.accessSync(this.certPath, fs.constants.R_OK);
      fs.accessSync(this.keyPath, fs.constants.R_OK);
    } catch (e) {
      throw new Error(`[${this.name}] 인증서/키 파일 접근 오류: ${e.message}`);
    }

    this.tlsOptions = {
      host: this.ip,
      port: API_PORT,
      cert: fs.readFileSync(this.certPath),
      key: fs.readFileSync(this.keyPath),
      rejectUnauthorized: false,
      honorCipherOrder: true,
      ciphers: 'DEFAULT@SECLEVEL=0',
      minVersion: 'TLSv1',
      maxVersion: 'TLSv1',
      secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT,
    };

    this.deviceState = null;
    this.lastStateUpdate = 0;

    this.aircoSamsung = new Service.HeaterCooler(this.name);
    this.informationService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
      .setCharacteristic(Characteristic.Model, 'AF16K7970WFN')
      .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || 'B5VNP3EH701769Y')
      .setCharacteristic(Characteristic.FirmwareRevision, PLUGIN_VERSION);

    this.startPolling();
    this.log.info(`[${this.name}] Samsung AC Plugin v${PLUGIN_VERSION} 초기화 완료 (HTTP/1.1 + Header Fix + cert/cert.pem 고정)`);
  }

  startPolling() {
    if (this.pollingInterval > 0) {
      this.log.info(`[${this.name}] ${this.pollingInterval}초 간격으로 상태 폴링을 시작합니다.`);
      setInterval(() => {
        this.log.debug(`[${this.name}] 주기적인 상태 업데이트 실행...`);
        this.getCachedState(true).catch(e => this.log.error(`[${this.name}] 폴링 실패:`, e.message));
      }, this.pollingInterval * 1000);
    }
  }

  _rawRequest(path, method, data) {
    return new Promise((resolve, reject) => {
      const jsonData = data ? JSON.stringify(data) : '';
      const requestData = [
        `${method} ${path} HTTP/1.1`,
        `Host: ${this.ip}`,
        `Authorization: Bearer ${this.token}`,
        'Content-Type: application/json',
        `Content-Length: ${Buffer.byteLength(jsonData)}`,
        'Connection: close',
        '',
        jsonData
      ].join('\r\n');

      const socket = tls.connect(this.tlsOptions, () => {
        socket.write(requestData);
      });

      let responseChunks = '';
      socket.setEncoding('utf8');

      socket.on('data', chunk => { responseChunks += chunk; });

      socket.on('end', () => {
        const statusLine = responseChunks.split('\r\n')[0];
        const statusMatch = statusLine.match(/^HTTP\/\d\.\d\s+(\d+)/);
        const statusCode = statusMatch ? parseInt(statusMatch[1]) : null;

        if (statusCode === 204) {
          return resolve({});
        }

        const jsonStartIndex = responseChunks.indexOf('{');
        if (jsonStartIndex < 0) {
          return reject(new Error(`응답에서 유효한 JSON을 찾지 못했습니다. 응답 내용: ${responseChunks}`));
        }
        try {
          const jsonResponse = JSON.parse(responseChunks.slice(jsonStartIndex));
          resolve(jsonResponse);
        } catch (e) {
          reject(new Error(`JSON 파싱에 실패했습니다: ${e.message}`));
        }
      });

      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('요청 시간 초과'));
      });

      socket.on('error', (err) => {
        reject(new Error(`TLS 소켓 오류: ${err.message}`));
      });
    });
  }

  async _request(method, path, data = null, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await this._rawRequest(path, method, data);
      } catch (e) {
        if (attempt === retries) {
          this.log.error(`[${this.name}] 최종 요청 실패 (${attempt}회 시도): ${e.message}`);
          throw e;
        }
        this.log.warn(`[${this.name}] 요청 실패, 재시도 ${attempt}/${retries}... (${e.message})`);
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  async getCachedState(force = false) {
    const now = Date.now();
    if (!force && this.deviceState && (now - this.lastStateUpdate < this.cacheDuration)) {
      this.log.debug(`[${this.name}] 유효한 캐시 사용`);
      return this.deviceState;
    }

    this.log.debug(`[${this.name}] 새 상태 요청`);
    const response = await this._request('GET', API_DEVICES_PATH);
    if (!response || !response.Devices || !Array.isArray(response.Devices) || !response.Devices[this.deviceIndex]) {
      throw new Error(`API 응답에서 장치(index: ${this.deviceIndex})를 찾을 수 없습니다.`);
    }
    this.deviceState = response.Devices[this.deviceIndex];
    this.lastStateUpdate = now;
    return this.deviceState;
  }

  async sendCommand(endpoint, data) {
    this.log.info(`[${this.name}] [COMMAND] ${endpoint} -> ${JSON.stringify(data)}`);
    await this._request('PUT', `/devices/${this.setDeviceIndex}${endpoint}`, data);
    this.log.info(`[${this.name}] [COMMAND] 전송 완료`);
    this.deviceState = null;
    await this.getCachedState(true);
  }

  identify(callback) {
    this.log.info(`[${this.name}] Identify 호출됨.`);
    callback();
  }

  getServices() {
    this.aircoSamsung.setPrimaryService(true);

    this.aircoSamsung.getCharacteristic(Characteristic.Active)
      .onGet(this.getActive.bind(this))
      .onSet(this.setActive.bind(this));

    this.aircoSamsung.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
      .onGet(this.getCurrentHeaterCoolerState.bind(this));

    this.aircoSamsung.getCharacteristic(Characteristic.TargetHeaterCoolerState)
      .setProps({ validValues: [Characteristic.TargetHeaterCoolerState.COOL] })
      .onGet(this.getTargetHeaterCoolerState.bind(this))
      .onSet(this.setTargetHeaterCoolerState.bind(this));

    this.aircoSamsung.getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

    this.aircoSamsung.getCharacteristic(Characteristic.CoolingThresholdTemperature)
      .setProps({ minValue: 18, maxValue: 30, minStep: 1 })
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperature.bind(this));

    this.aircoSamsung.getCharacteristic(Characteristic.SwingMode)
      .onGet(this.getSwingMode.bind(this))
      .onSet(this.setSwingMode.bind(this));

    this.aircoSamsung.getCharacteristic(Characteristic.LockPhysicalControls)
      .onGet(this.getLockPhysicalControls.bind(this))
      .onSet(this.setLockPhysicalControls.bind(this));

    return [this.informationService, this.aircoSamsung];
  }

  async getActive() {
    this.log.info(`[${this.name}] GET Active`);
    try {
      const state = await this.getCachedState();
      const isActive = state.Operation.power === 'On';
      this.log.info(`[${this.name}] > Active: ${isActive ? 'ON' : 'OFF'}`);
      return isActive ? 1 : 0;
    } catch (e) {
      this.log.error(`[${this.name}] GET Active 오류:`, e.message);
      throw e;
    }
  }

  async setActive(value) {
    const powerCmd = value ? 'On' : 'Off';
    this.log.info(`[${this.name}] SET Active -> ${powerCmd}`);
    try {
      await this.sendCommand('', { Operation: { power: powerCmd } });
      this.log.info(`[${this.name}] SET Active 완료`);
    } catch (e) {
      this.log.error(`[${this.name}] SET Active 오류:`, e.message);
      throw e;
    }
  }

  async getCurrentHeaterCoolerState() {
    this.log.info(`[${this.name}] GET CurrentState`);
    try {
      const state = await this.getCachedState();
      if (state.Operation.power !== 'On') {
        this.log.info(`[${this.name}] > CurrentState: INACTIVE`);
        return Characteristic.CurrentHeaterCoolerState.INACTIVE;
      }
      const mode = state.Mode.modes[0];
      const isCooling = ['CoolClean', 'Cool', 'Dry', 'DryClean', 'Auto', 'Wind'].includes(mode);
      if (isCooling) {
        this.log.info(`[${this.name}] > CurrentState: COOLING`);
        return Characteristic.CurrentHeaterCoolerState.COOLING;
      }
      this.log.info(`[${this.name}] > CurrentState: IDLE`);
      return Characteristic.CurrentHeaterCoolerState.IDLE;
    } catch (e) {
      this.log.error(`[${this.name}] GET CurrentState 오류:`, e.message);
      throw e;
    }
  }

  async getTargetHeaterCoolerState() {
    this.log.info(`[${this.name}] GET TargetState`);
    this.log.info(`[${this.name}] > TargetState: COOL`);
    return Characteristic.TargetHeaterCoolerState.COOL;
  }

  async setTargetHeaterCoolerState(value) {
    this.log.info(`[${this.name}] SET TargetState -> ${value}`);
    this.log.info(`[${this.name}] > COOL 모드만 지원하므로 변경 없음`);
  }

  async getCurrentTemperature() {
    this.log.info(`[${this.name}] GET CurrentTemperature`);
    try {
      const state = await this.getCachedState();
      const temp = state.Temperatures[0].current;
      this.log.info(`[${this.name}] > CurrentTemperature: ${temp}°C`);
      return temp;
    } catch (e) {
      this.log.error(`[${this.name}] GET CurrentTemp 오류:`, e.message);
      throw e;
    }
  }

  async getTargetTemperature() {
    this.log.info(`[${this.name}] GET TargetTemperature`);
    try {
      const state = await this.getCachedState();
      const temp = state.Temperatures[0].desired;
      this.log.info(`[${this.name}] > TargetTemperature: ${temp}°C`);
      return temp;
    } catch (e) {
      this.log.error(`[${this.name}] GET TargetTemp 오류:`, e.message);
      throw e;
    }
  }

  async setTargetTemperature(value) {
    this.log.info(`[${this.name}] SET TargetTemperature -> ${value}°C`);
    try {
      await this.sendCommand('/temperatures/0', { desired: value });
      this.log.info(`[${this.name}] SET TargetTemperature 완료`);
    } catch (e) {
      this.log.error(`[${this.name}] SET TargetTemp 오류:`, e.message);
      throw e;
    }
  }

  async getSwingMode() {
    this.log.info(`[${this.name}] GET SwingMode`);
    try {
      const state = await this.getCachedState();
      const isEnabled = this.swingModeHandler.getValue(state);
      this.log.info(`[${this.name}] > SwingMode: ${isEnabled ? 'ENABLED' : 'DISABLED'}`);
      return isEnabled ? 1 : 0;
    } catch (e) {
      this.log.error(`[${this.name}] GET SwingMode 오류:`, e.message);
      throw e;
    }
  }

  async setSwingMode(value) {
    const enabled = value === 1;
    this.log.info(`[${this.name}] SET SwingMode -> ${enabled ? 'ENABLED' : 'DISABLED'}`);
    try {
      const { endpoint, data } = this.swingModeHandler.getCommand(enabled);
      await this.sendCommand(endpoint, data);
      this.log.info(`[${this.name}] SET SwingMode 완료`);
    } catch (e) {
      this.log.error(`[${this.name}] SET SwingMode 오류:`, e.message);
      throw e;
    }
  }

  async getLockPhysicalControls() {
    this.log.info(`[${this.name}] GET LockControls`);
    try {
      const state = await this.getCachedState();
      const isLocked = state.Mode.options.includes('Autoclean_On');
      this.log.info(`[${this.name}] > LockControls: ${isLocked ? 'ENABLED' : 'DISABLED'}`);
      return isLocked ? 1 : 0;
    } catch (e) {
      this.log.error(`[${this.name}] GET LockControls 오류:`, e.message);
      throw e;
    }
  }

  async setLockPhysicalControls(value) {
    const cmd = value ? 'Autoclean_On' : 'Autoclean_Off';
    this.log.info(`[${this.name}] SET LockControls -> ${cmd}`);
    try {
      await this.sendCommand('/mode', { options: [cmd] });
      this.log.info(`[${this.name}] SET LockControls 완료`);
    } catch (e) {
      this.log.error(`[${this.name}] SET LockControls 오류:`, e.message);
      throw e;
    }
  }
}
