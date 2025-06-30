// Samsung Air Conditioner Homebridge Plugin
// Version 1.9.23 (TLS 인증서 포맷 오류 수정)
'use strict';

const tls = require('tls');
const fs = require('fs');
const { constants } = require('crypto');

let HAP, Service, Characteristic;

// 인증서: key와 cert 분리 (PEM 포맷의 길이 초과 이슈 방지)
const defaultKey = fs.readFileSync(__dirname + '/certs/private.key');
const defaultCert = fs.readFileSync(__dirname + '/certs/certificate.crt');

const API_PORT = 8888;
const API_DEVICES_PATH = '/devices';
const PLUGIN_VERSION = '1.9.23';

class SwingModeHandler {
  constructor(type) { this.type = type; }
  getValue(state) {
    if (!state) return false;
    if (this.type === 'wind') return state.Wind?.direction === 'Up_And_Low';
    return state.Mode?.options?.includes('Comode_Nano');
  }
  getCommand(enable) {
    if (this.type === 'wind') {
      return { endpoint: '/wind', data: { direction: enable ? 'Up_And_Low' : 'Fix' } };
    }
    const opt = enable ? 'Comode_Nano' : 'Comode_Off';
    return { endpoint: '/mode', data: { options: [opt] } };
  }
}

module.exports = function(homebridge) {
  HAP = homebridge.hap;
  Service = HAP.Service;
  Characteristic = HAP.Characteristic;
  homebridge.registerAccessory('homebridge-samsung-ac', 'SamsungAC', SamsungAirco);
};

class SamsungAirco {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.name = config.name;
    this.ip = config.ip;
    this.token = config.token;
    this.deviceIndex = config.deviceIndex || 0;
    this.setDeviceIndex = config.setDeviceIndex ?? this.deviceIndex;
    this.swingModeHandler = new SwingModeHandler(config.swingModeType || 'comfort');
    this.cacheDuration = config.cacheDuration || 30000;
    this.timeout = config.timeout || 5000;
    this.pollingInterval = config.pollingInterval;
    this._cache = null;
    this._cacheAt = 0;

    if (!this.ip || !this.token) {
      throw new Error(`[${this.name}] 필수 설정(ip, token)이 누락되었습니다.`);
    }

    this.tlsOptions = {
      host: this.ip,
      port: API_PORT,
      key: defaultKey,
      cert: defaultCert,
      rejectUnauthorized: false,
      honorCipherOrder: true,
      ciphers: 'DEFAULT@SECLEVEL=0',
      minVersion: 'TLSv1',
      maxVersion: 'TLSv1',
      secureOptions: constants.SSL_OP_LEGACY_SERVER_CONNECT,
    };

    this.acService = new Service.HeaterCooler(this.name);
    this.infoService = new Service.AccessoryInformation()
      .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
      .setCharacteristic(Characteristic.Model, 'AF16K7970WFN')
      .setCharacteristic(Characteristic.SerialNumber, config.serialNumber || 'UNKNOWN')
      .setCharacteristic(Characteristic.FirmwareRevision, PLUGIN_VERSION);

    this.acService.getCharacteristic(Characteristic.Active)
      .onGet(this.getActive.bind(this))
      .onSet(this.setActive.bind(this));

    this.acService.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
      .onGet(this.getCurrentHeaterCoolerState.bind(this));

    this.acService.getCharacteristic(Characteristic.TargetHeaterCoolerState)
      .setProps({ validValues: [Characteristic.TargetHeaterCoolerState.COOL] })
      .onGet(this.getTargetHeaterCoolerState.bind(this))
      .onSet(this.setTargetHeaterCoolerState.bind(this));

    this.acService.getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

    this.acService.getCharacteristic(Characteristic.CoolingThresholdTemperature)
      .setProps({ minValue: 18, maxValue: 30, minStep: 1 })
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperature.bind(this));

    this.acService.getCharacteristic(Characteristic.SwingMode)
      .onGet(this.getSwingMode.bind(this))
      .onSet(this.setSwingMode.bind(this));

    this.acService.getCharacteristic(Characteristic.LockPhysicalControls)
      .onGet(this.getLockPhysicalControls.bind(this))
      .onSet(this.setLockPhysicalControls.bind(this));

    this.getCachedState(true)
      .catch(e => this.log.error(`[${this.name}] 초기 상태 로딩 실패:`, e.message))
      .finally(() => {
        if (this.pollingInterval > 0) {
          this.log.info(`[${this.name}] ${this.pollingInterval}s 간격 폴링 시작`);
          this._poll = setInterval(() => {
            this.log.debug(`[${this.name}] 주기적 상태 요청`);
            this.getCachedState(true).catch(e => this.log.warn(`[${this.name}] 폴링 오류:`, e.message));
          }, this.pollingInterval * 1000);
          this.api.on('shutdown', () => clearInterval(this._poll));
        }
      });

    this.log.info(`[${this.name}] Samsung AC Plugin v${PLUGIN_VERSION} 초기화 완료`);
  }

  async _rawRequest(path, method, data) {
    return new Promise((resolve, reject) => {
      const socket = tls.connect(this.tlsOptions)
        .on('error', err => reject(new Error(`TLS 오류: ${err.message}`)));
      socket.setTimeout(this.timeout, () => socket.destroy(new Error('요청 시간 초과')));
      socket.on('secureConnect', () => {
        const body = data ? JSON.stringify(data) : '';
        const headers = [
          `${method} ${path} HTTP/1.1`,
          `Host: ${this.ip}`,
          `Authorization: Bearer ${this.token}`,
          data ? 'Content-Type: application/json' : '',
          data ? `Content-Length: ${Buffer.byteLength(body)}` : '',
          'Connection: close',
        ].filter(l => l).join('\r\n') + '\r\n\r\n';
        this.log.debug(`[${this.name}] 요청 →\n${headers}${body}`);
        socket.write(headers + body);
      });

      let resp = '';
      socket.setEncoding('utf8');
      socket.on('data', chunk => resp += chunk);
      socket.on('end', () => {
        this.log.debug(`[${this.name}] 응답 원본:\n${resp}`);
        const sep = '\r\n\r\n', idx = resp.indexOf(sep);
        const hdr = idx > -1 ? resp.slice(0, idx) : '';
        let body = idx > -1 ? resp.slice(idx + sep.length) : resp;
        body = body.trim();
        if (!body) return reject(new Error('빈 응답을 받았습니다.'));
        if (/Transfer-Encoding:\s*chunked/i.test(hdr)) {
          this.log.debug(`[${this.name}] 청크 인코딩 감지, 디코딩`);
          body = body.split('\r\n').filter((_, i) => i % 2 === 1).join('');
        }
        if (!body.includes('{')) return reject(new Error('유효한 JSON 본문이 없습니다.'));
        try {
          const j = JSON.parse(body);
          return resolve(j);
        } catch (e) {
          this.log.error(`[${this.name}] JSON 파싱 실패:\n${body}`);
          return reject(new Error('JSON 파싱 오류'));
        }
      });
    });
  }

  async _request(method, path, data = null, retries = 3) {
    for (let i = 1; i <= retries; i++) {
      try { return await this._rawRequest(path, method, data); }
      catch (e) {
        if (i === retries) {
          this.log.error(`[${this.name}] 최종 요청 실패 (${i}/${retries}): ${e.message}`);
          throw e;
        }
        this.log.warn(`[${this.name}] 요청 오류 (${i}/${retries}): ${e.message}, 재시도...`);
        await new Promise(r => setTimeout(r, 1000 * i));
      }
    }
  }

  async getCachedState(force = false) {
    const now = Date.now();
    if (!force && this._cache && (now - this._cacheAt < this.cacheDuration)) {
      this.log.debug(`[${this.name}] 캐시 사용`);
      return this._cache;
    }
    this.log.debug(`[${this.name}] 상태 새로 요청`);
    const res = await this._request('GET', API_DEVICES_PATH);
    if (!res?.Devices?.[this.deviceIndex]) {
      throw new Error('장치를 찾을 수 없습니다.');
    }
    this._cache = res;
    this._cacheAt = now;
    return res;
  }

  async sendCommand(endpoint, data) {
    this.log.info(`[${this.name}] [COMMAND] ${endpoint} → ${JSON.stringify(data)}`);
    await this._request('PUT', `/devices/${this.setDeviceIndex}${endpoint}`, data);
    this.log.info(`[${this.name}] [COMMAND] 완료: ${endpoint}`);
    this._cache = null;
    await this.getCachedState(true);
  }

  identify(cb) { this.log.info(`[${this.name}] Identify 호출`); cb(); }
  getServices() { return [this.infoService, this.acService]; }

  async getActive() {
    this.log.debug(`[${this.name}] GET Active`);
    const dev = (await this.getCachedState()).Devices[this.deviceIndex];
    const on = dev.Operation.power === 'On';
    this.log.info(`[${this.name}] > Active: ${on ? 'ON' : 'OFF'}`);
    return on;
  }

  async setActive(v) {
    this.log.debug(`[${this.name}] SET Active → ${v ? 'On' : 'Off'}`);
    await this.sendCommand('', { Operation: { power: v ? 'On' : 'Off' } });
  }

  async getCurrentHeaterCoolerState() {
    this.log.debug(`[${this.name}] GET CurrentState`);
    const dev = (await this.getCachedState()).Devices[this.deviceIndex];
    if (dev.Operation.power !== 'On') {
      this.log.info(`[${this.name}] > CurrentState: INACTIVE`);
      return Characteristic.CurrentHeaterCoolerState.INACTIVE;
    }
    const mode = dev.Mode.modes[0] || '';
    const cooling = ['CoolClean', 'Cool', 'Dry', 'DryClean', 'Auto', 'Wind'].includes(mode);
    const st = cooling ? Characteristic.CurrentHeaterCoolerState.COOLING : Characteristic.CurrentHeaterCoolerState.IDLE;
    this.log.info(`[${this.name}] > CurrentState: ${cooling ? 'COOLING' : 'IDLE'}`);
    return st;
  }

  async getTargetHeaterCoolerState() {
    this.log.debug(`[${this.name}] GET TargetState → COOL`);
    return Characteristic.TargetHeaterCoolerState.COOL;
  }
  async setTargetHeaterCoolerState() {
    this.log.debug(`[${this.name}] SET TargetState 무시`);
  }

  async getCurrentTemperature() {
    this.log.debug(`[${this.name}] GET CurrentTemperature`);
    const dev = (await this.getCachedState()).Devices[this.deviceIndex];
    const t = dev.Temperatures[0].current;
    this.log.info(`[${this.name}] > CurrentTemperature: ${t}°C`);
    return t;
  }

  async getTargetTemperature() {
    this.log.debug(`[${this.name}] GET TargetTemperature`);
    const dev = (await this.getCachedState()).Devices[this.deviceIndex];
    const t = dev.Temperatures[0].desired;
    this.log.info(`[${this.name}] > TargetTemperature: ${t}°C`);
    return t;
  }

  async setTargetTemperature(v) {
    this.log.debug(`[${this.name}] SET TargetTemperature → ${v}°C`);
    await this.sendCommand('/temperatures/0', { desired: v });
  }

  async getSwingMode() {
    this.log.debug(`[${this.name}] GET SwingMode`);
    const dev = (await this.getCachedState()).Devices[this.deviceIndex];
    const on = this.swingModeHandler.getValue(dev);
    this.log.info(`[${this.name}] > SwingMode: ${on ? 'ENABLED' : 'DISABLED'}`);
    return on;
  }

  async setSwingMode(v) {
    this.log.debug(`[${this.name}] SET SwingMode → ${v ? 'ENABLED' : 'DISABLED'}`);
    const { endpoint, data } = this.swingModeHandler.getCommand(!!v);
    await this.sendCommand(endpoint, data);
  }

  async getLockPhysicalControls() {
    this.log.debug(`[${this.name}] GET LockPhysicalControls`);
    const dev = (await this.getCachedState()).Devices[this.deviceIndex];
    const on = dev.Mode.options.includes('Autoclean_On');
    this.log.info(`[${this.name}] > LockPhysicalControls: ${on ? 'ENABLED' : 'DISABLED'}`);
    return on;
  }

  async setLockPhysicalControls(v) {
    this.log.debug(`[${this.name}] SET LockPhysicalControls → ${v ? 'On' : 'Off'}`);
    const cmd = v ? 'Autoclean_On' : 'Autoclean_Off';
    await this.sendCommand('/mode', { options: [cmd] });
  }
}
