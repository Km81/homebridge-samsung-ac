// Samsung Air Conditioner Homebridge Plugin
// Version 1.8.3
'use strict';

const https = require('https');
const fs = require('fs');

let Service, Characteristic, Accessory;

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  Accessory = homebridge.hap.Accessory;

  homebridge.registerAccessory('homebridge-samsung-ac', 'SamsungAC', SamsungAirco);
};

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
    this.cacheDuration = config.cacheDuration || 30000; // 30초 캐시

    if (!this.ip || !this.token || !this.patchCert) {
      this.log.error('IP, 토큰, 인증서 경로(patchCert)는 필수 설정 항목입니다.');
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

    this.log.info(`Samsung AC Plugin v1.8.3 초기화 완료: ${this.name}`);
  }

  _request(method, path, data = null) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.ip,
        port: 8888,
        path,
        method,
        headers: { Authorization: `Bearer ${this.token}` },
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

      req.on('error', reject);
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
    if (this.deviceState && now - this.lastStateUpdate < this.cacheDuration) {
      this.log.info('[CACHE] 유효한 캐시된 상태 반환');
      return this.deviceState;
    }
    this.log.info('[CACHE] 캐시 만료, 상태 요청');
    try {
      const { Devices } = await this._request('GET', '/devices');
      this.deviceState = Devices[this.deviceIndex];
      this.lastStateUpdate = now;
      return this.deviceState;
    } catch (e) {
      this.log.error(`[CACHE] 상태 조회 실패: ${e.message}`);
      if (this.deviceState) return this.deviceState;
      throw e;
    }
  }

  async sendCommand(endpoint, data) {
    const fullPath = `/devices/${this.setDeviceIndex}${endpoint}`;
    this.log.info(`[COMMAND] ${fullPath} -> ${JSON.stringify(data)}`);
    await this._request('PUT', fullPath, data);
    this.deviceState = null;
    await this.getCachedState();
  }

  identify(callback) {
    this.log('Identify requested');
    callback();
  }

  getServices() {
    this.aircoSamsung.setPrimaryService(true);

    this.aircoSamsung
      .getCharacteristic(Characteristic.Active)
      .on('get', this.getActive.bind(this))
      .on('set', this.setActive.bind(this));

    this.aircoSamsung
      .getCharacteristic(Characteristic.CurrentHeaterCoolerState)
      .on('get', this.getCurrentHeaterCoolerState.bind(this));

    this.aircoSamsung
      .getCharacteristic(Characteristic.TargetHeaterCoolerState)
      .setProps({ validValues: [Characteristic.TargetHeaterCoolerState.COOL] })
      .on('get', this.getTargetHeaterCoolerState.bind(this));

    this.aircoSamsung
      .getCharacteristic(Characteristic.CurrentTemperature)
      .on('get', this.getCurrentTemperature.bind(this));

    this.aircoSamsung
      .getCharacteristic(Characteristic.CoolingThresholdTemperature)
      .setProps({ minValue: 18, maxValue: 30, minStep: 1 })
      .on('get', this.getTargetTemperature.bind(this))
      .on('set', this.setTargetTemperature.bind(this));

    this.aircoSamsung
      .getCharacteristic(Characteristic.SwingMode)
      .on('get', this.getSwingMode.bind(this))
      .on('set', this.setSwingMode.bind(this));

    this.aircoSamsung
      .getCharacteristic(Characteristic.LockPhysicalControls)
      .on('get', this.getLockPhysicalControls.bind(this))
      .on('set', this.setLockPhysicalControls.bind(this));

    return [this.informationService, this.aircoSamsung];
  }

  // --- Characteristic Handlers ---

  async getActive(callback) {
    try {
      const state = await this.getCachedState();
      const val = state.Operation.power === 'On'
        ? Characteristic.Active.ACTIVE
        : Characteristic.Active.INACTIVE;
      callback(null, val);
    } catch (e) { callback(e); }
  }

  async setActive(value, callback) {
    const target = value === Characteristic.Active.ACTIVE ? 'On' : 'Off';
    try {
      await this.sendCommand('', { Operation: { power: target } });
      if (this.deviceState) this.deviceState.Operation.power = target;
      this.aircoSamsung
        .getCharacteristic(Characteristic.Active)
        .updateValue(value);
      callback(null);
    } catch (e) { callback(e); }
  }

  async getCurrentTemperature(callback) {
    try {
      const state = await this.getCachedState();
      callback(null, state.Temperatures[0].current);
    } catch (e) { callback(e); }
  }

  async getTargetTemperature(callback) {
    try {
      const state = await this.getCachedState();
      callback(null, state.Temperatures[0].desired);
    } catch (e) { callback(e); }
  }

  async setTargetTemperature(value, callback) {
    try {
      await this.sendCommand('/temperatures/0', { desired: value });
      callback(null);
    } catch (e) { callback(e); }
  }

  async getSwingMode(callback) {
    try {
      const state = await this.getCachedState();
      let enabled;
      if (this.swingModeType === 'wind') {
        enabled = state.Wind.direction === 'Up_And_Low';
      } else {
        enabled = state.Mode.options.includes('Comode_Nano');
      }
      callback(null, enabled
        ? Characteristic.SwingMode.SWING_ENABLED
        : Characteristic.SwingMode.SWING_DISABLED);
    } catch (e) { callback(e); }
  }

  async setSwingMode(value, callback) {
    try {
      if (this.swingModeType === 'wind') {
        const dir = value === Characteristic.SwingMode.SWING_ENABLED
          ? 'Up_And_Low' : 'Fix';
        await this.sendCommand('/wind', { direction: dir });
      } else {
        const opt = value === Characteristic.SwingMode.SWING_ENABLED
          ? 'Comode_Nano' : 'Comode_Off';
        await this.sendCommand('/mode', { options: [opt] });
      }
      callback(null);
    } catch (e) { callback(e); }
  }

  async getLockPhysicalControls(callback) {
    try {
      const state = await this.getCachedState();
      const locked = state.Mode.options.includes('Autoclean_On');
      callback(null, locked
        ? Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED
        : Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED);
    } catch (e) { callback(e); }
  }

  async setLockPhysicalControls(value, callback) {
    try {
      const opt = value === Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED
        ? 'Autoclean_On' : 'Autoclean_Off';
      await this.sendCommand('/mode', { options: [opt] });
      callback(null);
    } catch (e) { callback(e); }
  }

  async getCurrentHeaterCoolerState(callback) {
    try {
      const state = await this.getCachedState();
      const mode = state.Mode.modes[0];
      const cooling = ['CoolClean','Cool','Dry','DryClean','Auto','Wind']
        .includes(mode);
      callback(null, cooling
        ? Characteristic.CurrentHeaterCoolerState.COOLING
        : Characteristic.CurrentHeaterCoolerState.IDLE);
    } catch (e) { callback(e); }
  }

  getTargetHeaterCoolerState(callback) {
    this.getCurrentHeaterCoolerState(callback);
  }

  async setTargetHeaterCoolerState(value, callback) {
    // No-op: 모드 변경 호출 제거
    callback(null);
  }
}
