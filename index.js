// Samsung Air Conditioner Homebridge Plugin
// Version 1.8.8
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

    this.log.info(`Samsung AC Plugin v1.8.8 초기화 완료: ${this.name}`);
  }

  _request(method, path, data = null) {
    this.log.info(`[HTTP] ${method} ${path}${data ? ' ' + JSON.stringify(data) : ''}`);
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
          this.log.error(`[HTTP] 응답 오류: ${res.statusCode}`);
          return reject(new Error(`요청 실패, 상태 코드: ${res.statusCode}`));
        }
        let body = [];
        res.on('data', (chunk) => body.push(chunk));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(body).toString() || '{}');
            this.log.info('[HTTP] 응답 수신 성공');
            resolve(parsed);
          } catch (e) {
            this.log.error('[HTTP] 응답 파싱 실패:', e.message);
            reject(e);
          }
        });
      });

      req.on('error', (e) => {
        this.log.error('[HTTP] 요청 에러:', e.message);
        reject(e);
      });
      req.on('timeout', () => {
        req.destroy();
        this.log.error('[HTTP] 요청 시간 초과');
        reject(new Error('요청 시간 초과'));
      });

      if (data) req.write(JSON.stringify(data));
      req.end();
    });
  }

  async getCachedState() {
    const now = Date.now();
    if (this.deviceState && now - this.lastStateUpdate < this.cacheDuration) {
      this.log.info('[CACHE] 유효한 캐시 사용');
      return this.deviceState;
    }
    this.log.info('[CACHE] 캐시 만료, 새 상태 요청');
    try {
      const { Devices } = await this._request('GET', '/devices');
      this.deviceState = Devices[this.deviceIndex];
      this.lastStateUpdate = now;
      this.log.info('[CACHE] 캐시 업데이트 완료');
      return this.deviceState;
    } catch (e) {
      this.log.error(`[CACHE] 상태 조회 실패: ${e.message}`);
      if (this.deviceState) {
        this.log.warn('[CACHE] 예전 캐시 반환');
        return this.deviceState;
      }
      throw e;
    }
  }

  async sendCommand(endpoint, data) {
    this.log.info(`[COMMAND] ${endpoint} -> ${JSON.stringify(data)}`);
    const fullPath = `/devices/${this.setDeviceIndex}${endpoint}`;
    await this._request('PUT', fullPath, data);
    this.log.info('[COMMAND] 전송 완료');
    this.deviceState = null;
    await this.getCachedState();
  }

  identify(callback) {
    this.log.info('[IDENTIFY] 호출');
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

  // --- 상세 로그가 포함된 Characteristic Handlers ---

  async getActive(callback) {
    this.log.info('[GET] Active 요청');
    try {
      const state = await this.getCachedState();
      const val = state.Operation.power === 'On'
        ? Characteristic.Active.ACTIVE
        : Characteristic.Active.INACTIVE;
      this.log.info(`[GET] Active 반환: ${val === 1 ? 'ACTIVE' : 'INACTIVE'}`);
      callback(null, val);
    } catch (e) {
      this.log.error('[GET] Active 오류:', e.message);
      callback(e);
    }
  }

  async setActive(value, callback) {
    const target = value === Characteristic.Active.ACTIVE ? 'On' : 'Off';
    this.log.info(`[SET] Active 설정 요청: ${target}`);
    try {
      await this.sendCommand('', { Operation: { power: target } });
      this.log.info('[SET] Active 전송 완료');
      if (this.deviceState) this.deviceState.Operation.power = target;
      this.aircoSamsung
        .getCharacteristic(Characteristic.Active)
        .updateValue(value);
      callback(null);
    } catch (e) {
      this.log.error('[SET] Active 오류:', e.message);
      callback(e);
    }
  }

  async getCurrentTemperature(callback) {
    this.log.info('[GET] CurrentTemperature 요청');
    try {
      const state = await this.getCachedState();
      this.log.info(`[GET] CurrentTemperature 반환: ${state.Temperatures[0].current}°C`);
      callback(null, state.Temperatures[0].current);
    } catch (e) {
      this.log.error('[GET] CurrentTemperature 오류:', e.message);
      callback(e);
    }
  }

  async getTargetTemperature(callback) {
    this.log.info('[GET] TargetTemperature 요청');
    try {
      const state = await this.getCachedState();
      this.log.info(`[GET] TargetTemperature 반환: ${state.Temperatures[0].desired}°C`);
      callback(null, state.Temperatures[0].desired);
    } catch (e) {
      this.log.error('[GET] TargetTemperature 오류:', e.message);
      callback(e);
    }
  }

  async setTargetTemperature(value, callback) {
    this.log.info(`[SET] TargetTemperature 설정 요청: ${value}°C`);
    try {
      await this.sendCommand('/temperatures/0', { desired: value });
      this.log.info('[SET] TargetTemperature 전송 완료');
      callback(null);
    } catch (e) {
      this.log.error('[SET] TargetTemperature 오류:', e.message);
      callback(e);
    }
  }

  async getSwingMode(callback) {
    this.log.info('[GET] SwingMode 요청');
    try {
      const state = await this.getCachedState();
      let enabled;
      if (this.swingModeType === 'wind') {
        enabled = state.Wind.direction === 'Up_And_Low';
      } else {
        enabled = state.Mode.options.includes('Comode_Nano');
      }
      this.log.info(`[GET] SwingMode 반환: ${enabled ? 'SWING_ENABLED' : 'SWING_DISABLED'}`);
      callback(null, enabled
        ? Characteristic.SwingMode.SWING_ENABLED
        : Characteristic.SwingMode.SWING_DISABLED);
    } catch (e) {
      this.log.error('[GET] SwingMode 오류:', e.message);
      callback(e);
    }
  }

  async setSwingMode(value, callback) {
    const mode = value === Characteristic.SwingMode.SWING_ENABLED ? 'ENABLED' : 'DISABLED';
    this.log.info(`[SET] SwingMode 설정 요청: ${mode}`);
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
      this.log.info('[SET] SwingMode 전송 완료');
      callback(null);
    } catch (e) {
      this.log.error('[SET] SwingMode 오류:', e.message);
      callback(e);
    }
  }

  async getLockPhysicalControls(callback) {
    this.log.info('[GET] LockPhysicalControls 요청');
    try {
      const state = await this.getCachedState();
      const locked = state.Mode.options.includes('Autoclean_On');
      this.log.info(`[GET] LockPhysicalControls 반환: ${locked ? 'LOCK_ENABLED' : 'LOCK_DISABLED'}`);
      callback(null, locked
        ? Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED
        : Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED);
    } catch (e) {
      this.log.error('[GET] LockPhysicalControls 오류:', e.message);
      callback(e);
    }
  }

  async setLockPhysicalControls(value, callback) {
    const action = value === Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED
      ? 'Autoclean_On' : 'Autoclean_Off';
    this.log.info(`[SET] LockPhysicalControls 설정 요청: ${action}`);
    try {
      await this.sendCommand('/mode', { options: [action] });
      this.log.info('[SET] LockPhysicalControls 전송 완료');
      callback(null);
    } catch (e) {
      this.log.error('[SET] LockPhysicalControls 오류:', e.message);
      callback(e);
    }
  }

  async getCurrentHeaterCoolerState(callback) {
    this.log.info('[GET] CurrentHeaterCoolerState 요청');
    try {
      const state = await this.getCachedState();
      const mode = state.Mode.modes[0];
      const cooling = ['CoolClean','Cool','Dry','DryClean','Auto','Wind']
        .includes(mode);
      this.log.info(`[GET] CurrentHeaterCoolerState 반환: ${cooling ? 'COOLING' : 'IDLE'}`);
      callback(null, cooling
        ? Characteristic.CurrentHeaterCoolerState.COOLING
        : Characteristic.CurrentHeaterCoolerState.IDLE);
    } catch (e) {
      this.log.error('[GET] CurrentHeaterCoolerState 오류:', e.message);
      callback(e);
    }
  }

  getTargetHeaterCoolerState(callback) {
    this.log.info('[GET] TargetHeaterCoolerState 요청');
    this.getCurrentHeaterCoolerState(callback);
  }

  async setTargetHeaterCoolerState(value, callback) {
    this.log.info('[SET] TargetHeaterCoolerState 호출 무시');
    callback(null);
  }
}
